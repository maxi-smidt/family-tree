"""AI transcription of document files with a person's own provider (#1123)."""

import base64
import io
import json

import httpx
import pytest
from PIL import Image

from app.core import secret_box
from app.core.config import settings
from app.models import DocumentFileTranscription, UserAiSettings
from app.services.ai import providers
from app.services.ai.ai_settings import TRANSCRIPTION_PROMPT
from tests.conftest import API, add_member, auth, make_tree, make_user, share

GEMINI_KEY = "AIzaSy-test-key-0123456789"
SETTINGS_URL = f"{API}/users/me/ai-settings"


@pytest.fixture()
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return settings.media_root


def _gemini_reply(text: str) -> httpx.Response:
    return httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]}
    )


@pytest.fixture()
def provider_calls(monkeypatch):
    """Answer every provider call from ``calls.reply`` and record the requests."""

    class Calls(list):
        reply: httpx.Response = _gemini_reply("# Brief\n\nLieber")

    calls = Calls()

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return calls.reply

    monkeypatch.setattr(providers, "HTTP_TRANSPORT", httpx.MockTransport(handler))
    return calls


def _photo_with_exif() -> bytes:
    image = Image.new("RGB", (40, 30), "white")
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"  # Make
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def _setup(db, client, *, configure=True):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="A")
    if configure:
        response = client.put(
            SETTINGS_URL,
            headers=auth(user),
            json={"provider": "gemini", "model": "gemini-test", "api_key": GEMINI_KEY},
        )
        assert response.status_code == 200, response.text
    return user, tree


