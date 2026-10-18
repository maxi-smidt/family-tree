"""Evidence for person fields: a document cited for one field of a member."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CitableField = Literal[
    "first_name",
    "middle_names",
    "last_name",
    "maiden_name",
    "baptismal_name",
    "date_of_birth",
    "date_of_death",
    "birthplace",
]


class MemberFieldCitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    member_id: str
    field: str
    document_id: str
    document_file_id: str | None = None
    page: int | None = None
    quote: str | None = None
    quote_prefix: str | None = None
    quote_suffix: str | None = None
    note: str | None = None
    created_by: str | None = None
    created_at: str
    updated_at: str
    # Whether ``quote`` still appears in the cited file's text. ``None`` when
    # there is nothing to check: no quote, no file, or the file has no text.
    quote_found: bool | None = None


class _CitationAnchor(BaseModel):
    document_file_id: str | None = None
    page: int | None = Field(default=None, ge=1, le=100_000)
    quote: str | None = Field(default=None, max_length=2000)
    quote_prefix: str | None = Field(default=None, max_length=200)
    quote_suffix: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class MemberFieldCitationCreate(_CitationAnchor):
    member_id: str
    field: CitableField
    document_id: str


class MemberFieldCitationUpdate(_CitationAnchor):
    """Replace where a citation points inside its document, and its note.

    The person, field and document stay fixed: citing something else is a new
    citation.
    """


class MemberMissingEvidence(BaseModel):
    member_id: str
    # The name, since the client may not have every person loaded.
    name: str
    fields: list[str]


class EvidenceCoverage(BaseModel):
    """How many of the visible people's filled-in key facts have evidence."""

    facts_total: int
    facts_cited: int
    # People with the most facts still lacking evidence first, capped.
    missing: list[MemberMissingEvidence]
    missing_member_count: int
    # Cited passages that can no longer be found in their file's text.
    quotes_not_found: list[MemberFieldCitationOut]
