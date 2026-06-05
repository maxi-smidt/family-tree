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


class GalleryImageUpdate(BaseModel):
    imageData: str | None = None
    title: str | None = None
    description: str | None = None


class LinkCreate(BaseModel):
    member_id: str


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
    content: str
    created_at: str
    updated_at: str


class StoryCreate(BaseModel):
    id: str
    title: str
    content: str
    created_at: str
    updated_at: str


class StoryUpdate(BaseModel):
    title: str
    content: str
    updated_at: str


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
