"""Continuation cursors for the workspace search endpoint (#1024).

Same design as ``neighborhood_cursor``: a signed, short-lived token carrying
only an offset into a deterministic sequence, plus the fingerprints it is
bound to — algorithm version, workspace, the caller's current visibility, the
query that produced it, and the searchable-set revision. Anything that would
make the offset mean something else invalidates the cursor instead of
silently returning the wrong slice.
"""

from __future__ import annotations

import hashlib

import jwt

from app.core.security import create_search_cursor, decode_search_cursor
from app.services.workspaces.neighborhood_cursor import (
    InvalidCursorError,
    StaleCursorError,
)
from app.services.workspaces.search import SEARCH_ALGORITHM_VERSION
from app.services.workspaces.visibility import WorkspaceAccessContext

__all__ = ["InvalidCursorError", "StaleCursorError", "encode_cursor", "decode_cursor"]


def _digest(*parts: object) -> str:
    raw = "\x1f".join(str(part) for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def visibility_fingerprint(context: WorkspaceAccessContext) -> str:
    """Identify the caller *and* the extent of what they may currently read.

    Revoking a share, changing a role or its restrictions, or rotating a
    public link all change one of ``context.fingerprint_parts()``, which
    retires every cursor issued under the old access.
    """
    return _digest("access", *context.fingerprint_parts())


def query_fingerprint(q: str, limit: int) -> str:
    return _digest(q, limit)


def encode_cursor(
    workspace_id: str,
    q: str,
    limit: int,
    *,
    visibility: str,
    revision: str,
    offset: int,
) -> str:
    return create_search_cursor(
        workspace_id,
        {
            "alg_version": SEARCH_ALGORITHM_VERSION,
            "visibility": visibility,
            "query": query_fingerprint(q, limit),
            "revision": revision,
            "offset": offset,
        },
    )


def decode_cursor(
    token: str,
    workspace_id: str,
    q: str,
    limit: int,
    *,
    visibility: str,
    revision: str,
) -> int:
    """Return the offset carried by *token*.

    Raises ``InvalidCursorError`` unless the cursor was minted by this
    algorithm, for this workspace, this caller's current visibility, and the
    same query/limit. ``StaleCursorError`` instead when only the searchable
    set has moved on since — the honest answer there is "restart the
    search", not "your cursor is invalid".
    """
    try:
        claims = decode_search_cursor(token)
    except jwt.InvalidTokenError as exc:
        raise InvalidCursorError() from exc

    offset = claims.get("offset")
    if (
        claims.get("sub") != workspace_id
        or claims.get("alg_version") != SEARCH_ALGORITHM_VERSION
        or claims.get("visibility") != visibility
        or claims.get("query") != query_fingerprint(q, limit)
        or not isinstance(offset, int)
        or offset < 0
    ):
        raise InvalidCursorError()
    if claims.get("revision") != revision:
        raise StaleCursorError()
    return offset
