#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract and import large A-share historical CSV datasets into DuckDB.

Directory contract under MARKET_HISTORY_ROOT:
- _archives/raw/      每天一表/不复权 archives
- _archives/qfq/      每天一表/前复权 archives
- _archives/by_stock/ 每股一表/前复权 archives
- daily/raw/          extracted daily raw CSV files
- daily/qfq/          extracted daily qfq CSV files
- by_stock/qfq/       extracted per-stock qfq CSV files
"""

from __future__ import annotations

import argparse
import logging
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger("import_market_history")


@dataclass(frozen=True)
class DatasetSpec:
    name: str
    archive_dir: str
    extract_dir: str


DATASETS: dict[str, DatasetSpec] = {
    "raw": DatasetSpec("raw", "_archives/raw", "daily/raw"),
    "qfq": DatasetSpec("qfq", "_archives/qfq", "daily/qfq"),
    "by_stock_qfq": DatasetSpec("by_stock_qfq", "_archives/by_stock", "by_stock/qfq"),
}


def _run(cmd: list[str]) -> None:
    logger.info("Running: %s", " ".join(cmd))
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)


def _extract_rar(archive: Path, target_dir: Path, password: Optional[str] = None) -> None:
    if shutil.which("unrar"):
        password_arg = f"-p{password}" if password else "-p-"
        _run(["unrar", "x", "-o+", password_arg, str(archive), str(target_dir)])
        return
    if shutil.which("7z"):
        password_arg = f"-p{password}" if password else "-p"
        _run(["7z", "x", "-y", f"-o{target_dir}", password_arg, str(archive)])
        return
    if shutil.which("7zz"):
        password_arg = f"-p{password}" if password else "-p"
        _run(["7zz", "x", "-y", f"-o{target_dir}", password_arg, str(archive)])
        return
    if shutil.which("bsdtar"):
        _run(["bsdtar", "-xf", str(archive), "-C", str(target_dir)])
        return
    raise RuntimeError(
        "RAR archive found but no extractor is installed. "
        "Install unrar, 7z/7zz, or bsdtar with RAR support."
    )


def _safe_extract_zip(archive: Path, target_dir: Path) -> None:
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            destination = target_dir / member.filename
            try:
                destination.resolve().relative_to(target_dir.resolve())
            except ValueError as exc:
                raise RuntimeError(f"Unsafe zip member path: {member.filename}") from exc
        zf.extractall(target_dir)


def cleanup_extracted_metadata(target_dir: Path) -> int:
    """Remove macOS archive metadata files from generated extraction trees."""
    if not target_dir.exists():
        return 0

    removed = 0
    for item in list(target_dir.rglob("*")):
        if item.name == "__MACOSX" and item.is_dir():
            shutil.rmtree(item)
            removed += 1
            continue
        if item.name.startswith("._") and item.is_file():
            item.unlink()
            removed += 1
    return removed


def extract_archives(root: Path, *, dataset: str = "all", password: Optional[str] = None) -> None:
    selected = DATASETS.values() if dataset == "all" else [DATASETS[dataset]]

    for spec in selected:
        archive_dir = root / spec.archive_dir
        target_dir = root / spec.extract_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        if not archive_dir.exists():
            logger.warning("Archive directory does not exist: %s", archive_dir)
            continue

        archives = sorted(
            item for item in archive_dir.iterdir()
            if item.is_file() and item.suffix.lower() in {".zip", ".rar"}
        )
        if not archives:
            logger.warning("No .zip/.rar archives found in %s", archive_dir)
            continue

        for archive in archives:
            logger.info("Extracting %s -> %s", archive, target_dir)
            suffix = archive.suffix.lower()
            if suffix == ".zip":
                _safe_extract_zip(archive, target_dir)
            elif suffix == ".rar":
                _extract_rar(archive, target_dir, password=password)
        removed = cleanup_extracted_metadata(target_dir)
        if removed:
            logger.info("Removed %s archive metadata files from %s", removed, target_dir)


def _quote_path(path: Path) -> str:
    return str(path).replace("\\", "\\\\").replace("'", "''")


def _count_csv_files(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for item in path.rglob("*.csv") if item.is_file() and not item.name.startswith("._"))


def _daily_csv_batches(source_dir: Path) -> list[tuple[str, Path, int]]:
    if not source_dir.exists():
        return []

    year_dirs = sorted(item for item in source_dir.rglob("*") if item.is_dir() and item.name.isdigit())
    if year_dirs:
        batches: list[tuple[str, Path, int]] = []
        for year_dir in year_dirs:
            count = _count_csv_files(year_dir)
            if count:
                batches.append((year_dir.name, year_dir, count))
        return batches

    count = _count_csv_files(source_dir)
    return [("all", source_dir, count)] if count else []


def _insert_daily_batch_sql(glob_path: str) -> str:
    return f"""
        INSERT INTO stock_daily_history (
            adjustment, trade_date, code, name, industry,
            open, high, low, close, prev_close, volume, amount,
            turnover_rate, pct_chg, amplitude, is_st, volume_ratio,
            pct_chg_3d, pct_chg_6d, pct_chg_10d, pct_chg_25d,
            is_limit_up, total_share, float_share, total_mv, float_mv,
            pe_ttm, pb, ps_ttm, ma5, ma10, ma20, ma30, ma60, ma120, ma250,
            list_date, delist_date, source_file
        )
        SELECT
            ? AS adjustment,
            TRY_CAST("日期" AS DATE) AS trade_date,
            LPAD(CAST(TRY_CAST("代码" AS BIGINT) AS VARCHAR), 6, '0') AS code,
            CAST("名称" AS VARCHAR) AS name,
            CAST("所属行业" AS VARCHAR) AS industry,
            TRY_CAST("开盘价" AS DOUBLE) AS open,
            TRY_CAST("最高价" AS DOUBLE) AS high,
            TRY_CAST("最低价" AS DOUBLE) AS low,
            TRY_CAST("收盘价" AS DOUBLE) AS close,
            TRY_CAST("前收盘价" AS DOUBLE) AS prev_close,
            TRY_CAST("成交量（股）" AS DOUBLE) AS volume,
            TRY_CAST("成交额（元）" AS DOUBLE) AS amount,
            TRY_CAST("换手率" AS DOUBLE) AS turnover_rate,
            TRY_CAST("涨幅%" AS DOUBLE) AS pct_chg,
            TRY_CAST("振幅%" AS DOUBLE) AS amplitude,
            CAST("是否ST" AS VARCHAR) = '是' AS is_st,
            TRY_CAST("量比" AS DOUBLE) AS volume_ratio,
            TRY_CAST("3日涨幅%" AS DOUBLE) AS pct_chg_3d,
            TRY_CAST("6日涨幅%" AS DOUBLE) AS pct_chg_6d,
            TRY_CAST("10日涨幅%" AS DOUBLE) AS pct_chg_10d,
            TRY_CAST("25日涨幅%" AS DOUBLE) AS pct_chg_25d,
            CAST("是否涨停" AS VARCHAR) = '是' AS is_limit_up,
            TRY_CAST("总股本（股）" AS DOUBLE) AS total_share,
            TRY_CAST("流通股本（股）" AS DOUBLE) AS float_share,
            TRY_CAST("总市值（元）" AS DOUBLE) AS total_mv,
            TRY_CAST("流通市值（元）" AS DOUBLE) AS float_mv,
            TRY_CAST("滚动市盈率" AS DOUBLE) AS pe_ttm,
            TRY_CAST("市净率" AS DOUBLE) AS pb,
            TRY_CAST("滚动市销率" AS DOUBLE) AS ps_ttm,
            TRY_CAST("5日线" AS DOUBLE) AS ma5,
            TRY_CAST("10日线" AS DOUBLE) AS ma10,
            TRY_CAST("20日线" AS DOUBLE) AS ma20,
            TRY_CAST("30日线" AS DOUBLE) AS ma30,
            TRY_CAST("60日线" AS DOUBLE) AS ma60,
            TRY_CAST("120日线" AS DOUBLE) AS ma120,
            TRY_CAST("250日线" AS DOUBLE) AS ma250,
            TRY_CAST(NULLIF("上市时间", '-') AS DATE) AS list_date,
            TRY_CAST(NULLIF("退市时间", '-') AS DATE) AS delist_date,
            filename AS source_file
        FROM read_csv(
            '{glob_path}',
            header=true,
            union_by_name=true,
            filename=true,
            all_varchar=true,
            ignore_errors=true
        )
        WHERE TRY_CAST("日期" AS DATE) IS NOT NULL
          AND TRY_CAST("代码" AS BIGINT) IS NOT NULL
          AND regexp_extract(filename, '[^/]+$') NOT LIKE '._%'
    """


def import_daily_history(root: Path, db_path: Path, *, adjustment: str = "all") -> None:
    try:
        import duckdb
    except ImportError as exc:
        raise RuntimeError("duckdb is required. Install requirements.txt first.") from exc

    db_path.parent.mkdir(parents=True, exist_ok=True)
    selected = ("raw", "qfq") if adjustment == "all" else (adjustment,)

    with duckdb.connect(str(db_path)) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS stock_daily_history (
                adjustment VARCHAR NOT NULL,
                trade_date DATE NOT NULL,
                code VARCHAR NOT NULL,
                name VARCHAR,
                industry VARCHAR,
                open DOUBLE,
                high DOUBLE,
                low DOUBLE,
                close DOUBLE,
                prev_close DOUBLE,
                volume DOUBLE,
                amount DOUBLE,
                turnover_rate DOUBLE,
                pct_chg DOUBLE,
                amplitude DOUBLE,
                is_st BOOLEAN,
                volume_ratio DOUBLE,
                pct_chg_3d DOUBLE,
                pct_chg_6d DOUBLE,
                pct_chg_10d DOUBLE,
                pct_chg_25d DOUBLE,
                is_limit_up BOOLEAN,
                total_share DOUBLE,
                float_share DOUBLE,
                total_mv DOUBLE,
                float_mv DOUBLE,
                pe_ttm DOUBLE,
                pb DOUBLE,
                ps_ttm DOUBLE,
                ma5 DOUBLE,
                ma10 DOUBLE,
                ma20 DOUBLE,
                ma30 DOUBLE,
                ma60 DOUBLE,
                ma120 DOUBLE,
                ma250 DOUBLE,
                list_date DATE,
                delist_date DATE,
                source_file VARCHAR,
                imported_at TIMESTAMP DEFAULT current_timestamp
            )
            """
        )

        for item in selected:
            source_dir = root / "daily" / item
            batches = _daily_csv_batches(source_dir)
            file_count = sum(count for _label, _path, count in batches)
            if not batches:
                logger.warning("No CSV files found for %s at %s", item, source_dir)
                continue

            logger.info("Importing %s daily CSV files for adjustment=%s", file_count, item)
            conn.execute("DELETE FROM stock_daily_history WHERE adjustment = ?", [item])
            for label, batch_dir, batch_count in batches:
                glob_path = _quote_path(batch_dir / "*.csv")
                logger.info("Importing adjustment=%s batch=%s files=%s", item, label, batch_count)
                conn.execute(_insert_daily_batch_sql(glob_path), [item])

        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_stock_daily_history_code_date "
                "ON stock_daily_history (adjustment, code, trade_date)"
            )
        except Exception as exc:
            logger.warning("Index creation skipped after import failure: %s", exc)
        conn.execute(
            """
            CREATE OR REPLACE VIEW stock_daily_history_summary AS
            SELECT
                adjustment,
                COUNT(*) AS row_count,
                COUNT(DISTINCT code) AS stock_count,
                MIN(trade_date) AS min_date,
                MAX(trade_date) AS max_date
            FROM stock_daily_history
            GROUP BY adjustment
            ORDER BY adjustment
            """
        )
        rows = conn.execute("SELECT * FROM stock_daily_history_summary").fetchall()
        for row in rows:
            logger.info("Summary: %s", row)


