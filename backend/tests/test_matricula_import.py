"""Public Matricula import: page selection, bounded downloads and access gates."""

import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from app.core.config import Settings
from app.core.rate_limit import matricula_rate_limiter
from app.models import Document, DocumentUpload
from app.services.documents import matricula
from tests.conftest import API, auth, make_user, share

VIEWER = "https://data.matricula-online.eu/en/oesterreich/wien/book/?pg=2"
IMAGE_HOST = "https://hosted-images.matricula-online.eu/images/matricula/"


def _page(*urls):
    files = [
        "/image/" + base64.urlsafe_b64encode(url.encode()).decode().rstrip("=") + "/"
        for url in urls
    ]
    return '<script>var viewer = {"files": ' + json.dumps(files) + "};</script>"


def _jpeg():
    stream = BytesIO()
    Image.new("RGB", (16, 12), "white").save(stream, format="JPEG")
    return stream.getvalue()


@pytest.fixture(autouse=True)
def reset_limiter():
    matricula_rate_limiter.clear()


def _transport(monkeypatch, handler):
    monkeypatch.setattr(matricula, "HTTP_TRANSPORT", httpx.MockTransport(handler))


def test_fetches_selected_scan_without_creating_documents(
    client, db, tree, headers, monkeypatch
):
    requests = []
    jpeg = _jpeg()

    def handler(request):
        requests.append(str(request.url))
        assert "authorization" not in request.headers
        if request.url.host == "data.matricula-online.eu":
            return httpx.Response(
                200,
                text=_page(
                    IMAGE_HOST + "first.jpg",
                    IMAGE_HOST.replace("https:", "http:") + "second.jpg",
                ),
                headers={"Content-Type": "text/html; charset=utf-8"},
            )
        return httpx.Response(200, content=jpeg, headers={"Content-Type": "image/jpeg"})

    _transport(monkeypatch, handler)
    response = client.get(
        f"{API}/workspaces/{tree.id}/documents/matricula-image",
        params={"url": VIEWER},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.content == jpeg
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "no-store"
    assert 'filename="matricula-page-2.jpg"' in response.headers["content-disposition"]
    assert requests == [VIEWER, IMAGE_HOST + "second.jpg"]
    assert db.query(Document).count() == 0
    assert db.query(DocumentUpload).count() == 0


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/",
        "http://127.0.0.1/",
        "file:///etc/passwd",
        "https://data.matricula-online.eu.example.com/",
        "https://data.matricula-online.eu:8000/",
        "https://user:password@data.matricula-online.eu/",
        VIEWER.replace("pg=2", "pg=0"),
        VIEWER.replace("pg=2", "pg=-1"),
        VIEWER.replace("pg=2", "pg=invalid"),
    ],
)
def test_rejects_invalid_input_before_any_request(monkeypatch, url):
    def handler(request):
        pytest.fail(f"Unexpected network request: {request.url}")

    _transport(monkeypatch, handler)
    with pytest.raises(matricula.MatriculaImportError) as error:
        matricula.fetch_matricula_image(url)
    assert error.value.status == 400


@pytest.mark.parametrize("image_redirect", [False, True])
def test_never_follows_redirects_to_other_hosts(monkeypatch, image_redirect):
    requests = []

    def handler(request):
        requests.append(str(request.url))
        if image_redirect and request.url.host == "data.matricula-online.eu":
            return httpx.Response(
                200,
                text=_page(IMAGE_HOST + "a.jpg"),
                headers={"Content-Type": "text/html"},
            )
        return httpx.Response(302, headers={"Location": "http://127.0.0.1/private"})

    _transport(monkeypatch, handler)
    with pytest.raises(matricula.MatriculaImportError):
        matricula.fetch_matricula_image(VIEWER.replace("pg=2", "pg=1"))
    assert len(requests) == (2 if image_redirect else 1)


def test_rejects_external_decoded_image_url(monkeypatch):
    requests = []

    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(
            200,
            text=_page("http://169.254.169.254/latest/meta-data"),
            headers={"Content-Type": "text/html"},
        )

    _transport(monkeypatch, handler)
    with pytest.raises(matricula.MatriculaImportError):
        matricula.fetch_matricula_image(VIEWER.replace("pg=2", "pg=1"))
    assert len(requests) == 1


