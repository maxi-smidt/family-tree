"""Per-user "last opened" bookkeeping for workspaces (#878)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.db.upsert import upsert_row
from app.models.workspace import WorkspaceUserState


def mark_workspace_opened(db: Session, workspace_id: str, user_id: str) -> None:
    """Stamp ``workspace_id`` as just-opened for ``user_id``."""
    upsert_row(
        db,
        WorkspaceUserState,
        {"workspace_id": workspace_id, "user_id": user_id, "last_opened": utcnow_iso()},
        index_elements=["workspace_id", "user_id"],
    )


def bulk_workspace_last_opened(
    db: Session, workspace_ids: list[str], user_id: str
) -> dict[str, str]:
    """This user's last-opened stamp for each of ``workspace_ids`` that has one."""
    if not workspace_ids:
        return {}
    return dict(
        db.execute(
            select(WorkspaceUserState.workspace_id, WorkspaceUserState.last_opened).where(
                WorkspaceUserState.user_id == user_id,
                WorkspaceUserState.workspace_id.in_(workspace_ids),
            )
        ).all()
    )


def workspace_last_opened(db: Session, workspace_id: str, user_id: str) -> str | None:
    return bulk_workspace_last_opened(db, [workspace_id], user_id).get(workspace_id)
