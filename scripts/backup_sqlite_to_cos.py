#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create an online SQLite backup and optionally upload it to Tencent COS."""

from __future__ import annotations

import argparse
import gzip
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, Optional


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = PROJECT_ROOT / ".env"
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "stock_analysis.db"
DEFAULT_BACKUP_DIR = PROJECT_ROOT / "backups" / "db"
BACKUP_PREFIX = "stock_analysis"


def parse_env_file(path: Path) -> Dict[str, str]:
    """Parse simple dotenv files without evaluating shell syntax."""
    values: Dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue

        if value and value[0] in {"'", '"'}:
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        else:
            value = value.split(" #", 1)[0].strip()

        values[key] = value
    return values


def merged_config(env_file: Path) -> Dict[str, str]:
    config = parse_env_file(env_file)
    config.update(os.environ)
    return config


def env_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None or not value.strip():
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def resolve_path(raw_path: Optional[str], default: Path) -> Path:
    if not raw_path:
        return default
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path
    return PROJECT_ROOT / path


def normalize_cos_uri(base_uri: str, filename: str) -> str:
    return f"{base_uri.rstrip('/')}/{filename}"


def create_sqlite_backup(db_path: Path, output_db: Path) -> None:
    if not db_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {db_path}")

    source_uri = f"file:{db_path}?mode=ro"
    with sqlite3.connect(source_uri, uri=True, timeout=30) as source:
        with sqlite3.connect(output_db) as target:
            source.backup(target)


def gzip_file(source: Path, target: Path) -> None:
    with source.open("rb") as input_file:
        with gzip.open(target, "wb", compresslevel=9) as output_file:
            shutil.copyfileobj(input_file, output_file)


def encrypt_file(source: Path, target: Path, passphrase_file: Path) -> None:
    if not passphrase_file.exists():
        raise FileNotFoundError(f"Encryption passphrase file not found: {passphrase_file}")

    command = [
        "openssl",
        "enc",
        "-aes-256-cbc",
        "-salt",
        "-pbkdf2",
        "-iter",
        "200000",
        "-in",
        str(source),
        "-out",
        str(target),
        "-pass",
        f"file:{passphrase_file}",
    ]
    subprocess.run(command, check=True)


def upload_to_cos(backup_file: Path, cos_uri: str, coscli_bin: str, config_path: Optional[Path]) -> None:
    destination = normalize_cos_uri(cos_uri, backup_file.name)
    command = [coscli_bin]
    if config_path:
        command.extend(["-c", str(config_path)])
    command.extend(["cp", str(backup_file), destination])
    subprocess.run(command, check=True)


def cleanup_old_backups(backup_dir: Path, retention_days: int, now_ts: float) -> None:
    if retention_days <= 0:
        return

    cutoff_seconds = retention_days * 24 * 60 * 60
    patterns = (f"{BACKUP_PREFIX}-*.db.gz", f"{BACKUP_PREFIX}-*.db.gz.enc")
    for candidate in iter_backup_files(backup_dir, patterns):
        try:
            age_seconds = now_ts - candidate.stat().st_mtime
        except FileNotFoundError:
            continue
        if age_seconds > cutoff_seconds:
            candidate.unlink()


