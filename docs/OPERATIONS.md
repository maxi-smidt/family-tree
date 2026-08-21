# Operations Guide

Day-2 operations for a self-hosted Family Tree instance running the Docker
Compose stack ([`docker-compose.prod.yml`](../docker-compose.prod.yml) with the
published GHCR images, or [`docker-compose.yml`](../docker-compose.yml) when
building locally). For first-time setup see [SETUP.md](SETUP.md); for the
security architecture see [SECURITY.md](SECURITY.md).

Covered here:

1. [Backup & restore](#backup--restore)
2. [Upgrades](#upgrades)
3. [HTTPS / reverse proxy](#https--reverse-proxy)
4. [Authentik (OIDC) walkthrough](#authentik-oidc-walkthrough)

Throughout, `backend` / `frontend` are the Compose service names and the
examples assume you run commands from the directory containing your compose
file and `.env`. **PostgreSQL is not part of the stack** — you run your own
instance (separate container, Unraid app, managed service, ...) and point the
backend at it via the `POSTGRES_*` values (or `DATABASE_URL`) in `.env`; adapt
the `pg_dump` / `pg_restore` examples below to wherever your Postgres runs.

---

## Backup & restore

Your instance has **two** data locations, and you must back up **both**:

| What                | Where                              | Contains                                        |
| ------------------- | ---------------------------------- | ----------------------------------------------- |
| PostgreSQL database | your own Postgres instance         | members, relations, users, stories, settings    |
| Media files         | `${DATA_PATH}` (served as `/data`) | member photos and gallery images under `media/` |

> ⚠️ **A database-only backup silently loses every photo.** The database stores
> only file references; the image bytes live under `${DATA_PATH}/media`. Always
> back up the media directory alongside the SQL dump.

### In-app full-instance backups

The Admin → Backups panel creates encrypted `.ftbackup` files under
`${APP_DATA_PATH}/backups`. Version 2 backups contain all durable application
rows (including sharing, legal/audit, quality, geocoding, and virtual-view
state) plus every byte below `${DATA_PATH}/media`. Each file has an encrypted,
versioned manifest; creation verifies all table row counts and media SHA-256
hashes before it is marked successful. A failed or incomplete run is shown as
failed and cannot be downloaded as a successful backup.

Keep these files off-host as you would a database dump. They are encrypted with
the instance `SECRET_KEY`, so restore them with the same key (or treat a key
rotation as a planned migration).

To restore an `.ftbackup`, stop application workers first, run migrations for
the target version, and use the backend command against a **blank** database
and empty `${DATA_PATH}/media` volume:

```bash
cd backend
uv run python -m app.services.restore_backup /secure/backup.ftbackup
```

The command verifies the manifest, row counts, and media hashes before it
writes anything. It refuses a non-empty target. For deliberate disaster
recovery into an existing instance, stop the stack, make an independent copy
first, then pass the explicit destructive flag:

```bash
uv run python -m app.services.restore_backup --replace /secure/backup.ftbackup
```

After the command reports completion, start the stack and verify that users can
sign in and media loads. Do not use the regular in-app backup file as a way to
merge data into an existing instance.

### Online backup (no downtime)

Dump the database from your Postgres instance and archive the media directory.
`pg_dump` produces a consistent snapshot even while the app is in use:

```bash
# Load the same variables the stack uses (POSTGRES_*, DATA_PATH, ...).
set -a; source .env; set +a

STAMP=$(date +%F_%H-%M)
mkdir -p backups

# 1. Database — custom format (-Fc) supports selective/parallel restore.
#    (If Postgres runs in its own container, wrap this in `docker exec`.)
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER:-familytree}" -Fc "${POSTGRES_DB:-familytree}" \
  > "backups/familytree_${STAMP}.dump"

# 2. Media files.
tar -czf "backups/media_${STAMP}.tar.gz" -C "${DATA_PATH:-./data}" .
```

Copy the two files somewhere off the host (another machine, object storage,
etc.). A backup that lives only on the server it protects is not a backup.

To run this on a schedule, put the commands in a script and add a cron entry,
e.g. nightly at 02:30:

```cron
30 2 * * * cd /opt/family-tree && ./backup.sh >> backups/backup.log 2>&1
```

Prune old backups with something like
`find backups -name 'familytree_*' -mtime +30 -delete`.

### Offline backup (cold copy)

For a byte-exact snapshot (e.g. before a risky upgrade), stop the stack, take
a cold backup of your Postgres instance (its data directory or a dump), and
copy both app data directories:

```bash
docker compose down
tar -czf backups/full_$(date +%F).tar.gz \
  "${APP_DATA_PATH:-./appdata}" "${DATA_PATH:-./data}" .env
docker compose up -d
```

This also captures the backend's working data (exports, logs) and your `.env`
(which contains `SECRET_KEY` — keep this archive private; without the same
`SECRET_KEY`, existing sessions are invalidated after a restore, which is
harmless, but treat the value as a credential).

### Restore

On a fresh host: install Docker, set up your Postgres instance, copy the
repo's compose file plus your backed up `.env`, then:

```bash
set -a; source .env; set +a

# 1. Recreate the schema owner's database from the dump (run against your
#    Postgres instance; wrap in `docker exec` if it runs in a container).
PGPASSWORD="${POSTGRES_PASSWORD}" dropdb   -h "${POSTGRES_HOST}" -U "${POSTGRES_USER:-familytree}" --if-exists "${POSTGRES_DB:-familytree}"
PGPASSWORD="${POSTGRES_PASSWORD}" createdb -h "${POSTGRES_HOST}" -U "${POSTGRES_USER:-familytree}" "${POSTGRES_DB:-familytree}"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore -h "${POSTGRES_HOST}" -U "${POSTGRES_USER:-familytree}" \
  -d "${POSTGRES_DB:-familytree}" --no-owner < backups/familytree_<STAMP>.dump

# 2. Restore the media files.
mkdir -p "${DATA_PATH:-./data}"
tar -xzf backups/media_<STAMP>.tar.gz -C "${DATA_PATH:-./data}"

# 3. Start the stack.
docker compose up -d
```

If you took an _offline_ backup instead, simply extract the archive back to
the same paths (and restore your Postgres data directory) before
`docker compose up -d` — no `pg_restore` needed.

**Verify the restore**: log in, open a tree, and spot-check that member photos
and gallery images load. Images failing to load while the tree looks fine is
the classic symptom of a restored database without restored media.

> Restoring a dump into a **newer** app version is fine — pending migrations
> run automatically on backend startup (see below). Restoring into an **older**
> version than the one that produced the dump is not supported.

### Encrypted exports are not backups

The in-app export (encrypted `.treedb` per tree) is great for moving a single
tree between instances or keeping a personal copy, but it is per-tree, manual,
and excludes users, sharing, and settings. Use it in addition to — never
instead of — the database + media backup above.

---

## Upgrades

The published images are `ghcr.io/maxi-smidt/family-tree-backend` and
`ghcr.io/maxi-smidt/family-tree-frontend`. Both services use the same
`APP_IMAGE_TAG` value from `.env`.

```bash
# 1. Back up first (see above) — especially before major version jumps.
# 2. Choose the release you want. Use "latest" for the latest published release,
#    or pin an explicit tag for repeatable deploys and easy rollbacks.
#    Example .env:
#    APP_IMAGE_TAG=1.2.17
#
# 3. Pull the new images and restart:
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --wait
```

That is the whole procedure, because of two properties of the stack:

- **Migrations run automatically.** On every startup the backend runs
  `alembic upgrade head` before serving traffic, then seeds the admin user and
  default settings if missing. You never run Alembic by hand in production.
- **Health-gated startup.** The frontend container only starts once the
  backend reports ready (`/api/health/ready`), and the backend retries until
  it can reach the database, so a normal upgrade never serves the UI against a
  half-migrated schema.

If you intentionally build locally instead of pulling published images, clone the
repo and run `docker compose up -d --build` (using the default `docker-compose.yml`).
Published release images are preferred for production because a pinned
`APP_IMAGE_TAG` gives you a clear rollback target.

> **Note:** The `:latest` tag and versioned image tags are published to GHCR by
> the [release workflow](../.github/workflows/release.yml) when a maintainer
> dispatches it, which also creates the matching
> [GitHub Release](https://github.com/maxi-smidt/family-tree/releases) with
> notes. If no release exists yet, build from source as described above.
> Every published image carries a signed provenance attestation and an SBOM —
> see [SECURITY.md](./SECURITY.md#container-image-provenance--sbom) to verify
> one before deploying it.

### If a migration fails

A failed migration leaves the backend container restarting in a loop
(`restart: unless-stopped`). To diagnose and recover:

```bash
docker compose logs backend --tail 100   # the Alembic error is at the top of the loop
```

1. **Don't retry blindly.** Alembic migrations run in a transaction on
   PostgreSQL, so a failed migration rolls back — your data is intact at the
   previous schema version.
2. **Pin back to the previous image** to get the app running again while you
   investigate, e.g. set `APP_IMAGE_TAG` in `.env` to the last working version
   tag, then `docker compose up -d`.
3. **Check the [release notes](https://github.com/maxi-smidt/family-tree/releases) / open an issue** with the logged error. Typical
   causes are environment-specific (out of disk, custom schema changes made
   directly in the database).
4. After a fix is released (or the cause is removed), set `APP_IMAGE_TAG` to the
   fixed release and `pull` + `up -d --wait` again — Alembic resumes from where
   it left off.

> Tip: avoid `latest` drift in long-lived deployments by pinning explicit
> release tags and bumping `APP_IMAGE_TAG` deliberately.

---

## HTTPS / reverse proxy

The stack publishes plain HTTP on `${UI_PORT}` (default `8080`). For any
non-local deployment put a TLS-terminating reverse proxy in front and proxy
**only the frontend port** — it already forwards `/api` to the backend
internally, so a single upstream is all you need.

Two settings must match the public URL, otherwise OAuth redirects and CORS
break:

```dotenv
# .env
FRONTEND_URL=https://family.example.com
CORS_ORIGINS=https://family.example.com
```

After changing them: `docker compose up -d` (recreates the backend with the
new environment).

### Caddy (simplest)

```caddy
family.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy obtains and renews the Let's Encrypt certificate automatically.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name family.example.com;

    ssl_certificate     /etc/letsencrypt/live/family.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/family.example.com/privkey.pem;

    # Documents and gallery images both use multipart streaming. Keep this
    # close to the app's largest upload setting (100 MB maximum for either) so
    # the proxy cannot buffer arbitrarily large bodies. The bundled frontend
    # container uses 105m.
    client_max_body_size 105m;

    # Let slow but valid uploads finish. Choose values suitable for your
    # expected connection speeds; do not make them unlimited.
    client_body_timeout 10m;
    proxy_read_timeout 10m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name family.example.com;
    return 301 https://$host$request_uri;
}
```

Both documents (up to 100 MiB) and gallery images / member photos (up to the
`max_image_upload_mb` setting — default 10 MiB, 100 MiB maximum) are streamed to
disk in 1 MiB chunks rather than buffered as base64 JSON. Plan temporary-disk
capacity for **at least 3× the larger configured limit per concurrent upload**:
one proxy request buffer, one FastAPI multipart spool, and the app's atomic
destination temp file. An image is briefly held as a decoded bitmap while it is
re-encoded — size it against `max_image_dimension` (default 4096 px/side), which
also bounds the decompression-bomb surface. Keep the proxy limit close to the
application limit and choose finite body/read timeouts. A failed, cancelled,
rejected, or checksum-mismatched upload is removed immediately; incomplete
destination temp files (both `.document-upload-*` and `.image-upload-*`) are
also removed when the backend starts.

### Traefik (labels on the frontend service)

If Traefik runs in the same Docker network, expose the frontend via labels
instead of a published port:

```yaml
# docker-compose.override.yml
services:
  frontend:
    labels:
      - traefik.enable=true
      - traefik.http.routers.familytree.rule=Host(`family.example.com`)
      - traefik.http.routers.familytree.entrypoints=websecure
      - traefik.http.routers.familytree.tls.certresolver=letsencrypt
      - traefik.http.services.familytree.loadbalancer.server.port=8080
    networks: [default, traefik]

networks:
  traefik:
    external: true
```

With a proxy in place, consider removing the `ports:` mapping from the
`frontend` service so the only way in is through TLS.

---

## Authentik (OIDC) walkthrough

Family Tree supports Authentik as an optional single-sign-on provider next to
local accounts. The high-level flow: you create a provider + application in
Authentik, then hand the client ID/secret and the discovery URL to Family Tree
via environment variables. The "Sign in with Authentik" button appears
automatically once they are set.

### 1. Create the OAuth2/OpenID provider (in Authentik)

In the Authentik admin UI: **Applications → Providers → Create**, type
**OAuth2/OpenID Provider**:

- **Name**: `family-tree`
- **Authorization flow**: your standard authorize flow (e.g.
  `default-provider-authorization-explicit-consent`)
- **Client type**: `Confidential`
- **Redirect URI** (strict):

  ```
  https://family.example.com/api/auth/oauth/authentik/callback
  ```

  This is exactly `${FRONTEND_URL}/api/auth/oauth/authentik/callback` — the
  callback goes through the frontend's `/api` proxy, not directly to the
  backend.

- **Scopes**: keep the defaults `openid`, `email`, `profile`. Authentik's
  built-in `profile` scope mapping already includes the user's `groups`
  claim, which Family Tree uses for admin sync (below).

Note the generated **Client ID** and **Client Secret**.

### 2. Create the application (in Authentik)

**Applications → Applications → Create**:

- **Name**: `Family Tree`, **Slug**: `family-tree`
- **Provider**: the provider from step 1

The slug determines the discovery URL:

```
https://authentik.example.com/application/o/family-tree/.well-known/openid-configuration
```

Open that URL in a browser — it must return JSON. If it 404s, the slug doesn't
match.

### 3. (Optional) Create the admin group

Members of one Authentik group are made Family Tree admins. Create a group
(default expected name: `family-tree-admins`) under **Directory → Groups** and
add the relevant users.

Group membership is synced on **every** Authentik login, in both directions:
adding a user to the group grants admin on their next login, removing them
revokes it. Admin status of _local_ accounts is never touched by this sync.

### 4. Configure Family Tree

Add to your `.env` and recreate the backend (`docker compose up -d`):

```dotenv
AUTHENTIK_CLIENT_ID=<client id from step 1>
AUTHENTIK_CLIENT_SECRET=<client secret from step 1>
AUTHENTIK_DISCOVERY_URL=https://authentik.example.com/application/o/family-tree/.well-known/openid-configuration
AUTHENTIK_ADMIN_GROUP=family-tree-admins
```

Further knobs (defaults shown):

| Variable                      | Default                | Effect                                                                                                                                         |
| ----------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTHENTIK_SCOPES`            | `openid email profile` | Scopes requested from Authentik.                                                                                                               |
| `AUTHENTIK_AUTO_CREATE_USERS` | `true`                 | Create a Family Tree account on first Authentik login. If `false`, only users that already exist (matched by email) can sign in via Authentik. |
| `AUTHENTIK_ADMIN_GROUP`       | `family-tree-admins`   | Group granting admin. Set empty to disable admin sync entirely.                                                                                |

### 5. Verify

1. Open the login page — a **Sign in with Authentik** button should appear.
2. Log in as a user in the admin group → they should see the admin menu.
3. Remove them from the group, log out/in again → admin gone.

**Troubleshooting**

- Redirected back with `#oauth_error=1`: redirect URI mismatch (compare the
  Authentik provider's redirect URI against `FRONTEND_URL` — including the
  scheme) or wrong client secret. The backend logs the underlying error.
- `#oauth_error=nouser`: `AUTHENTIK_AUTO_CREATE_USERS=false` and no existing
  account matched the user's email.
- Button missing: one of the three required variables
  (`AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`,
  `AUTHENTIK_DISCOVERY_URL`) is unset — all three are needed.
