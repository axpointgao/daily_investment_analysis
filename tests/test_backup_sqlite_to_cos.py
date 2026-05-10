import gzip
import os
import sqlite3
import time
from pathlib import Path

from scripts import backup_sqlite_to_cos


def create_source_db(path: Path) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("CREATE TABLE portfolio_trades (id INTEGER PRIMARY KEY, symbol TEXT NOT NULL)")
        conn.execute("INSERT INTO portfolio_trades (symbol) VALUES ('AAPL')")
        conn.commit()


def read_gzip_sqlite(path: Path) -> list[tuple[str]]:
    restored = path.with_suffix("")
    with gzip.open(path, "rb") as source:
        restored.write_bytes(source.read())
    with sqlite3.connect(restored) as conn:
        return conn.execute("SELECT symbol FROM portfolio_trades ORDER BY id").fetchall()


def test_sqlite_online_backup_captures_wal_data(tmp_path: Path) -> None:
    db_path = tmp_path / "stock_analysis.db"
    backup_db = tmp_path / "backup.db"
    create_source_db(db_path)

    backup_sqlite_to_cos.create_sqlite_backup(db_path, backup_db)

    with sqlite3.connect(backup_db) as conn:
        rows = conn.execute("SELECT symbol FROM portfolio_trades").fetchall()

    assert rows == [("AAPL",)]


def test_backup_main_creates_local_gzip_from_env(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.chdir(backup_sqlite_to_cos.PROJECT_ROOT)
    db_path = tmp_path / "stock_analysis.db"
    backup_dir = tmp_path / "backups"
    env_file = tmp_path / ".env"
    create_source_db(db_path)
    env_file.write_text(
        "\n".join(
            [
                f"DATABASE_PATH={db_path}",
                f"DB_BACKUP_LOCAL_DIR={backup_dir}",
                "DB_BACKUP_RETENTION_DAYS=30",
                "DB_BACKUP_COS_URI=",
            ]
        ),
        encoding="utf-8",
    )

    exit_code = backup_sqlite_to_cos.main(["--env-file", str(env_file), "--no-upload"])

    backups = list(backup_dir.glob("stock_analysis-*.db.gz"))
    assert exit_code == 0
    assert len(backups) == 1
    assert read_gzip_sqlite(backups[0]) == [("AAPL",)]


def test_cleanup_old_backups_respects_retention(tmp_path: Path) -> None:
    old_backup = tmp_path / "stock_analysis-20260101-000000.db.gz"
    fresh_backup = tmp_path / "stock_analysis-20260102-000000.db.gz"
    old_backup.write_text("old", encoding="utf-8")
    fresh_backup.write_text("fresh", encoding="utf-8")
    now_ts = time.time()
    os.utime(old_backup, (now_ts - 3 * 24 * 60 * 60, now_ts - 3 * 24 * 60 * 60))
    os.utime(fresh_backup, (now_ts, now_ts))

    backup_sqlite_to_cos.cleanup_old_backups(tmp_path, retention_days=1, now_ts=now_ts)

    assert not old_backup.exists()
    assert fresh_backup.exists()


def test_cleanup_excess_backups_keeps_newest_files(tmp_path: Path) -> None:
    backups = []
    now_ts = time.time()
    for index in range(4):
        backup = tmp_path / f"stock_analysis-2026010{index + 1}-000000.db.gz"
        backup.write_text(str(index), encoding="utf-8")
        mtime = now_ts + index
        os.utime(backup, (mtime, mtime))
        backups.append(backup)

    backup_sqlite_to_cos.cleanup_excess_backups(tmp_path, keep_count=3)

    assert not backups[0].exists()
    assert all(backup.exists() for backup in backups[1:])
