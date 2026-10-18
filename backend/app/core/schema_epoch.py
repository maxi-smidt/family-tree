"""Schema epoch (#1012).

A frontend build and the backend it talks to must agree on the wire
contract's major shape (v1 "trees" vs v2 "workspaces"). The frontend sends
this on every request as the ``X-Schema-Epoch`` header; ``SchemaEpochMiddleware``
(see ``app.main``) rejects a mutation whose caller didn't declare the current
epoch instead of letting it write through a contract the two sides don't
actually share. Bump this only alongside another mandatory, non-additive wire
contract change of the kind #981 made.
"""

SCHEMA_EPOCH = 2

SCHEMA_EPOCH_HEADER = "X-Schema-Epoch"

# Matched against ApiError.message the way PUBLIC_PASSWORD_REQUIRED is on the
# frontend (app/services/api.ts) — a stable string, not a numeric status code.
SCHEMA_EPOCH_MISMATCH_DETAIL = "schema_epoch_mismatch"
