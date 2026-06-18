"""Per-tree storage usage calculation and quota enforcement.

Usage is computed on read (no cached counters) so it stays consistent after
all delete/cascade paths. Quotas are stored on the User as nullable BigInteger
columns (NULL → fall back to instance default; 0 or None after fallback = unlimited).
"""

from __future__ import annotations

import os
from typing import Literal

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.media_config import (
    DEFAULT_MEDIA_QUOTA_MB,
    DEFAULT_TREE_QUOTA_MB,
    MEBIBYTE,
)
from app.models.content import (
    Citation,
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Source,
    SourceEvidence,
    Story,
    StoryAttachment,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation
from app.services.settings_service import get_int_setting

# ---------------------------------------------------------------------------
# Usage calculation
# ---------------------------------------------------------------------------

def _row_bytes(obj: object) -> int:
    """Estimate the byte footprint of a single ORM row.

    Sums ``len(str(value).encode())`` for every non-None persisted column value.
    This is a deliberately rough, backend-agnostic estimate used only for
    relative quota accounting: it runs identically on SQLite and Postgres but
    does not reflect on-disk storage exactly (``str(value)`` is the Python
    representation, not the DB-serialised form). It stays consistent after
    deletes because it is recomputed from the live rows on every read.
    """
    mapper = sa.inspect(type(obj)).mapper  # type: ignore[arg-type]
    total = 0
    for col in mapper.columns:
        value = getattr(obj, col.key, None)
        if value is not None:
            total += len(str(value).encode())
    return total


def _tree_model_bytes(db: Session, tree_id: str) -> int:
    """Sum the estimated byte footprint of all structured rows for *tree_id*.

    Covers every model that carries ``tree_id``:
    Member, Relation, MemberDisease, GalleryImage, GalleryMemberLink,
    Event, EventMemberLink, Story, StoryAttachment, StoryMemberLink,
    Source, SourceEvidence, Citation.
    """
    total = 0

    def _sum_model(model_cls, filter_col):
        rows = db.scalars(
            sa.select(model_cls).where(filter_col == tree_id)
        ).all()
        return sum(_row_bytes(r) for r in rows)

    # Core genealogy
    total += _sum_model(Member, Member.tree_id)
    total += _sum_model(Relation, Relation.tree_id)
    total += _sum_model(MemberDisease, MemberDisease.tree_id)

    # Gallery
    total += _sum_model(GalleryImage, GalleryImage.tree_id)
    # GalleryMemberLink has no tree_id column — traverse via GalleryImage
    links = db.execute(
        sa.select(GalleryMemberLink).join(
            GalleryImage, GalleryImage.id == GalleryMemberLink.gallery_image_id
        ).where(GalleryImage.tree_id == tree_id)
    ).scalars().all()
    total += sum(_row_bytes(r) for r in links)

    # Events
    total += _sum_model(Event, Event.tree_id)
    ev_links = db.execute(
        sa.select(EventMemberLink).join(
            Event, Event.id == EventMemberLink.event_id
        ).where(Event.tree_id == tree_id)
    ).scalars().all()
    total += sum(_row_bytes(r) for r in ev_links)

    # Stories
    total += _sum_model(Story, Story.tree_id)
    total += _sum_model(StoryAttachment, StoryAttachment.tree_id)
    story_links = db.execute(
        sa.select(StoryMemberLink).join(
            Story, Story.id == StoryMemberLink.story_id
        ).where(Story.tree_id == tree_id)
    ).scalars().all()
    total += sum(_row_bytes(r) for r in story_links)

    # Sources
    total += _sum_model(Source, Source.tree_id)
    total += _sum_model(SourceEvidence, SourceEvidence.tree_id)
    total += _sum_model(Citation, Citation.tree_id)

    return total


def _media_bytes(tree_id: str) -> int:
    """Sum on-disk file sizes directly under ``media_root/<tree_id>/``.

    All tree media is stored as flat files in this single directory, so a
    one-level scan is sufficient. Returns 0 when the directory does not exist
    (e.g. tree has no media).
    """
    tree_dir = settings.media_root / tree_id
    if not tree_dir.is_dir():
        return 0
    total = 0
    try:
        with os.scandir(tree_dir) as it:
            for entry in it:
                if entry.is_file(follow_symlinks=False):
                    try:
                        total += entry.stat().st_size
                    except OSError:
                        pass
    except OSError:
        pass
    return total


def compute_usage(db: Session, tree_id: str) -> dict[str, int]:
    """Return ``{tree_bytes, media_bytes, total_bytes}`` for *tree_id*."""
    tb = _tree_model_bytes(db, tree_id)
    mb = _media_bytes(tree_id)
    return {"tree_bytes": tb, "media_bytes": mb, "total_bytes": tb + mb}


# ---------------------------------------------------------------------------
# Quota resolution
# ---------------------------------------------------------------------------

def _instance_quota_bytes(db: Session, key_mb: str, default_mb: int) -> int | None:
    """Read an instance-level quota in MB and convert to bytes.

    Returns ``None`` when the effective value is 0 (= unlimited).
    """
    mb = get_int_setting(db, key_mb, default_mb)
    if mb <= 0:
        return None
    return mb * MEBIBYTE


def owner_quotas(db: Session, tree) -> dict[str, int | None]:
    """Resolve effective quota limits for *tree*'s owner.

    Reads the three quota columns from the owner User row; falls back to the
    instance-default settings when a column is NULL; returns None when the
    effective value is 0 (= unlimited).
    """
    from app.models.user import User  # avoid circular at module level

    owner = db.get(User, tree.owner_id)
    if owner is None:
        return {
            "tree_quota_bytes": None,
            "media_quota_bytes": None,
        }

    def _resolve(user_col: int | None, instance_key: str, default_mb: int) -> int | None:
        if user_col is not None:
            return user_col if user_col > 0 else None
        return _instance_quota_bytes(db, instance_key, default_mb)

    return {
        "tree_quota_bytes": _resolve(
            owner.tree_quota_bytes, "default_tree_quota_mb", DEFAULT_TREE_QUOTA_MB
        ),
        "media_quota_bytes": _resolve(
            owner.media_quota_bytes, "default_media_quota_mb", DEFAULT_MEDIA_QUOTA_MB
        ),
    }


# ---------------------------------------------------------------------------
# Quota enforcement
# ---------------------------------------------------------------------------

class QuotaExceeded(ValueError):
    """Raised when a write would push usage past a quota limit."""

    def __init__(
        self,
        bucket: Literal["tree", "media"],
        limit_bytes: int,
        current_bytes: int,
        would_be_bytes: int,
    ) -> None:
        self.bucket = bucket
        self.limit_bytes = limit_bytes
        self.current_bytes = current_bytes
        self.would_be_bytes = would_be_bytes
        super().__init__(
            f"quota_exceeded_{bucket}"
        )


def _check_bucket(
    bucket: Literal["tree", "media"],
    quota: int | None,
    current: int,
    incoming: int,
) -> None:
    if quota is None:
        return
    would_be = current + incoming
    if would_be > quota:
        raise QuotaExceeded(bucket, quota, current, would_be)


def check_media_quota(db: Session, tree, incoming_bytes: int) -> None:
    """Raise QuotaExceeded if adding *incoming_bytes* of media would exceed quota."""
    quotas = owner_quotas(db, tree)
    if quotas["media_quota_bytes"] is None:
        return  # unlimited — fast path

    usage = compute_usage(db, tree.id)
    _check_bucket(
        "media", quotas["media_quota_bytes"], usage["media_bytes"], incoming_bytes
    )


def check_tree_quota(db: Session, tree, incoming_bytes: int) -> None:
    """Raise QuotaExceeded if adding *incoming_bytes* of tree data would exceed quota."""
    quotas = owner_quotas(db, tree)
    if quotas["tree_quota_bytes"] is None:
        return  # unlimited — fast path

    usage = compute_usage(db, tree.id)
    _check_bucket(
        "tree", quotas["tree_quota_bytes"], usage["tree_bytes"], incoming_bytes
    )


def check_full_usage_quota(db: Session, tree) -> None:
    """Raise QuotaExceeded if the tree's *current* usage already exceeds quota.

    Unlike check_tree_quota/check_media_quota (which project an additional
    increment before a row is added), this verifies the fully-materialised
    state and is meant for bulk operations such as import, where all rows and
    media files have already been written/flushed. The caller is responsible
    for rolling back (DB + media) when this raises.
    """
    quotas = owner_quotas(db, tree)
    if all(v is None for v in quotas.values()):
        return  # everything unlimited — fast path

    usage = compute_usage(db, tree.id)
    _check_bucket("tree", quotas["tree_quota_bytes"], usage["tree_bytes"], 0)
    _check_bucket("media", quotas["media_quota_bytes"], usage["media_bytes"], 0)