def _upload(client, user, tree, content, filename, mime):
    staged = client.post(
        f"{API}/workspaces/{tree.id}/documents/uploads",
        headers=auth(user),
        data={"filename": filename},
        files={"file": (filename, content, mime)},
    )
    assert staged.status_code == 201, staged.text
    saved = client.put(
        f"{API}/workspaces/{tree.id}/documents/doc-1",
        headers=auth(user),
        json={"title": "Letter", "attached_upload_ids": [staged.json()["id"]]},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()["files"][0]["id"]


def _file_url(tree, file_id):
    return f"{API}/workspaces/{tree.id}/documents/doc-1/files/{file_id}"


def _file_row(client, user, tree):
    docs = client.get(f"{API}/workspaces/{tree.id}/documents", headers=auth(user)).json()
    return docs[0]["files"][0]


# --- Settings -----------------------------------------------------------------


def test_secret_box_binds_the_context():
    sealed = secret_box.seal("key", purpose="p", context="user-1")
    assert "key" not in sealed
    assert secret_box.unseal(sealed, purpose="p", context="user-1") == "key"
    with pytest.raises(secret_box.SecretUnreadable):
        secret_box.unseal(sealed, purpose="p", context="user-2")


def test_settings_start_empty(client, db):
    user = make_user(db, "alice")
    body = client.get(SETTINGS_URL, headers=auth(user)).json()
    assert body["configured"] is False
    assert "prompt" not in body
    assert {p["id"] for p in body["providers"]} == {
        "gemini",
        "openai",
        "anthropic",
        "openai_compatible",
    }


def test_api_key_is_stored_sealed_and_never_returned(client, db):
    user, _ = _setup(db, client)
    body = client.get(SETTINGS_URL, headers=auth(user)).json()
    assert body["configured"] is True
    assert body["has_api_key"] is True
    assert body["api_key_hint"] == GEMINI_KEY[-4:]
    assert GEMINI_KEY not in json.dumps(body)
    row = db.get(UserAiSettings, user.id)
    db.refresh(row)
    assert GEMINI_KEY not in row.api_key_sealed

    # Saving again without a key keeps it.
    again = client.put(
        SETTINGS_URL, headers=auth(user), json={"provider": "gemini", "model": ""}
    ).json()
    assert again["has_api_key"] is True
    assert again["model"] == "gemini-3.8-flash"


def test_switching_provider_needs_a_new_key(client, db):
    user, _ = _setup(db, client)
    response = client.put(
        SETTINGS_URL, headers=auth(user), json={"provider": "anthropic", "model": ""}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "api_key_required"


def test_unreadable_key_after_secret_rotation(client, db, monkeypatch):
    user, _ = _setup(db, client)
    monkeypatch.setattr(settings, "SECRET_KEY", "another-secret-key-of-at-least-32-chars")
    body = client.get(SETTINGS_URL, headers=auth(user)).json()
    assert body["api_key_unreadable"] is True
    assert body["configured"] is False


def test_custom_endpoint_is_admin_only(client, db):
    user = make_user(db, "alice")
    body = {"provider": "openai_compatible", "base_url": "http://ollama:11434/v1"}
    assert client.put(SETTINGS_URL, headers=auth(user), json=body).status_code == 403
    admin = make_user(db, "root", is_admin=True)
    saved = client.put(SETTINGS_URL, headers=auth(admin), json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["configured"] is True


def test_delete_forgets_the_settings(client, db):
    user, _ = _setup(db, client)
    assert client.delete(SETTINGS_URL, headers=auth(user)).json()["configured"] is False
    assert db.get(UserAiSettings, user.id) is None


# --- Transcription ------------------------------------------------------------


def test_transcribe_fills_the_text(client, db, media_root, provider_calls):
    user, tree = _setup(db, client)
    file_id = _upload(client, user, tree, _photo_with_exif(), "brief.jpg", "image/jpeg")

    started = client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(user))
    assert started.status_code == 202, started.text

    (request,) = provider_calls
    assert request.headers["x-goog-api-key"] == GEMINI_KEY
    assert "models/gemini-test:generateContent" in str(request.url)
    parts = json.loads(request.content)["contents"][0]["parts"]
    assert parts[0]["text"] == TRANSCRIPTION_PROMPT
    sent = parts[1]["inline_data"]
    sent_image = Image.open(io.BytesIO(base64.b64decode(sent["data"])))
    assert sent["mime_type"] == "image/jpeg"
    assert 0x010F not in sent_image.getexif()  # metadata stripped

    row = _file_row(client, user, tree)
    assert row["has_text"] is True
    assert row["transcription_status"] == "done"
    text = client.get(f"{_file_url(tree, file_id)}/text", headers=auth(user)).json()
    assert text["markdown"] == "# Brief\n\nLieber"
    assert text["machine_markdown"] == "# Brief\n\nLieber"
    assert text["source"] == "ai"
    assert text["provider"] == "gemini"


def test_rerun_keeps_a_human_edit(client, db, media_root, provider_calls):
    user, tree = _setup(db, client)
    file_id = _upload(client, user, tree, _photo_with_exif(), "brief.jpg", "image/jpeg")
    client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(user))
    client.put(
        f"{_file_url(tree, file_id)}/text",
        headers=auth(user),
        json={"markdown": "# Brief\n\nLieber Johann"},
    )

    provider_calls.reply = httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": "Neu"}]}}]}
    )
    client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(user))

    text = client.get(f"{_file_url(tree, file_id)}/text", headers=auth(user)).json()
    assert text["markdown"] == "# Brief\n\nLieber Johann"
    assert text["machine_markdown"] == "Neu"
    assert text["status"] == "review"

    # Keeping (or taking) a version answers the waiting one.
    kept = client.put(
        f"{_file_url(tree, file_id)}/text",
        headers=auth(user),
        json={"markdown": "# Brief\n\nLieber Johann"},
    ).json()
    assert kept["status"] is None


def test_editing_the_ai_text_is_not_a_new_ai_version(
    client, db, media_root, provider_calls
):
    user, tree = _setup(db, client)
    file_id = _upload(client, user, tree, _photo_with_exif(), "brief.jpg", "image/jpeg")
    client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(user))
    edited = client.put(
        f"{_file_url(tree, file_id)}/text",
        headers=auth(user),
        json={"markdown": "# Brief\n\nLieber Johann"},
    ).json()
    assert edited["status"] is None
    assert edited["source"] == "manual"


