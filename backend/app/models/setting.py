from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AppSetting(Base):
    """Instance-wide settings managed by admins (key/value store)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)


class FeatureFlagOverride(Base):
    """Per-user allowlist entry for a feature flag in the ``beta`` state.

    Rows are kept when a flag leaves ``beta`` so the tester list survives
    toggling; resolution simply ignores them unless the flag is ``beta``.
    """

    __tablename__ = "feature_flag_overrides"

    feature: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
