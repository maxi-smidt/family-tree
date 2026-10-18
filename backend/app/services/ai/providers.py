"""Adapters for the AI providers that can transcribe a document file.

Each provider speaks its own HTTP API behind the same small interface,
:class:`TranscriptionProvider`; :func:`create_provider` picks the adapter for a
person's settings. Adding a provider means one subclass plus one entry in
``PROVIDERS``.
"""

from __future__ import annotations

import base64
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar
from urllib.parse import quote

import httpx

# Generous: a handwritten multi-page PDF can take a model a few minutes.
REQUEST_TIMEOUT = httpx.Timeout(300.0, connect=15.0)

# Tests swap this for an ``httpx.MockTransport``; ``None`` is the real network.
HTTP_TRANSPORT: httpx.BaseTransport | None = None

_ERROR_DETAIL_MAX = 300


@dataclass(frozen=True)
class TranscriptionInput:
    data: bytes
    mime_type: str


class AiProviderError(Exception):
    """A provider call failed. ``code`` is stable; ``detail`` is for people.

    Never carries the API key: :meth:`TranscriptionProvider._post` scrubs it
    from anything a provider echoes back.
    """

    def __init__(self, code: str, detail: str | None = None) -> None:
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}" if detail else code)


class TranscriptionProvider(ABC):
    id: ClassVar[str]
    label: ClassVar[str]
    default_model: ClassVar[str]
    needs_api_key: ClassVar[bool] = True
    # The person sets the endpoint (self-hosted or other OpenAI-compatible
    # servers). Admin-only: the server would call any address it is given.
    custom_base_url: ClassVar[bool] = False
    supports_pdf: ClassVar[bool] = True

    def __init__(self, *, model: str, api_key: str | None, base_url: str | None) -> None:
        self.model = model
        self.api_key = api_key
        self.base_url = base_url

    @abstractmethod
    def transcribe(self, prompt: str, file: TranscriptionInput) -> str:
        """Return the model's text for *file* following *prompt*."""

    def _post(self, url: str, *, headers: dict[str, str], body: dict[str, Any]) -> Any:
        try:
            with httpx.Client(
                timeout=REQUEST_TIMEOUT, transport=HTTP_TRANSPORT
            ) as client:
                response = client.post(url, headers=headers, json=body)
        except httpx.TimeoutException as exc:
            raise AiProviderError("timeout") from exc
        except httpx.HTTPError as exc:
            raise AiProviderError("unreachable", self._scrub(type(exc).__name__)) from exc
        if response.status_code >= 400:
            raise AiProviderError(
                "provider_error",
                self._scrub(
                    f"HTTP {response.status_code}: {_error_message(response)}".rstrip(
                        ": "
                    )
                ),
            )
        try:
            return response.json()
        except ValueError as exc:
            raise AiProviderError("provider_error", "The response was not JSON") from exc

    def _scrub(self, text: str) -> str:
        if self.api_key:
            text = text.replace(self.api_key, "***")
        return text[:_ERROR_DETAIL_MAX]


def _error_message(response: httpx.Response) -> str:
    """The provider's own error message, if its body has one."""
    try:
        body = response.json()
    except ValueError:
        return ""
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return error["message"]
    if isinstance(error, str):
        return error
    return ""


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


class GeminiProvider(TranscriptionProvider):
    """Google Gemini through its native ``generateContent`` API."""

    id = "gemini"
    label = "Google Gemini"
    default_model = "gemini-2.5-pro"
    endpoint = "https://generativelanguage.googleapis.com/v1beta"

    def transcribe(self, prompt: str, file: TranscriptionInput) -> str:
        model = self.model.removeprefix("models/")
        body = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": file.mime_type,
                                "data": _b64(file.data),
                            }
                        },
                    ],
                }
            ],
            "generationConfig": {"temperature": 0},
        }
        data = self._post(
            f"{self.endpoint}/models/{quote(model, safe='')}:generateContent",
            headers={"x-goog-api-key": self.api_key or ""},
            body=body,
        )
        candidates = data.get("candidates") or []
        if not candidates:
            reason = (data.get("promptFeedback") or {}).get("blockReason")
            raise AiProviderError("blocked", reason)
        parts = (candidates[0].get("content") or {}).get("parts") or []
        return "".join(p.get("text", "") for p in parts if not p.get("thought"))


