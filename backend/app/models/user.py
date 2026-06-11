from sqlalchemy import JSON, Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    username: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Null for accounts that authenticate exclusively through an OAuth provider.
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # "local" or "authentik".
    auth_provider: Mapped[str] = mapped_column(String(50), default="local")
    # OIDC subject identifier, when provisioned through Authentik.
    oauth_subject: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True
    )

    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)

    # Soft-deletion: when an admin schedules an account for deletion it enters a
    # grace period instead of being purged immediately. A non-null
    # ``deletion_requested_at`` means the account is pending deletion (blocked
    # from logging in). ``deletion_scheduled_for`` is the absolute purge deadline,
    # frozen when deletion is requested so later changes to the grace-period
    # setting never move existing deadlines.
    deletion_requested_at: Mapped[str | None] = mapped_column(
        String(40), nullable=True
    )
    deletion_scheduled_for: Mapped[str | None] = mapped_column(
        String(40), nullable=True
    )
    deletion_requested_by: Mapped[str | None] = mapped_column(
        String(36), nullable=True
    )

    tab_preferences: Mapped[dict | None] = mapped_column(JSON, nullable=True)
