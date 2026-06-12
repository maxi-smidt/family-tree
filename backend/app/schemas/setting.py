from typing import Literal

from pydantic import BaseModel, Field

FeatureState = Literal["on", "off", "beta"]


class FeatureFlagOut(BaseModel):
    name: str
    state: FeatureState
    allowlist: list[str]


class FeatureFlagUpdate(BaseModel):
    state: FeatureState | None = None
    allowlist: list[str] | None = None


class SettingsOut(BaseModel):
    allow_self_registration: bool
    instance_name: str
    default_language: str
    deletion_grace_period_days: int


class SettingsUpdate(BaseModel):
    allow_self_registration: bool | None = None
    instance_name: str | None = None
    default_language: str | None = None
    deletion_grace_period_days: int | None = Field(default=None, ge=0)
