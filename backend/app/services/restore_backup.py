"""Command-line entry point for a guarded full-instance restore.

Run from ``backend/`` with ``uv run python -m app.services.restore_backup``.
The command targets a blank database and media volume by default.  Passing
``--replace`` is a deliberate disaster-recovery operation that removes the
current restorable instance data before loading the backup.
"""

import argparse
import sys
from pathlib import Path

from app.db.session import SessionLocal
from app.services.backup_service import (
    BackupValidationError,
    RestoreTargetNotEmptyError,
    restore_backup_file,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore a Family Tree instance backup")
    parser.add_argument("backup", type=Path, help="Path to the .ftbackup file")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="replace existing instance content and media (destructive)",
    )
    args = parser.parse_args()
    if not args.backup.is_file():
        parser.error(f"Backup file not found: {args.backup}")

    db = SessionLocal()
    try:
        restore_backup_file(db, args.backup, replace=args.replace)
    except (BackupValidationError, RestoreTargetNotEmptyError) as exc:
        print(f"Restore failed: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print("Restore completed and verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
