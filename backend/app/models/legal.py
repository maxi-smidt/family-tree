from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class LegalAcceptance(Base):
    """Append-only audit log of Terms/Privacy/Impressum acceptances.

    One row per acceptance (initial + each re-acceptance after a
    ``legal_version`` bump). ``username`` is a snapshot so the legal evidence
    survives a later user purge even though ``user_id`` is nulled out by the
    FK's ``ON DELETE SET NULL``. ``locale`` records which language the user
    was actually viewing/accepting (``LEGAL_LOCALES`` in
    ``app.services.legal_defaults``); it does not affect re-acceptance gating,
    which is version-only. ``terms_hash``/``privacy_hash`` pin the acceptance
    to the exact document text in that locale (see ``LegalDocumentVersion``)
    so it survives later edits to the live ``AppSetting`` body, even when the
    ``legal_version`` string itself wasn't bumped.
    """

    __tablename__ = "legal_acceptances"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    username: Mapped[str] = mapped_column(String(150))
    version: Mapped[str] = mapped_column(String(50))
    locale: Mapped[str] = mapped_column(String(8), default="de")
    accepted_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    terms_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    privacy_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (Index("ix_legal_acceptances_user_id", "user_id"),)


class LegalDocumentVersion(Base):
    """Immutable snapshot of a published Terms/Privacy/Impressum text.

    A new row is inserted whenever the body for a ``(document_type, locale)``
    pair changes (detected via ``content_hash``), whether or not the
    admin-facing ``legal_version`` string was bumped. Documents are
    per-locale (``LEGAL_LOCALES`` in ``app.services.legal_defaults``; German
    ``de`` is the authoritative/default locale, English ``en`` a secondary
    translation). This lets a recorded acceptance
    (``LegalAcceptance.terms_hash``/``privacy_hash``) always resolve back to
    the exact text the user agreed to in their chosen language, even after
    later edits overwrite the live ``AppSetting`` row. Rows are never updated
    or deleted.
    """

    __tablename__ = "legal_document_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    document_type: Mapped[str] = mapped_column(String(20))
    locale: Mapped[str] = mapped_column(String(8), default="de")
    version: Mapped[str] = mapped_column(String(50))
    body: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    published_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)

    __table_args__ = (
        UniqueConstraint(
            "document_type",
            "locale",
            "content_hash",
            name="uq_legal_doc_version_type_locale_hash",
        ),
        Index(
            "ix_legal_doc_versions_type_locale_version",
            "document_type",
            "locale",
            "version",
        ),
    )
