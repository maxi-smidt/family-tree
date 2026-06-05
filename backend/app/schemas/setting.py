from pydantic import BaseModel


class SettingsOut(BaseModel):
    allow_self_registration: bool
    instance_name: str
    default_language: str


class SettingsUpdate(BaseModel):
    allow_self_registration: bool | None = None
    instance_name: str | None = None
    default_language: str | None = None
