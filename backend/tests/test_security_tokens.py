import jwt
import pytest

from app.core.security import (
    create_access_token,
    create_public_tree_token,
    create_sse_ticket_token,
    create_totp_session_token,
    decode_access_token,
    decode_public_tree_token,
    decode_sse_ticket_token,
    decode_totp_session_token,
)


def test_jwt_purposes_are_not_interchangeable():
    access = create_access_token("user-1")
    totp = create_totp_session_token("user-1")
    public = create_public_tree_token("tree-1", 3)
    sse = create_sse_ticket_token("user-1")

    assert decode_access_token(access)["sub"] == "user-1"
    assert decode_totp_session_token(totp) == "user-1"
    assert decode_public_tree_token(public) == ("tree-1", 3)
    assert decode_sse_ticket_token(sse) == "user-1"

    for token in (totp, public, sse):
        with pytest.raises(jwt.InvalidTokenError):
            decode_access_token(token)
    for decoder in (
        decode_totp_session_token,
        decode_public_tree_token,
        decode_sse_ticket_token,
    ):
        with pytest.raises(jwt.InvalidTokenError):
            decoder(access)
