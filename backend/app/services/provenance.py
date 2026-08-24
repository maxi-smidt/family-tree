"""Recording and querying content provenance (#1023).

Provenance is written at a single choke point: a ``before_flush`` listener
stamps every newly inserted content row with the origin scope bound to its
session, and drops the scope of every content row that goes away. No route
has to remember to do it, so content created by an import, a merge copy, a
GEDCOM load, or a background job is scoped just as deterministically as
content created from a section canvas.

The origin bound to a session comes from ``bind_origin_section`` (called by
the writable-workspace dependency). Anything else — jobs, scripts, restores
that predate a section — defaults to workspace-wide, the widest scope that
still matches how the record was actually created.

Two invariants hold the model together:

- **Record once.** A scope is written when the record is created and is never
  recomputed. Linking a boundary member, moving them between sections, or
  merging two members therefore cannot widen an existing record's audience.
- **Widening is explicit.** Only ``rescope_content`` (owner-authorized and
  audited) changes a scope, and section deletion is RESTRICTed rather than
  cascading scoped content into workspace-wide access.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.core.exceptions import InvalidInputError, NotFoundError
from app.db.base import utcnow_iso
from app.models import (
    ContentScope,
    ContentType,
    Document,
    Event,
    GalleryImage,
    Member,
    MemberDisease,
    MemberTask,
    Section,
    Story,
    Workspace,
    WorkspaceMembership,
)

# Content models that carry an independent origin scope. Anything not listed
# here inherits its audience from a parent — see ``models.provenance``.
TRACKED_MODELS: dict[type, ContentType] = {
    Event: ContentType.EVENT,
    Story: ContentType.STORY,
    Document: ContentType.DOCUMENT,
    GalleryImage: ContentType.GALLERY_IMAGE,
    MemberTask: ContentType.TASK,
    MemberDisease: ContentType.DISEASE,
}

_ORIGIN_KEY = "provenance_origin_section_id"

# Serialized form used inside activity snapshots: "<content_type>:<content_id>".
ScopeSnapshot = dict[str, str | None]


# ---------------------------------------------------------------------------
# Session-bound origin
# ---------------------------------------------------------------------------


def bind_origin_section(db: Session, section_id: str | None) -> None:
    """Bind the origin scope that this session's new content inherits."""
    db.info[_ORIGIN_KEY] = section_id


def origin_section(db: Session) -> str | None:
    return db.info.get(_ORIGIN_KEY)


def resolve_origin_section(
    db: Session,
    tree: Workspace,
    requested_section_id: str | None,
    *,
    permitted_section_ids: set[str] | None = None,
) -> str | None:
    """Validate a requested origin scope, or derive one deterministically.

    ``permitted_section_ids`` is the caller's own scope: ``None`` means
    whole-workspace access, and is what every principal has until #993
    introduces section-scoped grants. A scoped caller can never end up with a
    workspace-wide origin, so they cannot create content that is visible to
    more people than they are.
    """
    if requested_section_id is not None:
        section = db.get(Section, requested_section_id)
        if section is None or section.workspace_id != tree.id:
            raise NotFoundError("Section not found")
        if (
            permitted_section_ids is not None
            and requested_section_id not in permitted_section_ids
        ):
            raise InvalidInputError("Section is outside your access scope")
        return requested_section_id
    if permitted_section_ids is None:
        return None
    # A scoped caller with no stated context lands in their first permitted
    # section by display order — narrow and reproducible, never workspace-wide.
    return db.scalar(
        select(Section.id)
        .where(Section.workspace_id == tree.id, Section.id.in_(permitted_section_ids))
        .order_by(Section.position, Section.created_at, Section.id)
        .limit(1)
    )


# ---------------------------------------------------------------------------
# Reading and writing scopes
# ---------------------------------------------------------------------------


def _pending_scope_keys(db: Session) -> set[tuple[str, str]]:
    return {
        (obj.content_type, obj.content_id)
        for obj in db.new
        if isinstance(obj, ContentScope)
    }


def _add_scope(
    db: Session,
    pending: set[tuple[str, str]],
    *,
    workspace_id: str,
    content_type: ContentType,
    content_id: str,
    section_id: str | None,
) -> None:
    key = (str(content_type), content_id)
    if key in pending or db.get(ContentScope, key) is not None:
        return
    pending.add(key)
    db.add(
        ContentScope(
            content_type=key[0],
            content_id=content_id,
            workspace_id=workspace_id,
            section_id=section_id,
            created_at=utcnow_iso(),
        )
    )


def record_scope(
    db: Session,
    *,
    workspace_id: str,
    content_type: ContentType,
    content_id: str,
    section_id: str | None,
) -> None:
    """Record an origin scope unless this record already has one.

    Insert-if-absent rather than upsert: a scope is a record's origin, so a
    second write must not be able to move it.
    """
    _add_scope(
        db,
        _pending_scope_keys(db),
        workspace_id=workspace_id,
        content_type=content_type,
        content_id=content_id,
        section_id=section_id,
    )


