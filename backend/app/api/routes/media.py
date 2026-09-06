"""Workspace-authorized media serving.

Replaces the bare StaticFiles mount so every media request is gated behind the
same tree-read-access check used by all other routes, including public-tree
access and its short-lived password-unlock token.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_workspace_public
from app.core.config import settings
from app.db.session import get_db
from app.models import DocumentFile, Workspace

router = APIRouter(tags=["media"])

_MIME: dict[str, str] = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
    "avif": "image/avif",
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "md": "text/markdown",
    "rtf": "application/rtf",
}


@router.get("/media/{workspace_id}/{filename}")
def serve_media(
    filename: str,
    download: bool = False,
    tree: Workspace = Depends(get_readable_workspace_public),
    db: Session = Depends(get_db),
) -> FileResponse:
    # Reject any attempt to escape the tree directory via path components.
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Not found")

    path: Path = (settings.media_root / tree.id / filename).resolve()
    media_root = settings.media_root.resolve()

    # Guard path traversal: the resolved path must be a direct child of the
    # media_root/<workspace_id> directory.
    if path.parent != (media_root / tree.id).resolve():
        raise HTTPException(status_code=404, detail="Not found")

    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")

    ext = path.suffix.lstrip(".").lower()
    mime = _MIME.get(ext, "application/octet-stream")

    # Inline media must stay on the hot path: member photos and gallery images
    # do not have DocumentFile rows, so looking one up would be wasted work.
    # Only explicit document downloads need the original upload name. FileResponse
    # sets Content-Disposition and RFC 5987-encodes non-ASCII names for them.
    original_name = None
    if download:
        media_url = f"{settings.API_PREFIX}/media/{tree.id}/{filename}"
        original_name = db.scalar(
            select(DocumentFile.filename).where(
                DocumentFile.workspace_id == tree.id,
                DocumentFile.url == media_url,
                DocumentFile.kind == "file",
                DocumentFile.filename.is_not(None),
            )
        )

    return FileResponse(path, media_type=mime, filename=original_name)
