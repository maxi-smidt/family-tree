"""Tests for the Legal Terms / Privacy / Impressum acceptance gate (#519) and
its immutable version-history extension.

- GET /legal/public needs no auth and returns the seeded documents.
- POST /legal/accept writes an audit row (username/version/ip/user-agent) and
  sets user.preferences["legal_accepted_version"].
- /auth/me reflects legal_accepted true after accept, false again after the
  admin bumps legal_version.
- get_writable_tree 403s before acceptance and succeeds after.
- legal_acceptance_required=false disables the gate entirely.
- Every distinct published document body is snapshotted immutably into
  ``legal_document_versions`` (content-hash de-duplicated), and acceptances
  record the content hash of what was actually accepted.
"""

from uuid import uuid4

import pytest

from app.models import AdminAuditLog, LegalAcceptance, LegalDocumentVersion
from app.schemas.setting import SettingsUpdate
from app.services.system import settings_service
from app.services.system.settings_service import (
    content_hash,
    ensure_defaults,
    get_setting,
    legal_body_setting_key,
    snapshot_current_legal_versions,
    update_settings,
)
from tests.conftest import API, auth, make_tree, make_user


def _member_payload() -> dict:
    return {
        "id": str(uuid4()),
        "firstName": "Test",
        "lastName": "Person",
        "gender": "f",
    }


def test_public_legal_documents_no_auth_empty_when_unseeded(client, db):
    # Mirrors other settings tests: without ensure_defaults() having run
    # (as it does on real app startup), settings rows simply don't exist yet.
    res = client.get(f"{API}/legal/public")
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == "1"
    assert body["terms_body"] == ""
    assert body["privacy_body"] == ""
    assert body["imprint_body"] == ""


def test_public_legal_documents_seeded_defaults(client, db):
    ensure_defaults(db)
    # German is the authoritative default locale.
    res = client.get(f"{API}/legal/public")
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == "0"
    assert body["locale"] == "de"
    assert "Nutzungsbedingungen" in body["terms_body"]
    assert "Datenschutz" in body["privacy_body"]
    assert "Impressum" in body["imprint_body"]

    # English is served when requested.
    en = client.get(f"{API}/legal/public?locale=en")
    assert en.status_code == 200
    en_body = en.json()
    assert en_body["locale"] == "en"
    assert "Terms of Service" in en_body["terms_body"]


def test_me_requires_legal_acceptance_by_default(client, db):
    alice = make_user(db, "alice", legal_accepted=False)
    res = client.get(f"{API}/auth/me", headers=auth(alice))
    assert res.status_code == 200
    body = res.json()
    assert body["legal_acceptance_required"] is True
    assert body["legal_accepted"] is False


def test_accept_legal_writes_audit_row_and_updates_me(client, db):
    alice = make_user(db, "alice", legal_accepted=False)

    res = client.post(
        f"{API}/legal/accept",
        headers={
            **auth(alice),
            "User-Agent": "pytest-agent/1.0",
            "X-Forwarded-For": "203.0.113.7, 10.0.0.1",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["accepted"] is True
    assert body["version"] == "0"

    rows = db.query(LegalAcceptance).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.username == "alice"
    assert row.version == "0"
    assert row.user_agent == "pytest-agent/1.0"
    assert row.ip_address == "203.0.113.7"
    assert row.accepted_at

    me = client.get(f"{API}/auth/me", headers=auth(alice))
    assert me.status_code == 200
    assert me.json()["legal_accepted"] is True


def test_accept_legal_uses_real_ip_without_forwarded_headers(client, db):
    alice = make_user(db, "alice", legal_accepted=False)
    res = client.post(f"{API}/legal/accept", headers=auth(alice))
    assert res.status_code == 200

    row = db.query(LegalAcceptance).one()
    # TestClient's default peer; just assert something was captured (no header
    # spoofing is possible, but the helper must not blow up without headers).
    assert row.ip_address is not None


def test_legal_accept_ignores_client_supplied_version(client, db):
    """POST /legal/accept always reads legal_version server-side."""
    alice = make_user(db, "alice", legal_accepted=False)

    res = client.post(
        f"{API}/legal/accept",
        headers=auth(alice),
        json={"version": "999.0.0"},
    )
    assert res.status_code == 200
    assert res.json()["version"] == "0"

    row = db.query(LegalAcceptance).one()
    assert row.version == "0"


def test_editing_a_document_forces_reacceptance(client, db):
    """Auto-versioning: editing a legal body bumps the version under the hood,
    which re-triggers the gate for users who accepted the prior version."""
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", legal_accepted=False)

    accept0 = client.post(f"{API}/legal/accept", headers=auth(alice))
    assert accept0.json()["version"] == "0"
    me1 = client.get(f"{API}/auth/me", headers=auth(alice))
    assert me1.json()["legal_accepted"] is True

    # Admin edits a body — no manual version field; the version auto-bumps.
    resp = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"legal_terms_body_de": "Überarbeitete Nutzungsbedingungen"},
    )
    assert resp.status_code == 200
    assert resp.json()["legal_version"] == "1"

    me2 = client.get(f"{API}/auth/me", headers=auth(alice))
    assert me2.json()["legal_accepted"] is False

    res = client.post(f"{API}/legal/accept", headers=auth(alice))
    assert res.json()["version"] == "1"
    me3 = client.get(f"{API}/auth/me", headers=auth(alice))
    assert me3.json()["legal_accepted"] is True

    rows = (
        db.query(LegalAcceptance)
        .filter_by(user_id=alice.id)
        .order_by(LegalAcceptance.version)
        .all()
    )
    assert [r.version for r in rows] == ["0", "1"]


