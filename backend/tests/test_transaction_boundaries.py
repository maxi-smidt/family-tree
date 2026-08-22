"""Static guardrails for the UnitOfWork migration (#952).

Every application-mutation commit/rollback should go through
``app.services.unit_of_work.UnitOfWork`` so post-commit effects (SSE
publishes, cache invalidation, file cleanup) structurally cannot fire ahead of
— or without — a successful commit. A direct ``.commit()``/``.rollback()``
outside ``UnitOfWork`` is only legitimate for a handful of documented,
purpose-specific transaction boundaries (background-job status tracking,
bootstrap seeding, multi-phase backup/restore, per-iteration loop isolation).
Those are marked inline with an ``# allowlisted-commit: <reason>`` /
``# allowlisted-rollback: <reason>`` comment on the same line, which this
test treats as the allowlist — a new direct commit/rollback must either be
migrated to ``UnitOfWork`` or justify itself the same way.

This also checks the companion rule from the same issue: no module under
``app/services`` may import or raise FastAPI's ``HTTPException`` — business
validation there should raise an ``app.core.exceptions.DomainError`` subclass
instead, keeping services usable from background jobs and testable without a
FastAPI request context.
"""

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# The primitive itself is the one place a bare commit()/rollback() belongs.
_UNIT_OF_WORK_FILE = APP_DIR / "services" / "unit_of_work.py"

_ALLOWLIST_MARKERS = ("allowlisted-commit", "allowlisted-rollback")

_SCAN_ROOTS = [APP_DIR / "api", APP_DIR / "services", APP_DIR / "db"]


def _python_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.py") if "__pycache__" not in p.parts)


def _unmarked_direct_commits(path: Path) -> list[tuple[int, str]]:
    source = path.read_text()
    lines = source.splitlines()
    tree = ast.parse(source, filename=str(path))
    offenders = []
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("commit", "rollback")
        ):
            continue
        # The marker may be a trailing comment on the call's own line, or a
        # short standalone comment (possibly multi-line) directly above it.
        window = "\n".join(lines[max(0, node.lineno - 6) : node.lineno])
        if any(marker in window for marker in _ALLOWLIST_MARKERS):
            continue
        offenders.append((node.lineno, lines[node.lineno - 1].strip()))
    return offenders


def test_no_unmarked_direct_commits_outside_unit_of_work():
    violations: list[str] = []
    for root in _SCAN_ROOTS:
        for path in _python_files(root):
            if path == _UNIT_OF_WORK_FILE:
                continue
            for lineno, line in _unmarked_direct_commits(path):
                violations.append(f"{path.relative_to(APP_DIR.parent)}:{lineno}: {line}")
    assert not violations, (
        "Direct commit()/rollback() outside UnitOfWork must be migrated to "
        "`with UnitOfWork(db): ...`, or explicitly justified with a trailing "
        "`# allowlisted-commit: <reason>` / `# allowlisted-rollback: <reason>` "
        "comment. Offending lines:\n" + "\n".join(violations)
    )


def test_no_http_exception_in_services():
    violations: list[str] = []
    for path in _python_files(APP_DIR / "services"):
        source = path.read_text()
        tree = ast.parse(source, filename=str(path))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.ImportFrom):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.Name):
                names = [node.id]
            if "HTTPException" in names:
                violations.append(f"{path.relative_to(APP_DIR.parent)}:{node.lineno}")
    assert not violations, (
        "app.core.exceptions.DomainError subclasses replace fastapi.HTTPException "
        "under app/services (see app/api/exception_handlers.py). Offending "
        "locations:\n" + "\n".join(violations)
    )