@pytest.mark.parametrize(
    "html", ["<h1>No scan</h1>", '{"files": []}', '{"files": ["/image/bad/"]}']
)
def test_handles_missing_or_invalid_scan_metadata(monkeypatch, html):
    _transport(
        monkeypatch,
        lambda _: httpx.Response(200, text=html, headers={"Content-Type": "text/html"}),
    )
    with pytest.raises(matricula.MatriculaImportError):
        matricula.fetch_matricula_image(VIEWER.replace("pg=2", "pg=1"))


@pytest.mark.parametrize("announced", [False, True])
def test_bounds_image_downloads_with_or_without_content_length(monkeypatch, announced):
    monkeypatch.setattr(matricula, "MAX_IMAGE_BYTES", 16)

    def handler(request):
        if request.url.host == "data.matricula-online.eu":
            return httpx.Response(
                200,
                text=_page(IMAGE_HOST + "a.jpg"),
                headers={"Content-Type": "text/html"},
            )
        headers = {"Content-Length": "100"} if announced else {}
        return httpx.Response(200, stream=httpx.ByteStream(b"x" * 100), headers=headers)

    _transport(monkeypatch, handler)
    with pytest.raises(matricula.MatriculaImportError) as error:
        matricula.fetch_matricula_image(VIEWER.replace("pg=2", "pg=1"))
    assert error.value.code == "matricula_too_large"


@pytest.mark.parametrize("timeout", [False, True])
def test_reports_upstream_failures(client, tree, headers, monkeypatch, timeout):
    def handler(request):
        if timeout:
            raise httpx.ReadTimeout("Timed out", request=request)
        return httpx.Response(403)

    _transport(monkeypatch, handler)
    response = client.get(
        f"{API}/workspaces/{tree.id}/documents/matricula-image",
        params={"url": VIEWER},
        headers=headers,
    )
    assert response.status_code == (504 if timeout else 502)


def test_requires_authenticated_write_access(client, db, tree, monkeypatch):
    def handler(request):
        pytest.fail("Unauthorized request must not fetch anything")

    _transport(monkeypatch, handler)
    path = f"{API}/workspaces/{tree.id}/documents/matricula-image"
    assert client.get(path, params={"url": VIEWER}).status_code == 401
    viewer = make_user(db, "viewer")
    share(db, tree, viewer, role="viewer")
    assert (
        client.get(path, params={"url": VIEWER}, headers=auth(viewer)).status_code == 403
    )


def test_rate_limits_imports(client, tree, headers, monkeypatch):
    monkeypatch.setattr(matricula_rate_limiter, "max_attempts", 2)
    _transport(monkeypatch, lambda _: httpx.Response(503))
    path = f"{API}/workspaces/{tree.id}/documents/matricula-image"
    for _ in range(2):
        assert (
            client.get(path, params={"url": VIEWER}, headers=headers).status_code == 502
        )
    response = client.get(path, params={"url": VIEWER}, headers=headers)
    assert response.status_code == 429
    assert "retry-after" in response.headers


def test_invalid_utf8_page_is_reported_as_missing_page(monkeypatch):
    _transport(
        monkeypatch,
        lambda _: httpx.Response(
            200, content=b"\xff\xfe not UTF-8", headers={"Content-Type": "text/html"}
        ),
    )
    with pytest.raises(matricula.MatriculaImportError) as error:
        matricula.fetch_matricula_image(VIEWER)
    assert error.value.code == "matricula_page_not_found"
    assert error.value.status == 422


def test_import_budget_can_be_configured_from_environment(monkeypatch):
    monkeypatch.setenv("MATRICULA_MAX_REQUESTS", "3")
    monkeypatch.setenv("MATRICULA_RATE_LIMIT_WINDOW_SECONDS", "120")
    configured = Settings(_env_file=None)
    assert configured.MATRICULA_MAX_REQUESTS == 3
    assert configured.MATRICULA_RATE_LIMIT_WINDOW_SECONDS == 120


def test_rejects_non_images_even_when_upstream_claims_jpeg(monkeypatch):
    def handler(request):
        if request.url.host == "data.matricula-online.eu":
            return httpx.Response(
                200,
                text=_page(IMAGE_HOST + "scan.jpg"),
                headers={"Content-Type": "text/html"},
            )
        return httpx.Response(
            200,
            content=b"<html>Image unavailable</html>",
            headers={"Content-Type": "image/jpeg"},
        )

    _transport(monkeypatch, handler)
    with pytest.raises(matricula.MatriculaImportError) as error:
        matricula.fetch_matricula_image(VIEWER.replace("pg=2", "pg=1"))
    assert error.value.code == "matricula_unsupported_image"