def cleanup_excess_backups(backup_dir: Path, keep_count: int) -> None:
    if keep_count <= 0:
        return

    candidates = sorted(
        iter_backup_files(backup_dir, (f"{BACKUP_PREFIX}-*.db.gz", f"{BACKUP_PREFIX}-*.db.gz.enc")),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for candidate in candidates[keep_count:]:
        candidate.unlink()


def iter_backup_files(backup_dir: Path, patterns: Iterable[str]) -> Iterable[Path]:
    seen = set()
    for pattern in patterns:
        for path in backup_dir.glob(pattern):
            if path not in seen:
                seen.add(path)
                yield path


def positive_int(raw_value: Optional[str], default: int) -> int:
    if raw_value is None or not str(raw_value).strip():
        return default
    value = int(str(raw_value).strip())
    if value < 0:
        raise ValueError("retention days must be >= 0")
    return value


def non_negative_int(raw_value: Optional[str], default: int) -> int:
    if raw_value is None or not str(raw_value).strip():
        return default
    value = int(str(raw_value).strip())
    if value < 0:
        raise ValueError("keep count must be >= 0")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Back up the SQLite database and optionally upload it to Tencent COS.")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="Path to .env file. Default: ./.env")
    parser.add_argument("--db", help="SQLite database path. Defaults to DATABASE_PATH or ./data/stock_analysis.db")
    parser.add_argument("--backup-dir", help="Local backup directory. Defaults to DB_BACKUP_LOCAL_DIR or ./backups/db")
    parser.add_argument("--cos-uri", help="COS destination URI, for example cos://bucket-1250000000/dsa/db")
    parser.add_argument("--retention-days", type=int, help="Local retention days. Defaults to DB_BACKUP_RETENTION_DAYS or 30")
    parser.add_argument("--keep-count", type=int, help="Max local backup files to keep. Defaults to DB_BACKUP_LOCAL_KEEP_COUNT or 0")
    parser.add_argument("--no-upload", action="store_true", help="Create only a local backup, even when COS is configured")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    env_file = Path(args.env_file).expanduser()
    if not env_file.is_absolute():
        env_file = PROJECT_ROOT / env_file

    config = merged_config(env_file)
    if not env_bool(config.get("DB_BACKUP_ENABLED"), default=True):
        print("Database backup skipped: DB_BACKUP_ENABLED is false")
        return 0

    db_path = resolve_path(args.db or config.get("DATABASE_PATH"), DEFAULT_DATABASE_PATH)
    backup_dir = resolve_path(args.backup_dir or config.get("DB_BACKUP_LOCAL_DIR"), DEFAULT_BACKUP_DIR)
    retention_days = args.retention_days
    if retention_days is None:
        retention_days = positive_int(config.get("DB_BACKUP_RETENTION_DAYS"), 30)
    keep_count = args.keep_count
    if keep_count is None:
        keep_count = non_negative_int(config.get("DB_BACKUP_LOCAL_KEEP_COUNT"), 0)

    cos_uri = args.cos_uri or config.get("DB_BACKUP_COS_URI", "")
    coscli_bin = config.get("DB_BACKUP_COSCLI_BIN", "coscli")
    coscli_config_path = resolve_path(config.get("DB_BACKUP_COSCLI_CONFIG_PATH"), Path()) if config.get("DB_BACKUP_COSCLI_CONFIG_PATH") else None
    passphrase_file = (
        resolve_path(config.get("DB_BACKUP_ENCRYPTION_PASSPHRASE_FILE"), Path())
        if config.get("DB_BACKUP_ENCRYPTION_PASSPHRASE_FILE")
        else None
    )

    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    with tempfile.TemporaryDirectory(prefix="dsa-db-backup-") as tmp:
        tmp_db = Path(tmp) / f"{BACKUP_PREFIX}-{timestamp}.db"
        gzip_backup = backup_dir / f"{BACKUP_PREFIX}-{timestamp}.db.gz"

        print(f"Creating SQLite backup from {db_path}")
        create_sqlite_backup(db_path, tmp_db)
        gzip_file(tmp_db, gzip_backup)

    backup_file = gzip_backup
    if passphrase_file:
        encrypted_backup = gzip_backup.with_suffix(gzip_backup.suffix + ".enc")
        print(f"Encrypting backup to {encrypted_backup}")
        encrypt_file(gzip_backup, encrypted_backup, passphrase_file)
        gzip_backup.unlink()
        backup_file = encrypted_backup

    print(f"Local backup created: {backup_file}")

    if cos_uri and not args.no_upload:
        print(f"Uploading backup to {normalize_cos_uri(cos_uri, backup_file.name)}")
        upload_to_cos(backup_file, cos_uri, coscli_bin, coscli_config_path)
        print("COS upload completed")
    elif not cos_uri:
        print("COS upload skipped: DB_BACKUP_COS_URI is not configured")

    cleanup_old_backups(backup_dir, retention_days, datetime.now().timestamp())
    cleanup_excess_backups(backup_dir, keep_count)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Database backup failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
