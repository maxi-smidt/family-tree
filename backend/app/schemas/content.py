"""Schemas for gallery images, events and stories (frontend `*DB` shapes).

``GalleryImage*`` schemas use the camelCase alias-generator base classes
because the frontend reads/writes ``imageData``, ``createdAt``, ``uploadedAt``.
All other schemas are intentionally snake_case end-to-end.
"""

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.base import FamilyTreeBaseModel, FamilyTreeOrmBaseModel


# --- Gallery ---------------------------------------------------------------
class GalleryImageOut(FamilyTreeOrmBaseModel):
    id: str
    image_data: str | None = None
    title: str | None = None
    description: str | None = None
    created_at: str | None = None
    uploaded_at: str | None = None


class GalleryImageUpdate(FamilyTreeBaseModel):
    image_data: str | None = None
    title: str | None = None
    description: str | None = None


class LinksSet(BaseModel):
    """Replace the full set of members linked to a content item."""

    member_ids: list[str] = []


class GalleryLinkIn(BaseModel):
    """A person link, optionally narrowed to a normalized image region."""

    member_id: str
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    w: float | None = Field(default=None, gt=0, le=1)
    h: float | None = Field(default=None, gt=0, le=1)

    @model_validator(mode="after")
    def validate_region(self) -> "GalleryLinkIn":
        values = (self.x, self.y, self.w, self.h)
        if any(value is None for value in values):
            if not all(value is None for value in values):
                raise ValueError("A gallery region requires x, y, w, and h")
            return self
        if self.x + self.w > 1 or self.y + self.h > 1:
            raise ValueError("A gallery region must fit within the image")
        return self


class UnknownFaceOut(BaseModel):
    """A face region flagged as an unidentified person, linked to its task."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    gallery_image_id: str
    x: float
    y: float
    w: float
    h: float
    task_id: str | None = None
    created_at: str | None = None


class UnknownFaceUpdate(BaseModel):
    """Update an unknown face's region only — never touches its task."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def validate_region(self) -> "UnknownFaceUpdate":
        if self.x + self.w > 1 or self.y + self.h > 1:
            raise ValueError("A face region must fit within the image")
        return self


class UnknownFaceCreate(UnknownFaceUpdate):
    """Create an unknown-face tag; also creates its research task.

    Region fields and validation are inherited from :class:`UnknownFaceUpdate`.
    ``task_title``/``task_notes`` let the frontend send localized text; when
    omitted the backend falls back to an English default title and no notes.
    """

    id: str
    created_at: str
    task_title: str | None = None
    task_notes: str | None = None


class UnknownFaceResolve(BaseModel):
    member_id: str


class GalleryLinksSet(BaseModel):
    """Replace an image's member links, including optional face regions."""

    links: list[GalleryLinkIn] | None = None
    # Kept for clients that only know whole-image associations. New clients
    # should send ``links`` so they can retain face regions.
    member_ids: list[str] | None = None

    @model_validator(mode="after")
    def validate_unique_members(self) -> "GalleryLinksSet":
        if self.links is not None and self.member_ids is not None:
            raise ValueError("Send either links or member_ids, not both")
        if self.links is None:
            self.links = [
                GalleryLinkIn(member_id=member_id)
                for member_id in self.member_ids or []
            ]
        member_ids = [link.member_id for link in self.links]
        if len(member_ids) != len(set(member_ids)):
            raise ValueError("A member can have only one tag per image")
        return self


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


# --- Research tasks --------------------------------------------------------
class MemberTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    notes: str | None = None
    done: bool
    created_at: str
    done_at: str | None = None
    # Empty = tree-level task.
    member_ids: list[str] = []


class MemberTaskCreate(BaseModel):
    id: str
    title: str
    notes: str | None = None
    created_at: str
    member_ids: list[str] = []


class MemberTaskUpdate(BaseModel):
    title: str
    notes: str | None = None
    done: bool
    done_at: str | None = None


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
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None


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
