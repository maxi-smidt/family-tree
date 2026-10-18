"""Continuation cursors for the neighborhood endpoint.

A cursor is a signed, short-lived token carrying nothing but an offset into the
deterministic traversal sequence (see ``neighborhood``) plus the fingerprints it
is bound to: algorithm version, workspace, principal and their visibility,
the request that produced it, and the graph revision. Anything that would make
the offset mean something else invalidates the cursor instead of silently
returning the wrong slice.
"""

from __future__ import annotations

import hashlib

import jwt

from app.core.exceptions import ConflictError, InvalidInputError
from app.core.security import create_neighborhood_cursor, decode_neighborhood_cursor
from app.services.workspaces.neighborhood import ALGORITHM_VERSION, NeighborhoodQuery
from app.services.workspaces.visibility import WorkspaceAccessContext


class InvalidCursorError(InvalidInputError):
    """Malformed, expired, tampered, or cross-principal cursor.

    Always reported with the same generic detail: a caller must not be able to
    tell which of those it was, nor learn anything about the workspace the
    cursor was minted for.
    """

    def __init__(self) -> None:
        super().__init__("Invalid or expired cursor")


class StaleCursorError(ConflictError):
    """The graph or the caller's access changed; the traversal must restart."""

    def __init__(self) -> None:
        super().__init__("stale_cursor")


def _digest(*parts: object) -> str:
    raw = "\x1f".join(str(part) for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def visibility_fingerprint(context: WorkspaceAccessContext) -> str:
    """Identify the caller *and* the extent of what they may currently read.

    Built from the resolved ``WorkspaceAccessContext`` (#984): revoking a
    share, changing a role or its restrictions — workspace-wide or on any one
    section grant — or rotating a public link all change one of
    ``context.fingerprint_parts()``, which retires every cursor issued under
    the old access.
    """
    return _digest("access", *context.fingerprint_parts())


def query_fingerprint(query: NeighborhoodQuery) -> str:
    """The request shape, minus the focus root — see ``decode_cursor``."""
    return _digest(
        query.up,
        query.down,
        query.include_partners,
        query.section_ids,
        query.budget,
    )


def encode_cursor(
    workspace_id: str,
    query: NeighborhoodQuery,
    *,
    visibility: str,
    revision: str,
    offset: int,
) -> str:
    return create_neighborhood_cursor(
        workspace_id,
        {
            "alg_version": ALGORITHM_VERSION,
            "visibility": visibility,
            "root": query.root_id,
            "query": query_fingerprint(query),
            "revision": revision,
            "offset": offset,
        },
    )


def decode_cursor(
    token: str,
    workspace_id: str,
    query: NeighborhoodQuery,
    *,
    visibility: str,
    revision: str,
) -> int:
    """Return the offset carried by *token*.

    Raises ``InvalidCursorError`` unless the cursor was minted by this
    algorithm, for this workspace, this caller's current visibility, and the
    same request shape. A different focus root raises ``StaleCursorError``
    instead: when the caller let the server pick the root, an edit the graph
    revision cannot see can still move that pick, and "restart the traversal"
    is the honest answer to that — not "your cursor is invalid".
    """
    try:
        claims = decode_neighborhood_cursor(token)
    except jwt.InvalidTokenError as exc:
        raise InvalidCursorError() from exc

    offset = claims.get("offset")
    if (
        claims.get("sub") != workspace_id
        or claims.get("alg_version") != ALGORITHM_VERSION
        or claims.get("visibility") != visibility
        or claims.get("query") != query_fingerprint(query)
        or not isinstance(offset, int)
        or offset < 0
    ):
        raise InvalidCursorError()
    if claims.get("revision") != revision or claims.get("root") != query.root_id:
        raise StaleCursorError()
    return offset
