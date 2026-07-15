"""Live-collaboration presence endpoints.

Clients heartbeat here so everyone with access to a tree can see who else is
currently viewing or editing it.  SSE is one-way, so presence relies on these
short POST heartbeats (~30 s interval, plus on member-sheet edit open/close);
a ``DELETE`` is a best-effort explicit leave when the client navigates away.

Every change republishes the whole roster as ``presence.updated`` to the tree's
audience (owner + shared members) via the event bus, and also returns it in the
HTTP response so a joining client sees the existing roster immediately.
"""

from fastapi import APIRouter, Depends, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree, require_feature
from app.db.session import get_db
from app.models import Tree, User
from app.schemas.presence import PresenceHeartbeat, PresenceRoster, PresenceUser
from app.services import presence_service
from app.services.event_bus import publish_tree_event
from app.services.presence_service import PresenceEntry

router = APIRouter(
    prefix="/trees/{tree_id}",
    tags=["presence"],
    dependencies=[Depends(require_feature("presence"))],
)


def _resolve_and_publish(
    db: Session, tree: Tree, entries: list[PresenceEntry]
) -> list[PresenceUser]:
    """Resolve display names, publish ``presence.updated``, return the roster.

    Runs in the threadpool (sync DB access) so the event loop is never blocked.
    Users that no longer exist are dropped from the roster.
    """
    user_ids = [e["user_id"] for e in entries]
    names: dict[str, str] = {}
    if user_ids:
        rows = db.execute(
            select(User.id, User.full_name, User.username).where(User.id.in_(user_ids))
        ).all()
        names = {uid: (full or username) for uid, full, username in rows}

    roster = [
        PresenceUser(
            user_id=e["user_id"],
            display_name=names[e["user_id"]],
            editing_member_id=e["editing_member_id"],
        )
        for e in entries
        if e["user_id"] in names
    ]
    roster.sort(key=lambda u: (u.display_name.casefold(), u.user_id))

    publish_tree_event(
        db,
        tree,
        "presence.updated",
        {"tree_id": tree.id, "users": [u.model_dump() for u in roster]},
    )
    return roster


@router.post("/presence", response_model=PresenceRoster)
async def heartbeat(
    payload: PresenceHeartbeat,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PresenceRoster:
    """Record/refresh this user's presence and return the current roster."""
    await presence_service.touch(tree.id, user.id, payload.editing_member_id)
    entries = await presence_service.active_entries(tree.id)
    roster = await run_in_threadpool(_resolve_and_publish, db, tree, entries)
    return PresenceRoster(tree_id=tree.id, users=roster)


@router.delete("/presence", status_code=204)
async def leave(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Explicitly drop this user from the tree's roster (best effort)."""
    await presence_service.leave(tree.id, user.id)
    entries = await presence_service.active_entries(tree.id)
    await run_in_threadpool(_resolve_and_publish, db, tree, entries)
    return Response(status_code=204)
