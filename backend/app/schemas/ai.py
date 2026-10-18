"""AI transcription settings and runs (#1123)."""

from pydantic import BaseModel, ConfigDict, Field


class AiProviderInfo(BaseModel):
    id: str
    label: str
    default_model: str
    needs_api_key: bool
    # The person enters the endpoint; only admins may use it.
    custom_base_url: bool
    supports_pdf: bool


class AiSettingsOut(BaseModel):
    """A person's AI settings. The API key itself is never returned."""

    configured: bool = False
    provider: str | None = None
    model: str | None = None
    base_url: str | None = None
    has_api_key: bool = False
    # Last characters of the saved key, so people can tell which one it is.
    api_key_hint: str | None = None
    # True when a key is stored but can no longer be decrypted (the server's
    # SECRET_KEY changed); it has to be entered again.
    api_key_unreadable: bool = False
    providers: list[AiProviderInfo]


class AiSettingsSave(BaseModel):
    provider: str = Field(max_length=40)
    model: str = Field(default="", max_length=100, pattern=r"^[A-Za-z0-9._:/@-]*$")
    base_url: str | None = Field(default=None, max_length=500)
    # Omitted/null keeps the saved key; an empty string removes it.
    api_key: str | None = Field(default=None, max_length=500)


class DocumentFileTranscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_file_id: str
    provider: str
    model: str
    status: str
    error: str | None = None
    created_at: str
    updated_at: str
