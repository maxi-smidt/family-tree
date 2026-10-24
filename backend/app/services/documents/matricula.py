"""Fetch one public Matricula scan; editing and attachment happen in the client.

Only Matricula's viewer and original-image hosts are accepted, including after
redirects. No scripts from the viewer are evaluated and no files are persisted.
"""

import base64
import binascii
import json
import re
import time
import warnings
from dataclasses import dataclass
from io import BytesIO
from urllib.parse import parse_qs, urljoin, urlsplit, urlunsplit

import httpx
from PIL import Image, UnidentifiedImageError

from app.core.rate_limit import RateLimiter

MAX_PAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGE_BYTES = 50 * 1024 * 1024
HTTP_TRANSPORT: httpx.BaseTransport | None = None
matricula_rate_limiter = RateLimiter(10, 60)


class MatriculaImportError(Exception):
    def __init__(self, code: str, status: int = 502):
        self.code = code
        self.status = status
        super().__init__(code)


@dataclass(frozen=True)
class MatriculaImage:
    content: bytes
    media_type: str
    filename: str


def _safe_url(value: str, *, image: bool = False) -> str:
    """An exact host allowlist, HTTPS, standard ports and no credentials."""
    try:
        url = urlsplit(value)
        host = (
            "hosted-images.matricula-online.eu" if image else "data.matricula-online.eu"
        )
        if (
            url.scheme not in {"http", "https"}
            or url.hostname != host
            or url.port not in {None, 80, 443}
            or url.username is not None
            or url.password is not None
            or "\\" in value
            or any(ord(character) < 32 for character in value)
            or (image and not url.path.startswith("/images/matricula/"))
        ):
            raise ValueError("Unsupported Matricula URL")
        return urlunsplit(("https", host, url.path, url.query, ""))
    except ValueError as exc:
        raise MatriculaImportError("matricula_invalid_url", 400) from exc


def _get(
    client: httpx.Client,
    url: str,
    *,
    image: bool,
    deadline: float,
) -> bytes:
    limit = MAX_IMAGE_BYTES if image else MAX_PAGE_BYTES
    for _ in range(4):
        url = _safe_url(url, image=image)
        if time.monotonic() > deadline:
            raise MatriculaImportError("matricula_timeout", 504)
        with client.stream("GET", url) as response:
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    break
                # Validate BEFORE following; the client never follows redirects itself.
                url = _safe_url(urljoin(url, location), image=image)
                continue
            response.raise_for_status()
            if not image and "text/html" not in response.headers.get("content-type", ""):
                raise MatriculaImportError("matricula_page_not_found", 422)
            content_length = response.headers.get("content-length", "")
            if content_length.isdecimal() and int(content_length) > limit:
                raise MatriculaImportError("matricula_too_large", 413)
            result = bytearray()
            for chunk in response.iter_bytes(64 * 1024):
                if time.monotonic() > deadline:
                    raise MatriculaImportError("matricula_timeout", 504)
                if len(result) + len(chunk) > limit:
                    raise MatriculaImportError("matricula_too_large", 413)
                result.extend(chunk)
            return bytes(result)
    raise MatriculaImportError("matricula_unavailable")


def fetch_matricula_image(value: str) -> MatriculaImage:
    url = _safe_url(value.strip())
    try:
        query = parse_qs(urlsplit(url).query, max_num_fields=30)
        page_value = query.get("pg", ["1"])[0]
        if not re.fullmatch(r"[0-9]{1,7}", page_value) or int(page_value) < 1:
            raise ValueError("Invalid page")
        page = int(page_value)
    except ValueError as exc:
        raise MatriculaImportError("matricula_invalid_page", 400) from exc

    try:
        deadline = time.monotonic() + 45
        with httpx.Client(
            timeout=httpx.Timeout(15, connect=5),
            follow_redirects=False,
            transport=HTTP_TRANSPORT,
            headers={"User-Agent": "FamilyTree Matricula image importer"},
        ) as client:
            html = _get(client, url, image=False, deadline=deadline).decode("utf-8")
            match = re.search(r'"files"\s*:\s*(\[[^\]]*\])', html)
            if not match:
                raise MatriculaImportError("matricula_page_not_found", 422)
            try:
                files = json.loads(match[1])
                if page > len(files):
                    raise MatriculaImportError("matricula_invalid_page", 422)
                path = files[page - 1]
                image_path = re.fullmatch(r"/image/([A-Za-z0-9_-]+)/?", path)
                if image_path is None:
                    raise ValueError("Unsupported scan path")
                token = image_path[1]
                image_url = base64.b64decode(
                    token + "=" * (-len(token) % 4), altchars=b"-_", validate=True
                ).decode("utf-8")
            except (ValueError, TypeError, binascii.Error, UnicodeError) as exc:
                raise MatriculaImportError("matricula_page_not_found", 422) from exc
            # Decoded URLs are untrusted input, subject to the same allowlist.
            content = _get(client, image_url, image=True, deadline=deadline)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as scan:
                formats = {
                    "JPEG": ("image/jpeg", "jpg"),
                    "PNG": ("image/png", "png"),
                    "WEBP": ("image/webp", "webp"),
                    "GIF": ("image/gif", "gif"),
                }
                if scan.format not in formats:
                    raise MatriculaImportError("matricula_unsupported_image", 422)
                media_type, extension = formats[scan.format]
                scan.verify()
        return MatriculaImage(content, media_type, f"matricula-page-{page}.{extension}")
    except httpx.TimeoutException as exc:
        raise MatriculaImportError("matricula_timeout", 504) from exc
    except httpx.HTTPError as exc:
        raise MatriculaImportError("matricula_unavailable") from exc
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        UnicodeError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise MatriculaImportError("matricula_unsupported_image", 422) from exc
