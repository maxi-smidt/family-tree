"""Authenticated media serving.

Replaces the bare StaticFiles mount so every media request is gated
behind the same JWT + tree-read-access check used by all other routes.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.api.deps import get_readable_tree
from app.core.config import settings
from app.models import Tree

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


@router.get("/media/{tree_id}/{filename}")
def serve_media(
    filename: str,
    tree: Tree = Depends(get_readable_tree),
) -> FileResponse:
    # Reject any attempt to escape the tree directory via path components.
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Not found")

    path: Path = (settings.media_root / tree.id / filename).resolve()
    media_root = settings.media_root.resolve()

    # Guard path traversal: resolved path must be a direct child of media_root/<tree_id>.
    if path.parent != (media_root / tree.id).resolve():
        raise HTTPException(status_code=404, detail="Not found")

    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")

    ext = path.suffix.lstrip(".").lower()
    mime = _MIME.get(ext, "application/octet-stream")
    return FileResponse(path, media_type=mime)