def test_deleting_acceptance_row_retriggers_gate(client, db):
    """The legal_acceptances table is the source of truth — removing a user's
    row re-opens the gate (no stale preferences flag keeps it closed)."""
    alice = make_user(db, "alice", legal_accepted=False)
    client.post(f"{API}/legal/accept", headers=auth(alice))
    assert client.get(f"{API}/auth/me", headers=auth(alice)).json()["legal_accepted"]

    db.query(LegalAcceptance).filter_by(user_id=alice.id).delete()
    db.commit()

    assert (
        client.get(f"{API}/auth/me", headers=auth(alice)).json()["legal_accepted"]
        is False
    )


def test_get_writable_tree_blocks_before_acceptance(client, db):
    alice = make_user(db, "alice", legal_accepted=False)
    tree = make_tree(db, alice)

    res = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(alice),
        json=_member_payload(),
    )
    assert res.status_code == 403


def test_get_writable_tree_allows_after_acceptance(client, db):
    alice = make_user(db, "alice", legal_accepted=False)
    tree = make_tree(db, alice)

    accept = client.post(f"{API}/legal/accept", headers=auth(alice))
    assert accept.status_code == 200

    res = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(alice),
        json=_member_payload(),
    )
    assert res.status_code == 201


def test_legal_acceptance_not_required_disables_gate(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", legal_accepted=False)
    tree = make_tree(db, alice)

    resp = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"legal_acceptance_required": False},
    )
    assert resp.status_code == 200

    me = client.get(f"{API}/auth/me", headers=auth(alice))
    assert me.json()["legal_acceptance_required"] is False
    assert me.json()["legal_accepted"] is True

    res = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(alice),
        json=_member_payload(),
    )
    assert res.status_code == 201


def test_legal_accept_requires_auth(client, db):
    res = client.post(f"{API}/legal/accept")
    assert res.status_code == 401


