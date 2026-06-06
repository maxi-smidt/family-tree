"""In-memory rate limiting for sensitive endpoints (e.g. login).

This is process-local and intentionally simple — it fits the single-instance,
self-hosted deployment this app targets. A multi-replica setup would need a
shared backing store (e.g. Redis) instead.
"""

import threading
import time
from collections import defaultdict

from app.core.config import settings


class RateLimiter:
    """Sliding-window limiter: at most ``max_attempts`` hits per ``window``."""

    def __init__(self, max_attempts: int, window_seconds: float) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> None:
        cutoff = now - self.window_seconds
        kept = [t for t in self._hits.get(key, []) if t > cutoff]
        if kept:
            self._hits[key] = kept
        else:
            self._hits.pop(key, None)

    def retry_after(self, key: str) -> float | None:
        """Seconds until ``key`` is allowed again, or ``None`` if not limited."""
        now = time.monotonic()
        with self._lock:
            self._prune(key, now)
            hits = self._hits.get(key, [])
            if len(hits) < self.max_attempts:
                return None
            return max(0.0, hits[0] + self.window_seconds - now)

    def record_failure(self, key: str) -> None:
        with self._lock:
            self._hits[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        """Drop all tracked state (used by tests)."""
        with self._lock:
            self._hits.clear()


login_rate_limiter = RateLimiter(
    settings.LOGIN_MAX_ATTEMPTS, settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS
)
