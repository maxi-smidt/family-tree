"""Bundle version negotiation and forward migration for encrypted tree imports.

Encrypted exports are always encrypted at rest; a user password is optional.
Imports always land in a brand new tree owned by the importing user, with
every id remapped so re-importing never collides with existing data. This
module gets an arbitrary-version bundle up to ``BUNDLE_VERSION`` before
``app.services.interchange.bundles.tree_bundle_import.do_import`` writes any rows.
"""

from __future__ import annotations

from uuid import uuid4

from app.core.exceptions import InvalidInputError
from app.services.interchange.bundles.bundle_types import (
    TreeBundle,
    TreeBundleV2,
    TreeBundleV3,
    TreeBundleV4,
)

# Bundle schema version. Bump this **and** add a ``migrate_bundle`` step whenever
# the exported key set changes; ``test_export_import.py`` snapshots the keys per
# version and fails if they drift without a bump (so this can't be forgotten,
# which is exactly what let a v1.6 bundle silently drop data — see #661).
#   v2 (<= v1.6): sources / source_evidence / citations / story_attachments
#   v3 (v1.7+):   documents / document_files / *_document_links
#   v4 (v1.8+):   gallery_links gain face regions; tasks / task_links
#                 (research tasks); unknown_faces (gallery unknown-person
#                 tags, issue #736)
BUNDLE_VERSION = 4


def _fold_source_description(source: dict, citation_lines: list[str]) -> str | None:
    """Fold a v1.6 source's extra metadata + citations into a document description.

    Mirrors the on-disk v1.7 release migration (``v1_7_0_release``) so importing a
    pre-1.7 bundle preserves the same information a live upgrade would.
    """
    parts: list[str] = []
    notes = (source.get("notes") or "").strip()
    if notes:
        parts.append(notes)
    meta = [
        f"{label}: {source[key]}"
        for key, label in (
            ("author", "Author"),
            ("publication_info", "Publication"),
            ("repository", "Repository"),
        )
        if source.get(key)
    ]
    if meta:
        parts.append("\n".join(meta))
    if citation_lines:
        parts.append("Citations:\n" + "\n".join(citation_lines))
    return "\n\n".join(parts) or None


def _migrate_v2_to_v3(bundle: TreeBundleV2) -> TreeBundleV3:
    """Map a v1.6 (bundle v2) source/citation/attachment payload into Documents.

    Without this, v1.7's import only reads the ``documents`` keys, so a
    pre-1.7 backup's sources, citations, evidence files and story attachments
    would import as an empty tree section — silent data loss (#661).
    """
    sources = bundle.get("sources") or []
    evidence = bundle.get("source_evidence") or []
    citations = bundle.get("citations") or []
    attachments = bundle.get("story_attachments") or []

    member_names: dict[str, str] = {}
    for m in bundle.get("members", []):
        name = " ".join(
            p for p in (m.get("first_name"), m.get("last_name")) if p
        ).strip()
        member_names[m.get("id")] = name or m.get("id")

    citation_lines: dict[str, list[str]] = {}
    member_pairs: dict[tuple, None] = {}
    for c in citations:
        source_id = c.get("source_id")
        member_id = c.get("member_id")
        name = member_names.get(member_id, member_id)
        line = f"- {name} — {c.get('fact_type')}"
        if c.get("page"):
            line += f", page {c['page']}"
        if c.get("detail"):
            line += f": {c['detail']}"
        citation_lines.setdefault(source_id, []).append(line)
        member_pairs.setdefault((source_id, member_id), None)

    documents = [
        {
            "id": s.get("id"),
            "tree_id": s.get("tree_id"),
            "title": s.get("title"),
            "document_date": s.get("source_date"),
            "description": _fold_source_description(
                s, citation_lines.get(s.get("id"), [])
            ),
            "created_at": s.get("created_at"),
            "updated_at": s.get("updated_at"),
        }
        for s in sources
    ]
    document_files = [
        {
            "id": e.get("id"),
            "tree_id": e.get("tree_id"),
            "document_id": e.get("source_id"),
            "kind": e.get("kind"),
            "filename": e.get("filename"),
            "url": e.get("url"),
            "mime_type": e.get("mime_type"),
            "size": e.get("size"),
            "created_at": e.get("created_at"),
        }
        for e in evidence
    ]
    document_member_links = [
        {"document_id": source_id, "member_id": member_id}
        for (source_id, member_id) in member_pairs
    ]

    story_document_links: list[dict] = []
    for a in attachments:
        new_document_id = str(uuid4())
        documents.append(
            {
                "id": new_document_id,
                "tree_id": a.get("tree_id"),
                "title": a.get("filename"),
                "document_date": None,
                "description": None,
                "created_at": a.get("created_at"),
                "updated_at": a.get("created_at"),
            }
        )
        document_files.append(
            {
                "id": a.get("id"),
                "tree_id": a.get("tree_id"),
                "document_id": new_document_id,
                "kind": "file",
                "filename": a.get("filename"),
                "url": a.get("url"),
                "mime_type": a.get("mime_type"),
                "size": a.get("size"),
                "created_at": a.get("created_at"),
            }
        )
        story_document_links.append(
            {"story_id": a.get("story_id"), "document_id": new_document_id}
        )

    migrated = dict(bundle)
    for stale in ("sources", "source_evidence", "citations", "story_attachments"):
        migrated.pop(stale, None)
    migrated["documents"] = documents
    migrated["document_files"] = document_files
    migrated["document_member_links"] = document_member_links
    migrated["event_document_links"] = bundle.get("event_document_links") or []
    migrated["story_document_links"] = story_document_links
    return migrated


def migrate_bundle(bundle: TreeBundle) -> TreeBundleV4:
    """Bring an older bundle up to BUNDLE_VERSION.

    Add a migration step here and bump BUNDLE_VERSION when the bundle schema
    changes.
    """
    if bundle.get("version", 1) < 3:
        # v2 (and any older) → v3: Sources/Citations/Evidence + story attachments
        # become Documents. ``.get(..., [])`` defaults make it safe for a v1
        # bundle that never had these keys.
        bundle = _migrate_v2_to_v3(bundle)
    if bundle.get("version", 1) < 4:
        # v3 → v4: gallery member links gained optional normalized face
        # regions (existing whole-image links deliberately remain null);
        # research tasks (tasks/task_links); gallery unknown-person face
        # tags (unknown_faces). Older bundles simply have none of these.
        migrated = dict(bundle)
        migrated["gallery_links"] = [
            {"x": None, "y": None, "w": None, "h": None, **link}
            for link in bundle.get("gallery_links", [])
        ]
        migrated["tasks"] = bundle.get("tasks", [])
        migrated["task_links"] = bundle.get("task_links", [])
        migrated["unknown_faces"] = bundle.get("unknown_faces", [])
        migrated["version"] = 4
        bundle = migrated
    return bundle


def validate_and_migrate(bundle: TreeBundle) -> TreeBundleV4:
    version = bundle.get("version", 1)
    if version > BUNDLE_VERSION:
        raise InvalidInputError(
            f"This file was created by a newer version of the app "
            f"(bundle v{version}). Please update before importing."
        )
    return migrate_bundle(bundle)
