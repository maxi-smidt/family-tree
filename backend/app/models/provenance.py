"""Content provenance: the authorization origin scope of every content record.

Section membership alone cannot decide who may read a piece of content. A
boundary member belongs to several sections at once, so inferring a record's
audience from the member's *current* membership lets content that originated
in section A reach section B's collaborators the moment the member joins B.

Every content record therefore carries its own origin scope, recorded once
when the record is created and changed only through an explicit, audited
re-scope (see ``app.services.provenance``).

Not every table needs a row here. A record whose audience is fully determined
by a single parent gets its scope from that parent instead:

- ``document_files``, ``gallery_member_link``, ``gallery_unknown_faces`` —
  one owning document/image;
- ``relations`` — their two member endpoints;
- ``members`` — section membership itself.
"""

from enum import StrEnum

from sqlalchemy import ForeignKey, ForeignKeyConstraint, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow_iso


class ContentType(StrEnum):
    """The content domains that carry an independent origin scope."""

    EVENT = "event"
    STORY = "story"
    DOCUMENT = "document"
    GALLERY_IMAGE = "gallery_image"
    TASK = "task"
    DISEASE = "disease"


class ContentScope(Base):
    """Where one content record came from: a section, or the whole workspace.

    ``section_id`` NULL means workspace-wide origin — the record was created
    outside any section context and every principal with workspace access may
    see it. A non-NULL ``section_id`` restricts its audience to that section's
    scope; widening it back to workspace-wide is an owner action, never a side
    effect of a membership or link change.
    """

    __tablename__ = "content_scopes"
    __table_args__ = (
        # A composite FK against ``sections (workspace_id, id)`` so the database
        # itself rejects a scope pointing into another workspace. The default
        # MATCH SIMPLE semantics leave the pair unchecked when ``section_id`` is
        # NULL, which is exactly the workspace-wide case. RESTRICT keeps section
        # deletion from silently promoting scoped content to workspace-wide —
        # the caller must reassign or remove it first.
        ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            ondelete="RESTRICT",
            name="fk_content_scopes_section",
        ),
        Index(
            "ix_content_scopes_workspace_id_section_id", "workspace_id", "section_id"
        ),
    )

    content_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    content_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    section_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
