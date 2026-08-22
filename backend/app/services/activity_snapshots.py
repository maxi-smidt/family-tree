"""Typed shapes for the activity-log delete-snapshot / undo-log payloads.

Companion to ``app.services.activity`` (builds these) and
``app.services.activity_undo`` (reads these). ``ActivityLog.details`` itself
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


class BridgeSnapshot(TypedDict):
    counterpart_member_id: str
    counterpart_tree_id: str


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


class RelationSnapshot(TypedDict):
    version: int
    relation: RowSnapshot


class DiseaseSnapshot(TypedDict):
    version: int
    disease: RowSnapshot


class EventSnapshot(TypedDict):
    version: int
    event: RowSnapshot
    member_links: list[RowSnapshot]
    document_links: list[RowSnapshot]


class StorySnapshot(TypedDict):
    version: int
    story: RowSnapshot
    member_links: list[RowSnapshot]
    document_links: list[RowSnapshot]


class GalleryImageSnapshot(TypedDict):
    version: int
    gallery_image: RowSnapshot
    member_links: list[RowSnapshot]
    trashed_media: list[str]


class DocumentSnapshot(TypedDict):
    version: int
    document: RowSnapshot
    files: list[RowSnapshot]
    member_links: list[RowSnapshot]
    event_links: list[RowSnapshot]
    story_links: list[RowSnapshot]
    trashed_media: list[str]


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
