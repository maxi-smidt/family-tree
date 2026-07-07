"""Gallery, events and stories — the rich content attached to members."""

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class GalleryImage(Base):
    __tablename__ = "gallery_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    image_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    uploaded_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class GalleryMemberLink(Base):
    __tablename__ = "gallery_member_link"

    gallery_image_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("gallery_images.id", ondelete="CASCADE"),
        primary_key=True,
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(100))
    date: Mapped[str] = mapped_column(String(40))
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))

    attachments: Mapped[list["EventAttachment"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="EventAttachment.created_at",
    )


class EventAttachment(Base):
    """A file (image, pdf, document, ...) attached to an event.

    Mirrors ``StoryAttachment``: the bytes live on disk under
    ``DATA_PATH/media/<tree_id>/`` and ``url`` is the stable ``/api/media/...``
    reference; ``filename`` is the user-facing, settable display/download name.
    """

    __tablename__ = "event_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))

    event: Mapped["Event"] = relationship(back_populates="attachments")


class EventMemberLink(Base):
    __tablename__ = "event_member_link"

    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )


class Story(Base):
    __tablename__ = "stories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    # Optional now: an entry may carry only file attachments and no narrative text.
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))

    attachments: Mapped[list["StoryAttachment"]] = relationship(
        back_populates="story",
        cascade="all, delete-orphan",
        order_by="StoryAttachment.created_at",
    )


class StoryAttachment(Base):
    """A file (image, pdf, document, ...) attached to a story.

    The bytes live on disk under ``DATA_PATH/media/<tree_id>/`` and ``url`` is
    the stable ``/api/media/...`` reference; ``filename`` is the user-facing,
    settable display/download name.
    """

    __tablename__ = "story_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    story_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stories.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))

    story: Mapped["Story"] = relationship(back_populates="attachments")


class StoryMemberLink(Base):
    __tablename__ = "story_member_link"

    story_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )


class GeocodeCache(Base):
    """Instance-wide cache of Nominatim geocoding results."""

    __tablename__ = "geocode_cache"

    query: Mapped[str] = mapped_column(String(255), primary_key=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    resolved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # True for a user-supplied correction (search pick or manually dropped
    # pin). Manual rows are never re-geocoded or overwritten by the
    # retry/TTL logic in app.services.geocoding.
    manual: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    updated_at: Mapped[str] = mapped_column(String(40))


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    publication_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    repository: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))

    evidence: Mapped[list["SourceEvidence"]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
        order_by="SourceEvidence.created_at",
    )


class SourceEvidence(Base):
    __tablename__ = "source_evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(10))  # "file" | "link"
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    url: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))

    source: Mapped["Source"] = relationship(back_populates="evidence")


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    fact_type: Mapped[str] = mapped_column(String(40))
    page: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))