def test_admin_settings_legal_fields(client, db):
    admin = make_user(db, "admin", is_admin=True)

    resp = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={
            "legal_acceptance_required": False,
            "legal_terms_body_de": "Eigene AGB",
            "legal_terms_body_en": "Custom terms",
            "legal_privacy_body_de": "Eigener Datenschutz",
            "legal_privacy_body_en": "Custom privacy",
            "legal_imprint_body_de": "Eigenes Impressum",
            "legal_imprint_body_en": "Custom imprint",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["legal_acceptance_required"] is False
    # Version is not client-settable; editing bodies auto-bumps 0 -> 1.
    assert data["legal_version"] == "1"
    assert data["legal_terms_body_de"] == "Eigene AGB"
    assert data["legal_terms_body_en"] == "Custom terms"
    assert data["legal_privacy_body_en"] == "Custom privacy"
    assert data["legal_imprint_body_en"] == "Custom imprint"

    public_de = client.get(f"{API}/legal/public").json()
    assert public_de["version"] == "1"
    assert public_de["terms_body"] == "Eigene AGB"

    public_en = client.get(f"{API}/legal/public?locale=en").json()
    assert public_en["terms_body"] == "Custom terms"


def test_non_admin_cannot_patch_legal_settings(client, db):
    alice = make_user(db, "alice")
    resp = client.patch(
        f"{API}/settings",
        headers=auth(alice),
        json={"legal_acceptance_required": False},
    )
    assert resp.status_code == 403


# --- Immutable version history ---------------------------------------------


def test_ensure_defaults_snapshots_seeded_v0_documents(db):
    ensure_defaults(db)
    rows = db.query(LegalDocumentVersion).all()
    types = {r.document_type for r in rows}
    assert types == {"terms", "privacy", "imprint"}
    for row in rows:
        assert row.version == "0"
        assert row.content_hash


def test_snapshot_is_idempotent_for_unchanged_text(db):
    ensure_defaults(db)
    first_count = db.query(LegalDocumentVersion).count()

    created = snapshot_current_legal_versions(db)
    assert created == []
    assert db.query(LegalDocumentVersion).count() == first_count


def test_editing_a_document_creates_a_new_immutable_snapshot(client, db):
    """Editing text bumps the version and snapshots the new body; the old text
    (v0) is preserved immutably."""
    admin = make_user(db, "admin", is_admin=True)
    ensure_defaults(db)

    before = (
        db.query(LegalDocumentVersion)
        .filter_by(document_type="terms", locale="de")
        .count()
    )
    assert before == 1

    resp = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"legal_terms_body_de": "Updated terms text"},
    )
    assert resp.status_code == 200
    assert resp.json()["legal_version"] == "1"  # auto-bumped from 0

    rows = (
        db.query(LegalDocumentVersion)
        .filter_by(document_type="terms", locale="de")
        .order_by(LegalDocumentVersion.published_at)
        .all()
    )
    assert len(rows) == 2
    assert rows[0].version == "0"
    assert rows[0].body != rows[1].body
    assert rows[1].body == "Updated terms text"
    assert rows[1].version == "1"


# --- Atomic commit boundary (#889) ------------------------------------------


def test_update_settings_rolls_back_everything_if_snapshot_fails(
    db, session_factory, monkeypatch
):
    """A failure while snapshotting must not leave the version bump or the
    audit entry committed — settings, version, audit and snapshot rise or
    fall together."""
    admin = make_user(db, "admin", is_admin=True)
    ensure_defaults(db)
    db.commit()

    def boom(_db):
        raise RuntimeError("simulated snapshot failure")

    monkeypatch.setattr(settings_service, "snapshot_current_legal_versions", boom)

    payload = SettingsUpdate(legal_terms_body_de="Text that must not survive")
    with pytest.raises(RuntimeError):
        update_settings(db, payload, actor=admin)
    db.rollback()

    fresh = session_factory()
    try:
        assert (
            get_setting(fresh, legal_body_setting_key("terms", "de"), "")
            != "Text that must not survive"
        )
        assert get_setting(fresh, "legal_version", None) == "0"
        assert fresh.query(AdminAuditLog).count() == 0
    finally:
        fresh.close()


def test_update_settings_rolls_back_snapshot_if_final_commit_fails(
    db, session_factory, monkeypatch
):
    """A failure at the single commit boundary must roll back the snapshot
    rows too, not just the settings — proving they share one transaction."""
    admin = make_user(db, "admin", is_admin=True)
    ensure_defaults(db)
    db.commit()
    versions_before = db.query(LegalDocumentVersion).count()

    def boom():
        raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(db, "commit", boom)

    payload = SettingsUpdate(legal_terms_body_de="Text that must not survive either")
    with pytest.raises(RuntimeError):
        update_settings(db, payload, actor=admin)
    db.rollback()

    fresh = session_factory()
    try:
        assert (
            get_setting(fresh, legal_body_setting_key("terms", "de"), "")
            != "Text that must not survive either"
        )
        assert get_setting(fresh, "legal_version", None) == "0"
        assert fresh.query(LegalDocumentVersion).count() == versions_before
    finally:
        fresh.close()


def test_resaving_unchanged_text_does_not_bump_or_duplicate(client, db):
    admin = make_user(db, "admin", is_admin=True)
    ensure_defaults(db)

    # Whitespace-free so a resubmission is byte-for-byte identical after the
    # update_settings() `.strip()` normalization.
    fixed_body = "Fixed terms body with no leading or trailing whitespace."
    resp1 = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"legal_terms_body_de": fixed_body},
    )
    assert resp1.status_code == 200
    assert resp1.json()["legal_version"] == "1"  # bumped 0 -> 1 by the edit
    count_after_first = (
        db.query(LegalDocumentVersion)
        .filter_by(document_type="terms", locale="de")
        .count()
    )

    # Re-submit the identical body — no content change, so no version bump and
    # no new snapshot row.
    resp2 = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"legal_terms_body_de": fixed_body},
    )
    assert resp2.status_code == 200
    assert resp2.json()["legal_version"] == "1"  # unchanged

    rows = (
        db.query(LegalDocumentVersion)
        .filter_by(document_type="terms", locale="de")
        .all()
    )
    assert len(rows) == count_after_first
    matching = [r for r in rows if r.body == fixed_body]
    assert len(matching) == 1
    assert matching[0].version == "1"


