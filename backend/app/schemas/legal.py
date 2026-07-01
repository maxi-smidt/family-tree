from pydantic import BaseModel


class LegalPublicDocuments(BaseModel):
    """Public (no-auth) view of the current legal documents in one locale."""

    terms_body: str
    privacy_body: str
    imprint_body: str
    version: str
    locale: str


class LegalAcceptanceStatus(BaseModel):
    """Result of accepting the current legal version."""

    accepted: bool
    version: str


class LegalDocumentVersionSummary(BaseModel):
    """One entry in the admin-only immutable version history list."""

    id: str
    document_type: str
    locale: str
    version: str
    content_hash: str
    published_at: str

    model_config = {"from_attributes": True}


class LegalDocumentVersionDetail(LegalDocumentVersionSummary):
    """A single historical document body, for admin review."""

    body: str
