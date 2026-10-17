"""In-memory rate limiting for sensitive or expensive endpoints (e.g. login,
the neighborhood graph traversal).

Process-local and intentionally simple — it fits the single-instance,
self-hosted deployment this app targets. (A multi-replica setup would need a
shared backing store; that is tracked separately and is out of scope here.)

State is **bounded** so a spray of distinct keys — e.g. random usernames from
many IPs against the login endpoint — cannot grow memory without limit:

* an opportunistic sweep drops every key whose newest hit has aged out of the
  window; it runs at most once per ``window_seconds``, so the amortized cost
  per call stays O(1);
* ``max_keys`` caps the number of tracked keys, evicting the least-recently
  used entry as a hard backstop against a burst faster than the sweep cadence.
"""

import threading
import time
from collections import OrderedDict

from app.core.config import settings

# Hard cap on tracked keys. Legitimate deployments stay far below this within a
# window; the cap only bites under an attack spray. Evicting an active
# attacker's bucket at worst grants them a few extra attempts — acceptable.
_DEFAULT_MAX_KEYS = 10_000


class RateLimiter:
    """Sliding-window limiter: at most ``max_attempts`` hits per ``window``.

    Memory is bounded by an opportunistic sweep of expired keys plus an LRU
    cap (``max_keys``); see the module docstring.
    """

    def __init__(
        self,
        max_attempts: int,
        window_seconds: float,
        max_keys: int = _DEFAULT_MAX_KEYS,
    ) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        # OrderedDict (insertion/recency-ordered) lets us evict the
        # least-recently-used key in O(1) via popitem(last=False).
        self._hits: OrderedDict[str, list[float]] = OrderedDict()
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    # -- internal helpers (caller must hold ``self._lock``) ----------------

    def _prune(self, key: str, now: float) -> list[float]:
        """Drop hits outside the window for ``key``; return the kept list."""
        cutoff = now - self.window_seconds
        kept = [t for t in self._hits.get(key, []) if t > cutoff]
        if kept:
            self._hits[key] = kept
        else:
            self._hits.pop(key, None)
        return kept

    def _maybe_sweep(self, now: float) -> None:
        """Drop every fully-expired key. Runs at most once per window."""
        if now - self._last_sweep < self.window_seconds:
            return
        self._last_sweep = now
        cutoff = now - self.window_seconds
        # Hits are append-only with monotonic timestamps, so the last entry is
        # the newest; if even that has aged out, the whole key is expired.
        stale = [k for k, hits in self._hits.items() if not hits or hits[-1] <= cutoff]
        for key in stale:
            del self._hits[key]

    def _evict_over_cap(self) -> None:
        """Enforce ``max_keys`` by dropping least-recently-used keys."""
        while len(self._hits) > self.max_keys:
            self._hits.popitem(last=False)

    # -- public API --------------------------------------------------------

    def retry_after(self, key: str) -> float | None:
        """Seconds until ``key`` is allowed again, or ``None`` if not limited."""
        now = time.monotonic()
        with self._lock:
            self._maybe_sweep(now)
            hits = self._prune(key, now)
            if hits:
                self._hits.move_to_end(key)  # mark recently used
            if len(hits) < self.max_attempts:
                return None
            return max(0.0, hits[0] + self.window_seconds - now)

    def record_hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._maybe_sweep(now)
            self._hits.setdefault(key, []).append(now)
            self._hits.move_to_end(key)  # mark recently used
            self._evict_over_cap()

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        """Drop all tracked state (used by tests)."""
        with self._lock:
            self._hits.clear()
            self._last_sweep = time.monotonic()


login_rate_limiter = RateLimiter(
    settings.LOGIN_MAX_ATTEMPTS, settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS
)

public_unlock_rate_limiter = RateLimiter(
    settings.PUBLIC_UNLOCK_MAX_ATTEMPTS,
    settings.PUBLIC_UNLOCK_RATE_LIMIT_WINDOW_SECONDS,
)

# Per-IP aggregate budget across every workspace/grant — see #993.
public_unlock_aggregate_rate_limiter = RateLimiter(
    settings.PUBLIC_UNLOCK_AGGREGATE_MAX_ATTEMPTS,
    settings.PUBLIC_UNLOCK_AGGREGATE_RATE_LIMIT_WINDOW_SECONDS,
)

# Every call to the neighborhood graph endpoint counts here, not just
# failures — it throttles request *volume* (scripted replay/paginate loops),
# not repeated bad input. See #1032.
neighborhood_rate_limiter = RateLimiter(
    settings.NEIGHBORHOOD_MAX_REQUESTS,
    settings.NEIGHBORHOOD_RATE_LIMIT_WINDOW_SECONDS,
)

# GET .../search (#1024) — same request-volume throttle as the neighborhood
# endpoint, keyed by principal + workspace.
search_rate_limiter = RateLimiter(
    settings.SEARCH_MAX_REQUESTS,
    settings.SEARCH_RATE_LIMIT_WINDOW_SECONDS,
)

# Identity-link proposals (#985), keyed by proposer + target workspace, so
# spamming one target with proposals is bounded without limiting a proposer
# who is legitimately linking members across several different workspaces.
identity_link_propose_rate_limiter = RateLimiter(
    settings.IDENTITY_LINK_PROPOSE_MAX_ATTEMPTS,
    settings.IDENTITY_LINK_PROPOSE_RATE_LIMIT_WINDOW_SECONDS,
)

# A second, coarser budget keyed by client IP alone, across every target —
# mirrors public_unlock_aggregate_rate_limiter above.
identity_link_propose_aggregate_rate_limiter = RateLimiter(
    settings.IDENTITY_LINK_PROPOSE_AGGREGATE_MAX_ATTEMPTS,
    settings.IDENTITY_LINK_PROPOSE_AGGREGATE_RATE_LIMIT_WINDOW_SECONDS,
)
