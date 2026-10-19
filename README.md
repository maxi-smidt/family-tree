# Family Tree Application

> A self-hostable web application for building and exploring your family history through an interactive visual interface.

![License](https://img.shields.io/badge/license-MIT-green.svg)

## Overview

Family Tree helps you document, organize, and visualize your family genealogy. It
runs as a self-hosted web application.

**Key Highlights:**

- Interactive visual family tree with drag-and-drop node arrangement
- Rich biographical information and life-event tracking
- Photo gallery and document store with member linking
- User accounts with an **owned + shared** access model for trees
- Admin area for managing users and instance settings
- Local accounts **and** optional OAuth/OIDC single sign-on via **Authentik**
- Multi-language support (English, German)
- Optional AI integration for document transcription

loyment**: Docker Compose (frontend served by nginx, which proxies `/api`)

### Project structure

```
frontend/   React single-page app (its own Dockerfile + nginx config)
backend/    FastAPI service (uv + Alembic; its own Dockerfile)
docker-compose.yml, .env.example   the deployment stack
package.json (root)   repo-level tooling only (prettier + git hooks)
```

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

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file.
