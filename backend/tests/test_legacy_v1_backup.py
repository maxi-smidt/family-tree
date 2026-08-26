"""Coverage for the v1 .ftbackup restore adapter (#996)."""

import base64
import hashlib
from collections import defaultdict

from app.core.config import settings
from app.models import Member, MigrationRun, Section, Workspace
from app.services.crypto_export import encrypt_bundle
from app.services.system.backups import backup_service, legacy_v1_backup
from tests.conftest import add_member, make_tree, make_user


def _to_v1_shape(bundle: dict) -> dict:
    """Reverse-apply the adapter's own rename tables to a real v2 bundle dict
    (from ``backup_service._collect_bundle``), producing a bundle a genuine
    v1.x instance could plausibly have produced."""
    v2_to_v1_table = {new: old for old, new in legacy_v1_backup.TABLE_RENAMES}
    v1_col_renames_by_v2_table: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for v2_table, old_col, new_col in legacy_v1_backup.COLUMN_RENAMES:
        v1_col_renames_by_v2_table[v2_table].append((new_col, old_col))

    v1_tables: dict[str, list[dict]] = {}
    v1_counts: dict[str, int] = {}
    for v2_table, rows in bundle["tables"].items():
        if v2_table in legacy_v1_backup._V2_ONLY_TABLES:
            continue
        v1_table = v2_to_v1_table.get(v2_table, v2_table)
        renames = v1_col_renames_by_v2_table.get(v2_table, ())
        new_rows = []
        for row in rows:
            new_row = dict(row)
            for new_col, old_col in renames:
                if new_col in new_row:
                    new_row[old_col] = new_row.pop(new_col)
            new_rows.append(new_row)
        v1_tables[v1_table] = new_rows
        v1_counts[v1_table] = len(new_rows)

    bundle["tables"] = v1_tables
    bundle["manifest"]["table_row_counts"] = v1_counts
    return bundle


def _empty_v1_bundle() -> dict:
    tables = {name: [] for name in legacy_v1_backup._v1_expected_tables()}
    return {
        "format": "family-tree-instance-backup",
        "version": 2,
        "created_at": "2020-01-01T00:00:00Z",
        "tables": tables,
        "media": [],
        "manifest": {
            "format": "family-tree-instance-backup",
            "version": 2,
            "table_row_counts": {name: 0 for name in tables},
            "media": [],
        },
    }


def test_is_v1_bundle_detects_v1_and_v2_shapes(db):
    v1 = _empty_v1_bundle()
    assert legacy_v1_backup.is_v1_bundle(v1["tables"])

    v2_tables = {model.__tablename__: [] for model in backup_service.BACKUP_MODELS}
    assert not legacy_v1_backup.is_v1_bundle(v2_tables)
    assert not legacy_v1_backup.is_v1_bundle(None)
    assert not legacy_v1_backup.is_v1_bundle("not-a-dict")


def test_convert_v1_bundle_rejects_corrupt_row_count():
    bundle = _empty_v1_bundle()
    bundle["manifest"]["table_row_counts"]["members"] = 1

    try:
        legacy_v1_backup.convert_v1_bundle(bundle)
    except backup_service.BackupValidationError as exc:
        assert "members" in str(exc)
    else:
        raise AssertionError("expected BackupValidationError")


def test_convert_v1_bundle_rejects_incomplete_table_set():
    bundle = _empty_v1_bundle()
    del bundle["tables"]["members"]
    del bundle["manifest"]["table_row_counts"]["members"]

    try:
        legacy_v1_backup.convert_v1_bundle(bundle)
    except backup_service.BackupValidationError:
        pass
    else:
        raise AssertionError("expected BackupValidationError")


def test_convert_v1_bundle_rejects_unsafe_media_path():
    bundle = _empty_v1_bundle()
    raw = b"hello"
    bundle["media"] = [
        {
            "path": "../escape.txt",
            "size_bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "data": base64.b64encode(raw).decode("ascii"),
        }
    ]

    try:
        legacy_v1_backup.convert_v1_bundle(bundle)
    except backup_service.BackupValidationError:
        pass
    else:
        raise AssertionError("expected BackupValidationError")


def test_convert_v1_bundle_rejects_media_manifest_mismatch():
    """Inline media not declared in the manifest (or vice versa) must fail
    before conversion, the same as it would for a v2 bundle."""
    bundle = _empty_v1_bundle()
    raw = b"hello"
    bundle["media"] = [
        {
            "path": "photo.jpg",
            "size_bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "data": base64.b64encode(raw).decode("ascii"),
        }
    ]
    # manifest["media"] is left empty: it declares nothing for this file.

    try:
        legacy_v1_backup.convert_v1_bundle(bundle)
    except backup_service.BackupValidationError:
        pass
    else:
        raise AssertionError("expected BackupValidationError")


