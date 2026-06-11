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

### Local Development / Building from source

```bash
git clone https://github.com/maxi-smidt/family-tree.git
cd family-tree

cp .env.example .env
# Edit .env: set a strong SECRET_KEY and a FIRST_ADMIN_PASSWORD.

docker compose up -d --build
```

Then open `http://localhost:8080` (or whatever `UI_PORT` you configured) and sign
in with the seeded admin account.

### Production Deployment (using pre-built images)

For production environments or NAS systems like **Unraid**, we provide a `docker-compose.prod.yml` that pulls the pre-built images from the GitHub Container Registry (`ghcr.io`), so you do not need to build them from source.

**For general Linux (Ubuntu, Debian, etc):**

```bash
wget https://raw.githubusercontent.com/maxi-smidt/family-tree/main/docker-compose.prod.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/maxi-smidt/family-tree/main/.env.example -O .env
# Edit .env
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

Everything is configured through the `.env` file. The headline settings:

| Variable        | Description                                          | Default        |
| --------------- | ---------------------------------------------------- | -------------- |
| `UI_PORT`       | Host port the web UI is served on                    | `8080`         |
| `APP_DATA_PATH` | Host path for application data (Postgres + backend)  | `./appdata`    |
| `DATA_PATH`     | Host path for the real data (member photos, gallery) | `./data`       |
| `SECRET_KEY`    | Secret for signing tokens (**required**)             | —              |
| `FRONTEND_URL`  | Public URL of the UI (OAuth redirects, CORS)         | `localhost:UI` |

See [.env.example](./.env.example) for the full list (database credentials,
initial admin, self-registration, and Authentik OIDC settings).

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
   PostgreSQL
```

- The React data layer talks to the backend through a small typed HTTP client
  (`frontend/src/services/api.ts` + `TreeService.ts`); the Zustand stores are
  otherwise unchanged from the desktop version.
- A "tree" replaces the old per-file SQLite database. Each tree is owned by a
  user and can be shared with others as `viewer` or `editor`.
- Member photos and gallery images are uploaded as data URLs, persisted to the
  filesystem under `DATA_PATH/media`, and served back as `/api/media/...` URLs.
- Databases are **not** encrypted at rest. Encryption is applied only to
  exported `.treedb` files (see [SECURITY.md](./docs/SECURITY.md)).

## Documentation

- **[SETUP.md](./docs/SETUP.md)** — Development environment setup
- **[AGENTS.md](./docs/AGENTS.md)** — Architecture and development guidelines
- **[SECURITY.md](./docs/SECURITY.md)** — Export encryption and auth model
- **[I18N_GUIDE.md](./docs/I18N_GUIDE.md)** — Internationalization conventions
- **[backend/README.md](./backend/README.md)** — Backend service details

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file.