class OpenAIProvider(TranscriptionProvider):
    """OpenAI's Chat Completions API (images and PDFs)."""

    id = "openai"
    label = "OpenAI"
    default_model = "gpt-5"
    endpoint = "https://api.openai.com/v1"

    def _base(self) -> str:
        return self.endpoint

    def _file_part(self, file: TranscriptionInput) -> dict[str, Any]:
        data_url = f"data:{file.mime_type};base64,{_b64(file.data)}"
        if file.mime_type == "application/pdf":
            return {
                "type": "file",
                "file": {"filename": "document.pdf", "file_data": data_url},
            }
        return {"type": "image_url", "image_url": {"url": data_url}}

    def transcribe(self, prompt: str, file: TranscriptionInput) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        body = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": prompt}, self._file_part(file)],
                }
            ],
        }
        data = self._post(f"{self._base()}/chat/completions", headers=headers, body=body)
        choices = data.get("choices") or []
        if not choices:
            raise AiProviderError("empty_result")
        content = (choices[0].get("message") or {}).get("content")
        if isinstance(content, list):
            return "".join(p.get("text", "") for p in content if isinstance(p, dict))
        return content or ""


class OpenAICompatibleProvider(OpenAIProvider):
    """Any server with an OpenAI-compatible Chat Completions API and image
    input: Ollama, LM Studio, vLLM, OpenRouter, ... Images only, since PDF
    input is not part of what these servers share."""

    id = "openai_compatible"
    label = "OpenAI-compatible"
    default_model = "qwen2.5vl"
    needs_api_key = False
    custom_base_url = True
    supports_pdf = False

    def _base(self) -> str:
        return (self.base_url or "").rstrip("/")


class AnthropicProvider(TranscriptionProvider):
    """Anthropic's Messages API (images and PDFs)."""

    id = "anthropic"
    label = "Anthropic Claude"
    default_model = "claude-sonnet-5-5"
    endpoint = "https://api.anthropic.com/v1"
    max_tokens = 16000

    def transcribe(self, prompt: str, file: TranscriptionInput) -> str:
        kind = "document" if file.mime_type == "application/pdf" else "image"
        body = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": kind,
                            "source": {
                                "type": "base64",
                                "media_type": file.mime_type,
                                "data": _b64(file.data),
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        }
        data = self._post(
            f"{self.endpoint}/messages",
            headers={"x-api-key": self.api_key or "", "anthropic-version": "2023-06-01"},
            body=body,
        )
        blocks = data.get("content") or []
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


PROVIDERS: dict[str, type[TranscriptionProvider]] = {
    cls.id: cls
    for cls in (
        GeminiProvider,
        OpenAIProvider,
        AnthropicProvider,
        OpenAICompatibleProvider,
    )
}


def create_provider(
    provider_id: str, *, model: str, api_key: str | None, base_url: str | None
) -> TranscriptionProvider:
    """The adapter for *provider_id*, configured for one person's settings."""
    try:
        cls = PROVIDERS[provider_id]
    except KeyError as exc:
        raise AiProviderError("unknown_provider", provider_id) from exc
    return cls(model=model, api_key=api_key, base_url=base_url)


_FENCE_RE = re.compile(r"^\s*```(?:markdown|md)?\s*\n(.*?)\n```\s*$", re.DOTALL)


def clean_markdown(text: str) -> str:
    """Drop the code fence some models wrap their whole answer in."""
    match = _FENCE_RE.match(text)
    return (match.group(1) if match else text).strip()