def test_accept_legal_records_matching_content_hashes(client, db):
    ensure_defaults(db)
    alice = make_user(db, "alice", legal_accepted=False)

    public = client.get(f"{API}/legal/public")
    assert public.status_code == 200
    terms_body = public.json()["terms_body"]
    privacy_body = public.json()["privacy_body"]

    res = client.post(f"{API}/legal/accept", headers=auth(alice))
    assert res.status_code == 200

    row = db.query(LegalAcceptance).one()
    assert row.terms_hash == content_hash(terms_body)
    assert row.privacy_hash == content_hash(privacy_body)

    # And that hash must resolve to a stored, immutable version row.
    snapshot = (
        db.query(LegalDocumentVersion)
        .filter_by(document_type="terms", content_hash=row.terms_hash)
        .one_or_none()
    )
    assert snapshot is not None
    assert snapshot.body == terms_body


def test_accept_legal_snapshots_even_without_prior_ensure_defaults(client, db):
    """POST /legal/accept must itself guarantee a resolvable snapshot exists."""
    alice = make_user(db, "alice", legal_accepted=False)
    # Seed the bodies the way ensure_defaults() would, but skip calling it,
    # to simulate accept being the first thing to touch the version table.
    from app.services.system.settings_service import DEFAULTS, set_setting

    legal_keys = (
        "legal_terms_body_de",
        "legal_terms_body_en",
        "legal_privacy_body_de",
        "legal_privacy_body_en",
        "legal_imprint_body_de",
        "legal_imprint_body_en",
        "legal_version",
    )
    for key in legal_keys:
        set_setting(db, key, DEFAULTS[key])
    db.commit()

    assert db.query(LegalDocumentVersion).count() == 0

    res = client.post(f"{API}/legal/accept", headers=auth(alice))
    assert res.status_code == 200

    row = db.query(LegalAcceptance).one()
    assert row.terms_hash is not None
    snapshot = (
        db.query(LegalDocumentVersion)
        .filter_by(document_type="terms", content_hash=row.terms_hash)
        .one_or_none()
    )
    assert snapshot is not None


def test_list_legal_versions_requires_admin(client, db):
    ensure_defaults(db)
    alice = make_user(db, "alice")
    resp = client.get(f"{API}/legal/versions", headers=auth(alice))
    assert resp.status_code == 403


def test_list_legal_versions_requires_auth(client, db):
    ensure_defaults(db)
    resp = client.get(f"{API}/legal/versions")
    assert resp.status_code == 401


def test_list_legal_versions_returns_newest_first(client, db):
    admin = make_user(db, "admin", is_admin=True)
    ensure_defaults(db)
    client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"legal_terms_body_de": "A newer terms revision"},
    )

    resp = client.get(f"{API}/legal/versions", headers=auth(admin))
    assert resp.status_code == 200
    body = resp.json()
    terms_rows = [
        r
        for r in body
        if r["document_type"] == "terms" and r["locale"] == "de"
    ]
    assert len(terms_rows) == 2
    # Newest first.
    assert terms_rows[0]["published_at"] >= terms_rows[1]["published_at"]
    for r in body:
        assert set(r.keys()) == {
            "id",
            "document_type",
            "locale",
            "version",
            "content_hash",
            "published_at",
        }


def test_get_legal_version_detail_requires_admin_and_returns_body(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice")
    ensure_defaults(db)

    listing = client.get(f"{API}/legal/versions", headers=auth(admin))
    version_id = listing.json()[0]["id"]

    forbidden = client.get(
        f"{API}/legal/versions/{version_id}", headers=auth(alice)
    )
    assert forbidden.status_code == 403

    detail = client.get(f"{API}/legal/versions/{version_id}", headers=auth(admin))
    assert detail.status_code == 200
    body = detail.json()
    assert body["id"] == version_id
    assert "body" in body and body["body"]


def test_get_legal_version_detail_404_for_unknown_id(client, db):
    admin = make_user(db, "admin", is_admin=True)
    resp = client.get(f"{API}/legal/versions/does-not-exist", headers=auth(admin))
    assert resp.status_code == 404