def scope_of(
    db: Session, content_type: ContentType, content_id: str
) -> ContentScope | None:
    return db.get(ContentScope, (str(content_type), content_id))


def scope_snapshot(
    db: Session, pairs: Iterable[tuple[ContentType, str]]
) -> ScopeSnapshot:
    """The origin scopes of ``pairs``, in the form activity snapshots store."""
    snapshot: ScopeSnapshot = {}
    for content_type, content_id in pairs:
        scope = scope_of(db, content_type, content_id)
        if scope is not None:
            snapshot[f"{content_type}:{content_id}"] = scope.section_id
    return snapshot


def restore_scopes(db: Session, tree: Workspace, snapshot: ScopeSnapshot) -> None:
    """Re-record the scopes captured by ``scope_snapshot`` before a delete.

    Called while restoring the content rows themselves, so the flush listener
    finds these already pending and leaves them alone. A section that has been
    deleted meanwhile can no longer hold content, so that record comes back
    workspace-wide rather than blocking the undo.
    """
    if not snapshot:
        return
    live_sections = set(
        db.scalars(select(Section.id).where(Section.workspace_id == tree.id))
    )
    for key, section_id in snapshot.items():
        content_type, _, content_id = key.partition(":")
        record_scope(
            db,
            workspace_id=tree.id,
            content_type=ContentType(content_type),
            content_id=content_id,
            section_id=section_id if section_id in live_sections else None,
        )


def section_scope_counts(db: Session, section_id: str) -> dict[str, int]:
    """How much content originates in ``section_id``, per content type."""
    return dict(
        db.execute(
            select(ContentScope.content_type, func.count())
            .where(ContentScope.section_id == section_id)
            .group_by(ContentScope.content_type)
        ).all()
    )


def reassign_section_scopes(
    db: Session, *, from_section_id: str, to_section_id: str
) -> int:
    """Move every scope on ``from_section_id`` to ``to_section_id``."""
    return (
        db.query(ContentScope)
        .filter(ContentScope.section_id == from_section_id)
        .update({ContentScope.section_id: to_section_id}, synchronize_session=False)
    )


def rescope_content(
    db: Session,
    tree: Workspace,
    *,
    content_type: ContentType,
    content_id: str,
    section_id: str | None,
) -> ContentScope:
    """Move one record's origin scope. Owner-authorized at the route layer."""
    scope = scope_of(db, content_type, content_id)
    if scope is None or scope.workspace_id != tree.id:
        raise NotFoundError("Content scope not found")
    if section_id is not None:
        section = db.get(Section, section_id)
        if section is None or section.workspace_id != tree.id:
            raise NotFoundError("Section not found")
    scope.section_id = section_id
    return scope


def scope_audience(db: Session, tree: Workspace, section_id: str | None) -> list[str]:
    """The principals that can read content in this scope, sorted.

    ``section_id`` is accepted but does not narrow the result yet: section
    scoping of *grants* arrives with #993, so today every principal with
    workspace access reads the whole workspace and both sides of a re-scope
    preview report the same audience. That is the truth right now, and it
    becomes a real difference without this function or its callers changing
    shape.
    """
    del section_id
    principals = {tree.owner_id}
    principals.update(
        db.scalars(
            select(WorkspaceMembership.user_id).where(
                WorkspaceMembership.workspace_id == tree.id
            )
        )
    )
    if tree.public_role:
        principals.add("public")
    return sorted(principals)


# ---------------------------------------------------------------------------
# The flush listener
# ---------------------------------------------------------------------------


def _record_new_content(db: Session) -> None:
    section_id = origin_section(db)
    pending = _pending_scope_keys(db)
    for obj in list(db.new):
        content_type = TRACKED_MODELS.get(type(obj))
        if content_type is None:
            continue
        _add_scope(
            db,
            pending,
            workspace_id=obj.workspace_id,
            content_type=content_type,
            content_id=obj.id,
            section_id=section_id,
        )


def _drop_deleted_content(db: Session) -> None:
    keys: list[tuple[str, str]] = []
    member_ids: list[str] = []
    for obj in db.deleted:
        content_type = TRACKED_MODELS.get(type(obj))
        if content_type is not None:
            keys.append((str(content_type), obj.id))
        elif isinstance(obj, Member):
            # Diseases are the one tracked domain a member takes with them
            # through a database-level cascade, which raises no ORM event.
            member_ids.append(obj.id)
    if member_ids:
        keys.extend(
            (str(ContentType.DISEASE), disease_id)
            for disease_id in db.scalars(
                select(MemberDisease.id).where(MemberDisease.member_id.in_(member_ids))
            )
        )
    for content_type, content_id in keys:
        scope = db.get(ContentScope, (content_type, content_id))
        if scope is not None:
            db.delete(scope)


def _before_flush(db: Session, _flush_context: object, _instances: object) -> None:
    _drop_deleted_content(db)
    _record_new_content(db)


def install_provenance_hooks() -> None:
    """Register the flush listener once, for every session in the process."""
    if not event.contains(Session, "before_flush", _before_flush):
        event.listen(Session, "before_flush", _before_flush)