def show_status(root: Path, db_path: Path) -> None:
    print(f"root={root}")
    for key, spec in DATASETS.items():
        archive_dir = root / spec.archive_dir
        extract_dir = root / spec.extract_dir
        archives = list(archive_dir.glob("*")) if archive_dir.exists() else []
        print(
            f"{key}: archives={len([p for p in archives if p.is_file()])} "
            f"csv={_count_csv_files(extract_dir)} path={extract_dir}"
        )

    if not db_path.exists():
        print(f"duckdb=missing path={db_path}")
        return
    try:
        import duckdb
    except ImportError:
        print(f"duckdb={db_path} (duckdb package not installed, summary unavailable)")
        return
    with duckdb.connect(str(db_path), read_only=True) as conn:
        try:
            rows = conn.execute("SELECT * FROM stock_daily_history_summary").fetchall()
        except Exception:
            rows = []
        print(f"duckdb={db_path}")
        for row in rows:
            print(row)


def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default="./data/market_history",
        help="Market history root directory. Default: ./data/market_history",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="DuckDB output path. Default: <root>/market_history.duckdb",
    )
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging.")

    subparsers = parser.add_subparsers(dest="command", required=True)
    extract = subparsers.add_parser("extract", help="Extract uploaded archives into fixed dataset directories.")
    extract.add_argument("--dataset", choices=["all", *DATASETS.keys()], default="all")
    extract.add_argument("--password", default=None, help="Password for encrypted .rar archives.")

    daily = subparsers.add_parser("import-daily", help="Import daily raw/qfq CSV data into DuckDB.")
    daily.add_argument("--adjustment", choices=["all", "raw", "qfq"], default="all")

    subparsers.add_parser("status", help="Show archive/extraction/import status.")
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    root = Path(args.root).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve() if args.db else root / "market_history.duckdb"

    try:
        if args.command == "extract":
            extract_archives(root, dataset=args.dataset, password=args.password)
        elif args.command == "import-daily":
            import_daily_history(root, db_path, adjustment=args.adjustment)
        elif args.command == "status":
            show_status(root, db_path)
        else:
            raise RuntimeError(f"Unsupported command: {args.command}")
    except Exception as exc:
        logger.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