def test_failure_is_recorded_without_the_key(client, db, media_root, provider_calls):
    user, tree = _setup(db, client)
    file_id = _upload(client, user, tree, _photo_with_exif(), "brief.jpg", "image/jpeg")
    provider_calls.reply = httpx.Response(
        400, json={"error": {"message": f"API key {GEMINI_KEY} not valid"}}
    )

    client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(user))

    row = _file_row(client, user, tree)
    assert row["has_text"] is False
    assert row["transcription_status"] == "failed"
    assert row["transcription_error"].startswith("provider_error: HTTP 400")
    assert GEMINI_KEY not in row["transcription_error"]


def test_stale_pending_run_reads_as_interrupted(client, db, media_root, provider_calls):
    user, tree = _setup(db, client)
    file_id = _upload(client, user, tree, _photo_with_exif(), "brief.jpg", "image/jpeg")
    db.add(
        DocumentFileTranscription(
            document_file_id=file_id,
            workspace_id=tree.id,
            requested_by=user.id,
            provider="gemini",
            model="gemini-test",
            status="pending",
            created_at="2020-01-01T00:00:00+00:00",
            updated_at="2020-01-01T00:00:00+00:00",
        )
    )
    db.commit()
    row = _file_row(client, user, tree)
    assert row["transcription_status"] == "failed"
    assert row["transcription_error"] == "interrupted"
    # ...and can be started again.
    started = client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(user))
    assert started.status_code == 202


def test_nothing_is_sent_without_settings(client, db, media_root, provider_calls):
    user, tree = _setup(db, client, configure=False)
    file_id = _upload(client, user, tree, _photo_with_exif(), "brief.jpg", "image/jpeg")
    response = client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(user))
    assert response.status_code == 400
    assert response.json()["detail"] == "ai_not_configured"
    assert provider_calls == []


def test_unsupported_file_types_are_refused(client, db, media_root, provider_calls):
    user, tree = _setup(db, client)
    file_id = _upload(client, user, tree, b"hello", "note.txt", "text/plain")
    response = client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(user))
    assert response.status_code == 400
    assert response.json()["detail"] == "unsupported_file"
    assert provider_calls == []


def test_viewers_cannot_transcribe(client, db, media_root, provider_calls):
    user, tree = _setup(db, client)
    file_id = _upload(client, user, tree, _photo_with_exif(), "brief.jpg", "image/jpeg")
    viewer = make_user(db, "bob")
    share(db, tree, viewer, role="viewer")
    response = client.post(f"{_file_url(tree, file_id)}/transcribe", headers=auth(viewer))
    assert response.status_code == 403
    assert provider_calls == []


# --- Adapters -----------------------------------------------------------------


def _pdf():
    return providers.TranscriptionInput(b"%PDF-1.4", "application/pdf")


def test_anthropic_adapter_sends_pdfs_as_documents(provider_calls):
    provider_calls.reply = httpx.Response(
        200, json={"content": [{"type": "text", "text": "```markdown\n# A\n```"}]}
    )
    provider = providers.create_provider(
        "anthropic", model="claude-x", api_key="sk-ant", base_url=None
    )
    text = providers.clean_markdown(provider.transcribe("Read it", _pdf()))
    assert text == "# A"
    body = json.loads(provider_calls[0].content)
    assert body["messages"][0]["content"][0]["type"] == "document"
    assert provider_calls[0].headers["x-api-key"] == "sk-ant"


def test_openai_compatible_adapter_uses_the_custom_endpoint(provider_calls):
    provider_calls.reply = httpx.Response(
        200, json={"choices": [{"message": {"content": "Text"}}]}
    )
    provider = providers.create_provider(
        "openai_compatible", model="llava", api_key=None, base_url="http://ollama/v1/"
    )
    image = providers.TranscriptionInput(b"img", "image/png")
    assert provider.transcribe("Read it", image) == "Text"
    assert str(provider_calls[0].url) == "http://ollama/v1/chat/completions"
    assert "authorization" not in provider_calls[0].headers
    assert providers.OpenAICompatibleProvider.supports_pdf is False
