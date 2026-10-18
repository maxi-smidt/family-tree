"""AI transcription: per-user provider settings and per-file runs (#1123)."""

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserAiSettings(Base):
    """A person's own AI provider connection, used when they transcribe files.

    The API key is stored sealed (see ``app.core.secret_box``) and never
    returned by the API; ``api_key_hint`` keeps its last characters so the
    settings page can show which key is saved.
    """

    __tablename__ = "user_ai_settings"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(100))
    # Only for the "openai_compatible" provider (Ollama, LM Studio, ...).
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    api_key_sealed: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_hint: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))


class DocumentFileTranscription(Base):
    """The latest AI transcription run of one document file.

    Kept apart from ``document_file_texts`` so a text row still only exists
    once there is a text: a run in progress, or one that failed, leaves the
    file's text untouched.
    """

    __tablename__ = "document_file_transcriptions"

    document_file_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("document_files.id", ondelete="CASCADE"), primary_key=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    # Plain id (no FK), like ActivityLog.actor_id.
    requested_by: Mapped[str] = mapped_column(String(36))
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20))  # "pending" | "done" | "failed"
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))
