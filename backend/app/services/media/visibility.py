"""Authorize media bytes through the records that reference their URL."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.models import ContentType, Document, DocumentFile, GalleryImage, Member
from app.services.workspaces.visibility import WorkspaceAccessContext


def require_read_media(
    db: Session, context: WorkspaceAccessContext, media_url: str
) -> None:
    """A scoped reader needs a visible member, gallery image, or document.

    Check before serving bytes and before reusing an existing member-photo
    URL: otherwise an editor could attach a hidden photo to a visible member
    and manufacture the reference that authorizes their next download.
    Staged and orphaned files have no visible parent and stay unavailable to
    scoped readers until attached to an authorized record.
    """
    if context.is_owner_or_admin or (
        context.unrestricted and not any(g.restrictions for g in context.grants)
    ):
        return

    # Portraits belong to the Photos area (#1101): hiding the gallery hides
    # them too, per the grant that reaches each member.
    if not all("gallery" in g.restrictions for g in context.grants):
        members = select(Member.id).where(
            Member.workspace_id == context.workspace_id, Member.image_data == media_url
        )
        member_filter = context.member_filter(domain="gallery")
        if member_filter is not None:
            members = members.where(member_filter)
        if db.scalar(members.limit(1)) is not None:
            return

    gallery = select(GalleryImage.id).where(
        GalleryImage.workspace_id == context.workspace_id,
        GalleryImage.image_data == media_url,
    )
    documents = (
        select(Document.id)
        .join(DocumentFile, DocumentFile.document_id == Document.id)
        .where(
            Document.workspace_id == context.workspace_id,
            DocumentFile.workspace_id == context.workspace_id,
            DocumentFile.kind == "file",
            DocumentFile.url == media_url,
        )
    )
    for statement, content_type, id_column, domain in (
        (gallery, ContentType.GALLERY_IMAGE, GalleryImage.id, "gallery"),
        (documents, ContentType.DOCUMENT, Document.id, "sources"),
    ):
        if all(domain in g.restrictions for g in context.grants):
            continue
        content_filter = context.content_filter(content_type, id_column, domain=domain)
        if content_filter is not None:
            statement = statement.where(content_filter)
        if db.scalar(statement.limit(1)) is not None:
            return

    raise NotFoundError("Media not found")
