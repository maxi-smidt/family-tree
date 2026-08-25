"""Typed shapes for the activity-log delete-snapshot / undo-log payloads.

Companion to ``app.services.activity.activity`` (builds these) and
``app.services.activity.activity_undo`` (reads these). ``ActivityLog.details`` itself
stays an opaque ``Text``/JSON-encoded column — these ``TypedDict``s type the
Python-side shape crossing the service boundary, nothing on the wire.

A ``TypedDict`` is a plain ``dict`` at runtime, so every existing
``snapshot["member"]`` / ``snapshot.get("bridge")``-style access keeps working
unmodified; this module only adds static shape documentation.
"""

from typing import NotRequired, TypedDict

# Value produced by row_to_dict() for one mapped row. Reflection-based over
# arbitrary SQLAlchemy models, so it can't be typed more precisely per-column
# without hand-typing every model's columns — out of scope here.
RowSnapshot = dict[str, object]

# Origin scopes captured before a delete, keyed "<content_type>:<content_id>"
# so one restore can carry the provenance of several records (#1023).
ContentScopes = dict[str, str | None]


class BridgeSnapshot(TypedDict):
    counterpart_member_id: str
    counterpart_workspace_id: str


# ---------------------------------------------------------------------------
# Inner snapshot shapes — what each restore_* receives after the undo route
# unwraps details["snapshot"]. `version` is always present by then (the route
# rejects an unsupported/missing version before any restorer runs).
# ---------------------------------------------------------------------------


class MemberSnapshot(TypedDict):
    version: int
    member: RowSnapshot
    relations: list[RowSnapshot]
    diseases: list[RowSnapshot]
    task_links: list[RowSnapshot]
    event_links: list[RowSnapshot]
    story_links: list[RowSnapshot]
    gallery_links: list[RowSnapshot]
    document_links: list[RowSnapshot]
    bridge: NotRequired[BridgeSnapshot]
    content_scopes: NotRequired[ContentScopes]


class RelationSnapshot(TypedDict):
    version: int
    relation: RowSnapshot


class DiseaseSnapshot(TypedDict):
    version: int
    disease: RowSnapshot
    content_scopes: NotRequired[ContentScopes]


class EventSnapshot(TypedDict):
    version: int
    event: RowSnapshot
    member_links: list[RowSnapshot]
    document_links: list[RowSnapshot]
    content_scopes: NotRequired[ContentScopes]


class StorySnapshot(TypedDict):
    version: int
    story: RowSnapshot
    member_links: list[RowSnapshot]
    document_links: list[RowSnapshot]
    content_scopes: NotRequired[ContentScopes]


class GalleryImageSnapshot(TypedDict):
    version: int
    gallery_image: RowSnapshot
    member_links: list[RowSnapshot]
    trashed_media: list[str]
    content_scopes: NotRequired[ContentScopes]


class DocumentSnapshot(TypedDict):
    version: int
    document: RowSnapshot
    files: list[RowSnapshot]
    member_links: list[RowSnapshot]
    event_links: list[RowSnapshot]
    story_links: list[RowSnapshot]
    trashed_media: list[str]
    content_scopes: NotRequired[ContentScopes]


class DocumentFileSnapshot(TypedDict):
    version: int
    document_file: RowSnapshot
    trashed_media: list[str]


# ---------------------------------------------------------------------------
# Envelope — the delete-snapshot `details` payload each builder returns:
# {"snapshot": {"version": 1, ...}}. Generic so each builder can declare its
# own inner shape (e.g. DeleteSnapshot[MemberSnapshot]) without a dedicated
# wrapper class per domain.
# ---------------------------------------------------------------------------


class DeleteSnapshot[T](TypedDict):
    snapshot: T


# ---------------------------------------------------------------------------
# The other shape sharing the same `details` column: the follow-up log entry
# an undo writes for itself.
# ---------------------------------------------------------------------------


class UndoLogDetails(TypedDict):
    undo_of: str
    restored: dict[str, str | int]
    skipped: list[dict[str, object]]
