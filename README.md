# Family Tree Application

> A self-hostable web application for building and exploring your family history through an interactive visual interface.

![License](https://img.shields.io/badge/license-MIT-green.svg)

## Overview

Family Tree helps you document, organize, and visualize your family genealogy. It
runs as a self-hosted web application: a React single-page app talking to a
FastAPI backend backed by PostgreSQL, all wired together with Docker Compose.

**Key Highlights:**

- 🌳 Interactive visual family tree with drag-and-drop node arrangement
- 📝 Rich biographical information and life-event tracking
- 📸 Photo gallery with member linking (stored on the filesystem)
- 👥 User accounts with an **owned + shared** access model for trees
- 🛡️ Admin area for managing users and instance settings
- 🔑 Local accounts **and** optional OAuth/OIDC single sign-on via **Authentik**
- 🌍 Multi-language support (English, German)
- 🎨 Clean, modern interface with dark/light mode support

### Mobile behavior

Mobile is intentionally read-oriented. Phones show a compact member directory and
detail view first, with a pan/zoom/searchable tree canvas for browsing. Owners
and editors can still make targeted member edits from the directory, while graph
editing, relationship creation, layout controls, uploads, and administration are
desktop-oriented.

## Tech Stack

- **Frontend** (`frontend/`): React + TypeScript + Vite, Shadcn UI + Tailwind CSS, React Flow, Zustand
- **Backend** (`backend/`): FastAPI (Python, managed with **uv**), SQLAlchemy 2.0 + Alembic
- **Database**: PostgreSQL
- **Auth**: JWT (local accounts) + Authentik OIDC (optional)
- **Media**: stored on the host filesystem, served by the backend
- **Deployment**: Docker Compose (frontend served by nginx, which proxies `/api`)

### Project structure

```
frontend/   React single-page app (its own Dockerfile + nginx config)
backend/    FastAPI service (uv + Alembic; its own Dockerfile)
docker-compose.yml, .env.example   the deployment stack
package.json (root)   repo-level tooling only (prettier + git hooks)
```

## Quick Start (Docker Compose)

PostgreSQL is **not** part of the compose stack (as is common for Unraid-style
apps): run your own Postgres and point the backend at it via the `POSTGRES_*`
values (or a full `DATABASE_URL`) in `.env`. For development,
`docker compose -f docker-compose.dev.yml up -d db` starts a local throwaway
Postgres that matches the `.env.example` defaults.

### Local Development / Building from source

```bash
git clone https://github.com/maxi-smidt/family-tree.git
cd family-tree

cp .env.example .env
# Edit .env: set a strong SECRET_KEY, a FIRST_ADMIN_PASSWORD and the POSTGRES_*
# connection values for your database.

docker compose up -d --build
```

Then open `http://localhost:8080` (or whatever `UI_PORT` you configured) and sign
in with the seeded admin account.

### Production Deployment (using pre-built images)

For production environments or NAS systems like **Unraid**, we provide a `docker-compose.prod.yml` that pulls the pre-built images from the GitHub Container Registry (`ghcr.io`), so you do not need to build them from source. By default it uses the latest published release; set `APP_IMAGE_TAG` in `.env` to pin an explicit release such as `1.2.17`.

> **Note:** The `:latest` tag (and versioned tags like `1.2.17`) are published to GHCR when a `vX.Y.Z` release tag is pushed. At least one release tag must exist before prebuilt-image deployment works. If no release tag has been pushed yet, build from source instead (see [Local Development / Building from source](#local-development--building-from-source)).

**For general Linux (Ubuntu, Debian, etc):**

```bash
wget https://raw.githubusercontent.com/maxi-smidt/family-tree/main/docker-compose.prod.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/maxi-smidt/family-tree/main/.env.example -O .env
# Edit .env. For repeatable production deploys, pin APP_IMAGE_TAG to a release.
docker compose up -d
```

**For Unraid:**

1. Go to the **Apps** tab (Community Applications) and install the **Docker Compose Manager** plugin.
2. In the Docker tab, scroll down to Compose and click **Add New Stack**. Name it `family-tree`.
3. Click the gear icon next to the new stack and click **Edit Compose File**. Paste the contents of [`docker-compose.prod.yml`](./docker-compose.prod.yml) into it and save.
4. Click the gear icon again, click **Edit UI Labels**, and configure your paths (e.g. `/mnt/user/appdata/family-tree/appdata` and `/mnt/user/appdata/family-tree/data`).
5. Also, add your environment variables to a `.env` file for the stack (click the gear icon -> Edit .env) and generate a random `SECRET_KEY`.
6. Click **Compose Up** to start the stack!

### Configuration

Deploy-time configuration lives in the `.env` file. Administrators can change
runtime settings such as upload limits, backups, deletion grace periods, and
self-registration from the admin dialog. The headline deploy-time settings:

| Variable        | Description                                          | Default        |
| --------------- | ---------------------------------------------------- | -------------- |
| `UI_PORT`       | Host port the web UI is served on                    | `8080`         |
| `APP_DATA_PATH` | Host path for application data (exports, logs)       | `./appdata`    |
| `DATA_PATH`     | Host path for the real data (member photos, gallery) | `./data`       |
| `APP_IMAGE_TAG` | Published app image tag for frontend + backend       | `latest`       |
| `SECRET_KEY`    | Secret for signing tokens (**required**)             | —              |
| `POSTGRES_*`    | Connection to your PostgreSQL (host **required**)    | see example    |
| `FRONTEND_URL`  | Public URL of the UI (OAuth redirects, CORS)         | `localhost:UI` |

See [.env.example](./.env.example) for the full list (database credentials,
initial admin, self-registration, and Authentik OIDC settings).
See [docs/HARDCODED_VALUES.md](./docs/HARDCODED_VALUES.md) for the runtime,
deploy-time, and code-invariant settings inventory.

## Architecture

```
Browser (React SPA)
        │  HTTPS, JWT in Authorization header
        ▼
   nginx (frontend container)
        │  serves the SPA, proxies /api → backend
        ▼
   FastAPI (backend container) ── filesystem (/data: photos & media)
        │
        ▼
   PostgreSQL (your own instance, configured via .env)
```

- The React data layer talks to the backend through a small typed HTTP client
  (`frontend/src/services/api.ts` + `TreeService.ts`).
- Each tree is owned by a user and can be shared with others as `viewer` or
  `editor`.
- Member photos and gallery images are uploaded as data URLs, persisted to the
  filesystem under `DATA_PATH/media`, and served back as `/api/media/...` URLs.
- Databases are **not** encrypted at rest. Encryption is applied only to
  exported `.treedb` files (see [SECURITY.md](./docs/SECURITY.md)).

## Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** — Release notes and version history
- **[SETUP.md](./docs/SETUP.md)** — Development environment setup
- **[OPERATIONS.md](./docs/OPERATIONS.md)** — Self-hosting operations: backup/restore, upgrades, HTTPS, Authentik
- **[AGENTS.md](./docs/AGENTS.md)** — Architecture and development guidelines
- **[SECURITY.md](./docs/SECURITY.md)** — Export encryption and auth model
- **[I18N_GUIDE.md](./docs/I18N_GUIDE.md)** — Internationalization conventions
- **[backend/README.md](./backend/README.md)** — Backend service details

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file.
