"""Regression tests for the schema import cycle fixed in #888.

`family`, `tree`, and `merge` used to form a circular import (family -> tree
-> merge -> family), which normal app startup happened to mask through import
order. Each module must be importable on its own, so these checks run in a
fresh subprocess rather than in-process — by the time any other test runs,
`app.main` has already been imported and every module is cached in
`sys.modules`, which would hide a reintroduced cycle.
"""

import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent

MODULES = [
    "app.schemas.family",
    "app.schemas.tree",
    "app.schemas.merge",
]


@pytest.mark.parametrize("module", MODULES)
def test_schema_module_imports_standalone(module):
    result = subprocess.run(
        [sys.executable, "-c", f"import {module}"],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
