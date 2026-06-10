FROM python:3.12-slim

# uv: fast, reproducible installs from the committed uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

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

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
