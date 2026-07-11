"""Server-Sent Events endpoint.

Clients subscribe to real-time tree-change notifications here. Because
EventSource cannot send Authorization headers, an authenticated client first
exchanges its access token for a one-purpose, short-lived SSE ticket.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import ACCOUNT_PENDING_DELETION, get_current_user
from app.core.security import create_sse_ticket_token, decode_sse_ticket_token
from app.db.session import get_db
from app.models import User
from app.services.event_bus import event_bus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sse", tags=["sse"])


def _resolve_user_from_ticket(ticket: str, db: Session) -> str:
    """Validate *ticket* using the provided *db* session and return the user_id.

    Raises ``HTTPException(401)`` on any failure.
    """
    try:
        user_id = decode_sse_ticket_token(ticket)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=401, detail="Inactive or unknown user"
        )
    if user.deletion_requested_at is not None:
        raise HTTPException(
            status_code=401, detail=ACCOUNT_PENDING_DELETION
        )
    return user_id


@router.post("/ticket")
def create_sse_ticket(user: User = Depends(get_current_user)) -> dict[str, str]:
    return {"ticket": create_sse_ticket_token(user.id)}


@router.get("/events")
async def stream_events(
    request: Request,
    ticket: str | None = Query(None, max_length=4096),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Subscribe to tree-change events via Server-Sent Events."""
    if not ticket:
        raise HTTPException(status_code=401, detail="Ticket required")

    user_id = _resolve_user_from_ticket(ticket, db)
    # Close the DB session before streaming — we must NOT hold it open for the
    # lifetime of the SSE stream (which may last hours).
    db.close()

    queue = await event_bus.subscribe(user_id)

    async def event_stream():  # type: ignore[return]
        try:
            # Signal a successful connection immediately.
            yield "event: connected\ndata: {}\n\n"

            elapsed = 0.0
            _POLL_INTERVAL = 1.0  # seconds between disconnect checks
            _HEARTBEAT_INTERVAL = 25.0  # seconds between SSE heartbeats

            while True:
                if await request.is_disconnected():
                    break

                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=_POLL_INTERVAL
                    )
                    elapsed = 0.0
                    payload = json.dumps(event["data"])
                    yield f"event: {event['type']}\ndata: {payload}\n\n"
                except TimeoutError:
                    elapsed += _POLL_INTERVAL
                    if elapsed >= _HEARTBEAT_INTERVAL:
                        # Heartbeat keeps proxies / load-balancers from
                        # closing the idle connection.
                        yield ": ping\n\n"
                        elapsed = 0.0
        finally:
            event_bus.unsubscribe(user_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
