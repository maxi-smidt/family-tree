"""Per-owner storage usage calculation and quota enforcement.

Usage is computed on read (no cached counters) so it stays consistent after
all delete/cascade paths. Quotas are stored on the User as nullable BigInteger
columns (NULL → fall back to instance default; 0 or None after fallback = unlimited).
"""

from __future__ import annotations

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
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation
from app.models.tree import Tree
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


def _tree_model_bytes_for_tree_ids(db: Session, tree_ids: list[str]) -> int:
    """Sum structured-row bytes for the supplied tree IDs in batched queries.

    Covers every model that carries ``tree_id``:
    Member, Relation, MemberDisease, GalleryImage, GalleryMemberLink,
    Event, EventMemberLink, Story, StoryMemberLink,
    Document, DocumentFile, DocumentMemberLink, EventDocumentLink,
    StoryDocumentLink.
    """
    if not tree_ids:
        return 0

    total = 0

    def _sum_model(model_cls, filter_col):
        rows = db.scalars(
            sa.select(model_cls).where(filter_col.in_(tree_ids))
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
        ).where(GalleryImage.tree_id.in_(tree_ids))
    ).scalars().all()
    total += sum(_row_bytes(r) for r in links)

    # Events
    total += _sum_model(Event, Event.tree_id)
    ev_links = db.execute(
        sa.select(EventMemberLink).join(
            Event, Event.id == EventMemberLink.event_id
        ).where(Event.tree_id.in_(tree_ids))
    ).scalars().all()
    total += sum(_row_bytes(r) for r in ev_links)

    # Stories
    total += _sum_model(Story, Story.tree_id)
    story_links = db.execute(
        sa.select(StoryMemberLink).join(
            Story, Story.id == StoryMemberLink.story_id
        ).where(Story.tree_id.in_(tree_ids))
    ).scalars().all()
    total += sum(_row_bytes(r) for r in story_links)

    # Documents
    total += _sum_model(Document, Document.tree_id)
    total += _sum_model(DocumentFile, DocumentFile.tree_id)
    # The three document link tables have no tree_id column — traverse via
    # Document, which always carries one.
    doc_member_links = db.execute(
        sa.select(DocumentMemberLink).join(
            Document, Document.id == DocumentMemberLink.document_id
        ).where(Document.tree_id.in_(tree_ids))
    ).scalars().all()
    total += sum(_row_bytes(r) for r in doc_member_links)
    event_doc_links = db.execute(
        sa.select(EventDocumentLink).join(
            Document, Document.id == EventDocumentLink.document_id
        ).where(Document.tree_id.in_(tree_ids))
    ).scalars().all()
    total += sum(_row_bytes(r) for r in event_doc_links)
    story_doc_links = db.execute(
        sa.select(StoryDocumentLink).join(
            Document, Document.id == StoryDocumentLink.document_id
        ).where(Document.tree_id.in_(tree_ids))
    ).scalars().all()
    total += sum(_row_bytes(r) for r in story_doc_links)

    return total


def _tree_model_bytes(db: Session, tree_id: str) -> int:
    """Sum the estimated byte footprint of all structured rows for *tree_id*."""
    return _tree_model_bytes_for_tree_ids(db, [tree_id])


def _media_bytes(tree_id: str) -> int:
    """Sum on-disk file sizes under ``media_root/<tree_id>/``.

    Counts files in the tree directory and in the ``originals/`` subdirectory
    used by gallery ``"both"`` mode. Returns 0 when the directory does not
    exist (e.g. tree has no media).
    """
    tree_dir = settings.media_root / tree_id
    if not tree_dir.is_dir():
        return 0
    total = 0
    try:
        for entry in tree_dir.rglob("*"):
            if not entry.is_symlink() and entry.is_file():
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


def compute_owner_usage(db: Session, owner_id: str) -> dict[str, int]:
    """Return combined usage for every tree owned by *owner_id*.

    Structured rows are summed using one query per model across all owned tree
    IDs. Media files remain filesystem-backed, so their directories are walked
    once each.
    """
    tree_ids = list(
        db.scalars(sa.select(Tree.id).where(Tree.owner_id == owner_id))
    )
    tb = _tree_model_bytes_for_tree_ids(db, tree_ids)
    mb = sum(_media_bytes(tree_id) for tree_id in tree_ids)
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
    """Raise QuotaExceeded if media would exceed the owner's total quota."""
    quotas = owner_quotas(db, tree)
    if quotas["media_quota_bytes"] is None:
        return  # unlimited — fast path

    usage = compute_owner_usage(db, tree.owner_id)
    _check_bucket(
        "media", quotas["media_quota_bytes"], usage["media_bytes"], incoming_bytes
    )


def check_tree_quota(db: Session, tree, incoming_bytes: int) -> None:
    """Raise QuotaExceeded if data would exceed the owner's total quota."""
    quotas = owner_quotas(db, tree)
    if quotas["tree_quota_bytes"] is None:
        return  # unlimited — fast path

    usage = compute_owner_usage(db, tree.owner_id)
    _check_bucket(
        "tree", quotas["tree_quota_bytes"], usage["tree_bytes"], incoming_bytes
    )


_WARNING_THRESHOLD = 0.9


def media_warning(db: Session, tree) -> dict | None:
    """Return a warning when owner media usage reaches 90 % of quota.

    Returns None when the quota is unlimited or usage is below the threshold.
    """
    quotas = owner_quotas(db, tree)
    quota = quotas["media_quota_bytes"]
    if quota is None:
        return None  # unlimited
    usage = compute_owner_usage(db, tree.owner_id)
    used = usage["media_bytes"]
    if used >= quota * _WARNING_THRESHOLD:
        return {"tree_id": tree.id, "used_bytes": used, "quota_bytes": quota}
    return None


def check_full_usage_quota(db: Session, tree) -> None:
    """Raise QuotaExceeded if the owner's current usage exceeds a quota.

    Unlike check_tree_quota/check_media_quota (which project an additional
    increment before a row is added), this verifies the fully-materialised
    state and is meant for bulk operations such as import, where all rows and
    media files have already been written/flushed. The caller is responsible
    for rolling back (DB + media) when this raises.
    """
    quotas = owner_quotas(db, tree)
    if all(v is None for v in quotas.values()):
        return  # everything unlimited — fast path

    usage = compute_owner_usage(db, tree.owner_id)
    _check_bucket("tree", quotas["tree_quota_bytes"], usage["tree_bytes"], 0)
    _check_bucket("media", quotas["media_quota_bytes"], usage["media_bytes"], 0)
