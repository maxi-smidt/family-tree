from sqlalchemy import Boolean, String
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
