# CLAUDE.md

Claude Code loads this file automatically. The full, cross-tool agent guide for
this repository lives in **AGENTS.md** — read it first:

@AGENTS.md

## Claude Code specifics

- An allowlist for routine commands (build, test, lint, migrations) lives in
  [`.claude/settings.json`](.claude/settings.json) so they run without prompting.
- Toolchain: **Node 22** (frontend, run from `frontend/`) and **Python 3.12 +
  uv** (backend, run from `backend/`). System defaults are usually too old.
- App versions are release-time metadata. Do not bump them on ordinary PRs; see
  "Golden rules" in AGENTS.md for the tag-based release flow.
