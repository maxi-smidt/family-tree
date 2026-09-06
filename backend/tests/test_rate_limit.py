"""Unit tests for the in-memory login rate limiter, focused on the window
semantics and the memory-bounding (opportunistic sweep + LRU cap)."""

import app.core.rate_limit as rl


class _FakeTime:
    """Replaces the module's ``time`` reference with a controllable clock."""

    def __init__(self, t: float) -> None:
        self.t = t

    def monotonic(self) -> float:
        return self.t


def test_window_blocks_after_max_attempts(monkeypatch):
    monkeypatch.setattr(rl, "time", _FakeTime(1000.0))
    limiter = rl.RateLimiter(max_attempts=3, window_seconds=60)

    assert limiter.retry_after("k") is None
    for _ in range(3):
        limiter.record_hit("k")

    retry = limiter.retry_after("k")
    assert retry is not None and retry > 0

    limiter.reset("k")
    assert limiter.retry_after("k") is None


def test_hits_expire_after_window(monkeypatch):
    clock = _FakeTime(1000.0)
    monkeypatch.setattr(rl, "time", clock)
    limiter = rl.RateLimiter(max_attempts=2, window_seconds=10)

    limiter.record_hit("k")
    limiter.record_hit("k")
    assert limiter.retry_after("k") is not None

    clock.t = 1011.0  # both hits are now outside the window
    assert limiter.retry_after("k") is None


def test_sweep_evicts_fully_expired_keys(monkeypatch):
    clock = _FakeTime(1000.0)
    monkeypatch.setattr(rl, "time", clock)
    limiter = rl.RateLimiter(max_attempts=3, window_seconds=10, max_keys=1000)

    limiter.record_hit("a")
    limiter.record_hit("b")
    assert len(limiter._hits) == 2

    # Past the window AND the sweep cadence: the next call sweeps a and b away
    # even though they're never queried again — the unbounded-growth fix.
    clock.t = 1011.0
    limiter.record_hit("c")

    assert set(limiter._hits) == {"c"}


def test_lru_cap_evicts_least_recently_used(monkeypatch):
    monkeypatch.setattr(rl, "time", _FakeTime(1000.0))  # no time advance -> no sweep
    limiter = rl.RateLimiter(max_attempts=5, window_seconds=100, max_keys=3)

    for key in ("a", "b", "c"):
        limiter.record_hit(key)
    assert list(limiter._hits) == ["a", "b", "c"]

    limiter.retry_after("a")  # touch "a" so "b" becomes least-recently-used
    limiter.record_hit("d")  # exceeds the cap of 3

    assert "b" not in limiter._hits
    assert set(limiter._hits) == {"a", "c", "d"}