def test_v1_bundle_missing_optional_tables_is_still_detected_and_restores(
    db, tmp_path, monkeypatch
):
    """An archive taken before document_uploads/workspace_user_states/
    virtual_view_user_states existed (mid-v1-lifecycle additions, mirroring
    backup_service.LEGACY_OPTIONAL_TABLES on the v2 side) must stay
    restorable rather than being rejected as an unrecognized shape."""
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = tmp_path / "media"

    bundle = _empty_v1_bundle()
    for name in ("document_uploads", "tree_user_states", "virtual_view_user_states"):
        del bundle["tables"][name]
        del bundle["manifest"]["table_row_counts"][name]

    assert legacy_v1_backup.is_v1_bundle(bundle["tables"])

    backup_path = tmp_path / "old_v1.ftbackup"
    backup_path.write_bytes(encrypt_bundle(bundle, None))

    backup_service.restore_backup_file(
        db, backup_path, replace=True, media_root=media_root
    )
    assert db.query(MigrationRun).count() == 1


def test_v1_restore_round_trip_single_workspace(db, tmp_path, monkeypatch):
    """A genuine v1-shaped archive (one tree, no bridge) restores as a v2
    workspace with its own default section, through the real conversion
    pipeline the live upgrade uses."""
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = tmp_path / "media"

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin, name="Legacy Tree")
    add_member(db, tree, "member-1", first_name="Ada")
    add_member(db, tree, "member-2", first_name="Grace")

    bundle = backup_service._collect_bundle(db).model_dump()
    v1_bundle = _to_v1_shape(bundle)
    assert legacy_v1_backup.is_v1_bundle(v1_bundle["tables"])
    assert "trees" in v1_bundle["tables"]
    assert "workspaces" not in v1_bundle["tables"]

    backup_path = tmp_path / "v1_instance.ftbackup"
    backup_path.write_bytes(encrypt_bundle(v1_bundle, None))

    backup_service.restore_backup_file(
        db, backup_path, replace=True, media_root=media_root
    )

    restored_workspace = db.get(Workspace, tree.id)
    assert restored_workspace is not None
    assert restored_workspace.name == "Legacy Tree"
    assert restored_workspace.owner_id == admin.id
    assert db.get(Member, "member-1").workspace_id == tree.id
    assert db.get(Member, "member-2").workspace_id == tree.id

    sections = db.query(Section).filter(Section.workspace_id == tree.id).all()
    assert len(sections) == 1

    runs = db.query(MigrationRun).all()
    assert len(runs) == 1
    assert runs[0].source_version == "v1-archive"
    assert runs[0].backup_id is None
    assert runs[0].backup_path is None


def test_v1_restore_consolidates_bridged_workspaces(db, tmp_path, monkeypatch):
    """Two v1 trees owned by the same user, linked by the legacy bridge
    columns, consolidate into one workspace with two sections — the same
    outcome the live upgrade produces for the same input."""
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = tmp_path / "media"

    admin = make_user(db, "admin", is_admin=True)
    tree_a = make_tree(db, admin, name="Paternal line")
    tree_b = make_tree(db, admin, name="Maternal line")
    member_a = add_member(db, tree_a, "member-a", first_name="Ada")
    member_b = add_member(db, tree_b, "member-b", first_name="Grace")
    member_a.linked_workspace_id = tree_b.id
    member_a.linked_member_id = member_b.id
    member_b.linked_workspace_id = tree_a.id
    member_b.linked_member_id = member_a.id
    db.commit()

    bundle = backup_service._collect_bundle(db).model_dump()
    v1_bundle = _to_v1_shape(bundle)

    backup_path = tmp_path / "v1_bridged.ftbackup"
    backup_path.write_bytes(encrypt_bundle(v1_bundle, None))

    backup_service.restore_backup_file(
        db, backup_path, replace=True, media_root=media_root
    )

    workspaces = db.query(Workspace).filter(Workspace.owner_id == admin.id).all()
    assert len(workspaces) == 1
    survivor = workspaces[0]

    sections = db.query(Section).filter(Section.workspace_id == survivor.id).all()
    assert len(sections) == 2

    # The bridge asserted member-a and member-b are the same person, so
    # consolidation merges them into a single surviving member rather than
    # keeping two — the same outcome the live upgrade produces.
    members = db.query(Member).filter(Member.workspace_id == survivor.id).all()
    assert len(members) == 1
    assert members[0].id in {"member-a", "member-b"}
