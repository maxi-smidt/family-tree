"""Declarative base and shared helpers for ORM models."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def new_uuid() -> str:
    return str(uuid4())


def utcnow_iso() -> str:
    """ISO-8601 timestamp, matching the format produced by the old frontend."""
    return datetime.now(timezone.utc).isoformat()
