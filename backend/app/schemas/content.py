"""Schemas for gallery images, events and stories (frontend `*DB` shapes)."""

from typing import Literal

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


# --- Sources ---------------------------------------------------------------
FactType = Literal[
    "name", "birth", "death", "birthplace", "hometown", "residence", "general"
]


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    filename: str | None = None
    url: str
    mime_type: str | None = None
    size: int | None = None
    created_at: str


class EvidenceCreate(BaseModel):
    kind: Literal["file", "link"]
    filename: str | None = None
    data: str | None = None  # base64 data URL when kind == "file"
    url: str | None = None   # external link when kind == "link"


class EvidenceUpdate(BaseModel):
    filename: str


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    author: str | None = None
    publication_info: str | None = None
    repository: str | None = None
    source_date: str | None = None
    notes: str | None = None
    created_at: str
    updated_at: str
    evidence: list[EvidenceOut] = []


class SourceCreate(BaseModel):
    id: str
    title: str
    author: str | None = None
    publication_info: str | None = None
    repository: str | None = None
    source_date: str | None = None
    notes: str | None = None
    created_at: str
    updated_at: str


class SourceUpdate(BaseModel):
    title: str
    author: str | None = None
    publication_info: str | None = None
    repository: str | None = None
    source_date: str | None = None
    notes: str | None = None


class CitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    member_id: str
    fact_type: str
    page: str | None = None
    detail: str | None = None
    created_at: str


class CitationCreate(BaseModel):
    id: str
    source_id: str
    member_id: str
    fact_type: FactType
    page: str | None = None
    detail: str | None = None
    created_at: str


class CitationUpdate(BaseModel):
    fact_type: FactType
    page: str | None = None
    detail: str | None = None
