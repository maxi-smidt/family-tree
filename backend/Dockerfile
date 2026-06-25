FROM python:3.12-slim

# uv: fast, reproducible installs from the committed uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /uvx /bin/

ARG APP_VERSION=dev
ARG APP_REVISION=dev
ARG APP_BUILD_DATE=

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" \
    APP_VERSION=${APP_VERSION} \
    APP_REVISION=${APP_REVISION} \
    APP_BUILD_DATE=${APP_BUILD_DATE}

LABEL org.opencontainers.image.title="Family Tree Backend" \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${APP_REVISION} \
      org.opencontainers.image.created=${APP_BUILD_DATE}

WORKDIR /app

# Install dependencies first (cached unless the lock changes).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# Drop root: create an unprivileged user and pre-create mount points so the
# process owns them when bind mounts are absent. Operators running bind mounts
# should ensure the host directories are owned by UID/GID 1000.
RUN addgroup --system --gid 1000 appuser \
 && adduser --system --uid 1000 --gid 1000 --no-create-home appuser \
 && mkdir -p /data /appdata \
 && chown -R appuser:appuser /app /data /appdata

USER appuser

EXPOSE 8000

# WORKERS controls the number of uvicorn worker processes (default: 1).
# IMPORTANT: WORKERS > 1 REQUIRES REDIS_URL to be set — each worker maintains
# its own in-memory SSE subscriber registry and without Redis pub/sub, events
# published by one worker will not reach SSE clients connected to another.
ENV WORKERS=1

# Shell-form CMD so the shell can expand ${WORKERS} at container start. The
# leading `exec` replaces the shell with uvicorn so it runs as PID 1 and
# receives SIGTERM directly on `docker stop` — without it the shell would
# swallow the signal and the lifespan shutdown (cancel sweepers, stop the
# Redis listener, close the Redis client) would never run before SIGKILL.
# shellcheck disable=SC2086
CMD exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WORKERS}
