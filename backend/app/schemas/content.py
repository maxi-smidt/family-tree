"""Schemas for gallery images, events and stories (frontend `*DB` shapes)."""

from pydantic import BaseModel, ConfigDict


# --- Gallery ---------------------------------------------------------------
class GalleryImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    imageData: str | None = None
    title: str | None = None
    description: str | None = None
    createdAt: str | None = None
    uploadedAt: str | None = None


class GalleryImageCreate(BaseModel):
    id: str
    imageData: str | None = None
    title: str | None = None
    description: str | None = None
    createdAt: str | None = None
    uploadedAt: str | None = None
    # Members to link the new image to, in a single request.
    member_ids: list[str] = []


class GalleryImageUpdate(BaseModel):
    imageData: str | None = None
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
class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    url: str
    mime_type: str | None = None
    size: int | None = None
    created_at: str


class AttachmentCreate(BaseModel):
    filename: str
    data: str  # base64 data URL


class AttachmentUpdate(BaseModel):
    filename: str


class StoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    content: str | None = None
    created_at: str
    updated_at: str
    attachments: list[AttachmentOut] = []


class StoryCreate(BaseModel):
    id: str
    title: str
    content: str | None = None
    created_at: str
    updated_at: str
    member_ids: list[str] = []


class StoryUpdate(BaseModel):
    title: str
    content: str | None = None
    updated_at: str


# --- Geocode ---------------------------------------------------------------
class GeocodeOut(BaseModel):
    query: str
    lat: float | None = None
    lon: float | None = None
    display_name: str | None = None
    resolved: bool


class GeocodeRequest(BaseModel):
    locations: list[str] = []


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
