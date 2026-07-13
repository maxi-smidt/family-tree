"""Schemas for gallery images, events and stories (frontend `*DB` shapes).

``GalleryImage*`` schemas use the camelCase alias-generator base classes
because the frontend reads/writes ``imageData``, ``createdAt``, ``uploadedAt``.
All other schemas are intentionally snake_case end-to-end.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import FamilyTreeBaseModel, FamilyTreeOrmBaseModel


# --- Gallery ---------------------------------------------------------------
class GalleryImageOut(FamilyTreeOrmBaseModel):
    id: str
    image_data: str | None = None
    title: str | None = None
    description: str | None = None
    created_at: str | None = None
    uploaded_at: str | None = None


class GalleryImageCreate(FamilyTreeBaseModel):
    id: str
    image_data: str | None = None
    title: str | None = None
    description: str | None = None
    created_at: str | None = None
    uploaded_at: str | None = None
    # Members to link the new image to, in a single request.
    member_ids: list[str] = []


class GalleryImageUpdate(FamilyTreeBaseModel):
    image_data: str | None = None
    title: str | None = None
    description: str | None = None


class LinksSet(BaseModel):
    """Replace the full set of members linked to a content item."""

    member_ids: list[str] = []


# --- Events ----------------------------------------------------------------
class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_type: str
    date: str
    location: str | None = None
    description: str | None = None
    created_at: str
    document_ids: list[str] = []


class EventCreate(BaseModel):
    id: str
    event_type: str
    date: str
    location: str | None = None
    description: str | None = None
    created_at: str
    member_ids: list[str] = []


class EventUpdate(BaseModel):
    event_type: str
    date: str
    location: str | None = None
    description: str | None = None


# --- Stories ---------------------------------------------------------------
class StoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    content: str | None = None
    date: str | None = None
    created_at: str
    updated_at: str
    document_ids: list[str] = []


class StoryCreate(BaseModel):
    id: str
    title: str
    content: str | None = None
    date: str | None = None
    created_at: str
    updated_at: str
    member_ids: list[str] = []


class StoryUpdate(BaseModel):
    title: str
    content: str | None = None
    date: str | None = None
    updated_at: str


class DocumentIdsSet(BaseModel):
    """Replace the full set of documents linked to an event or story."""

    document_ids: list[str] = []


# --- Geocode ---------------------------------------------------------------
class GeocodeOut(BaseModel):
    query: str
    lat: float | None = None
    lon: float | None = None
    display_name: str | None = None
    resolved: bool
    manual: bool = False


class GeocodeRequest(BaseModel):
    locations: list[str] = []


class GeocodeOverrideRequest(BaseModel):
    query: str
    lat: float
    lon: float
    display_name: str | None = None


class GeocodeCandidate(BaseModel):
    lat: float
    lon: float
    display_name: str


# --- Member link rows (returned by the *_link list endpoints) --------------
class GalleryLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    gallery_image_id: str
    member_id: str


class EventLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event_id: str
    member_id: str


class StoryLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    story_id: str
    member_id: str


# --- Documents ---------------------------------------------------------------
class DocumentFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    filename: str | None = None
    url: str
    mime_type: str | None = None
    size: int | None = None
    created_at: str


class DocumentLinkCreate(BaseModel):
    url: str = Field(max_length=2048)
    filename: str | None = None


class DocumentFileUpdate(BaseModel):
    filename: str


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str | None = None
    document_date: str | None = None
    created_at: str
    updated_at: str
    files: list[DocumentFileOut] = []
    member_ids: list[str] = []
    event_ids: list[str] = []
    story_ids: list[str] = []


class DocumentCreate(BaseModel):
    title: str
    description: str | None = None
    document_date: str | None = None
    member_ids: list[str] = []


class DocumentUpdate(BaseModel):
    title: str
    description: str | None = None
    document_date: str | None = None


# --- Documents: staged upload + atomic composite save ------------------------
class DocumentUploadOut(BaseModel):
    """A file streamed to the staging area, ready to attach in a save."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str | None = None
    mime_type: str | None = None
    size: int | None = None


class DocumentLinkAdd(BaseModel):
    """A new external link in a composite save.

    ``id`` is a client-generated UUID reused as the ``DocumentFile`` primary
    key, so replaying the same save neither duplicates nor re-validates it.
    """

    id: str
    url: str = Field(max_length=2048)
    filename: str | None = None


class DocumentFileRename(BaseModel):
    id: str
    filename: str


class DocumentSave(BaseModel):
    """The full set of changes to apply to a document in one transaction.

    Files are uploaded to the staging area first (streamed, memory-bounded) and
    referenced here by ``attached_upload_ids``; the save attaches them alongside
    the metadata, people links, removals and renames so the whole edit commits
    or fails as a unit. Every change is keyed by a client-supplied id, so
    replaying the request is a no-op.
    """

    title: str
    description: str | None = None
    document_date: str | None = None
    member_ids: list[str] = []
    attached_upload_ids: list[str] = []
    added_links: list[DocumentLinkAdd] = []
    removed_file_ids: list[str] = []
    renamed_files: list[DocumentFileRename] = []
