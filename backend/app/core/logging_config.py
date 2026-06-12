"""Application-wide logging.

Every logger (app, alembic, uvicorn, ...) propagates to the root logger, which
writes to the console and to a size-rotated file under ``APP_DATA_PATH/logs``
— in Docker that directory is on the mounted appdata volume, so logs survive
container restarts.
"""

import logging
from logging.handlers import RotatingFileHandler

from app.core.config import settings

LOG_FORMAT = "%(asctime)s %(levelname)-8s [%(name)s] %(message)s"
LOG_FILE_MAX_BYTES = 5 * 1024 * 1024
LOG_FILE_BACKUP_COUNT = 5


def setup_logging() -> None:
    formatter = logging.Formatter(LOG_FORMAT)

    console = logging.StreamHandler()
    console.setFormatter(formatter)

    log_dir = settings.APP_DATA_PATH / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(
        log_dir / "backend.log",
        maxBytes=LOG_FILE_MAX_BYTES,
        backupCount=LOG_FILE_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers = [console, file_handler]

    # Uvicorn installs its own handlers; strip them so its records flow through
    # the root handlers above and end up in the log file too.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
