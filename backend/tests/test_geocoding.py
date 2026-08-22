"""Unit tests for the Nominatim geocoding cache (app.services.media.geocoding)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.content import GeocodeCache
from app.services.media import geocoding
from app.services.media.geocoding import (
    GeocodeUnavailableError,
    resolve_batch,
    search_candidates,
    set_override,
)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(geocoding.time, "sleep", lambda _s: None)


def _patch_lookup(monkeypatch, responses: dict[str, tuple | None]):
    """Replace _geocode_one; a value of GeocodeUnavailableError raises it."""
    calls: list[str] = []

    def fake(query: str):
        calls.append(query)
        result = responses[query]
        if result is GeocodeUnavailableError:
            raise GeocodeUnavailableError(query)
        return result

    monkeypatch.setattr(geocoding, "_geocode_one", fake)
    return calls


def _cache_row(
    db, query: str, *, resolved: bool, age: timedelta = timedelta(), manual: bool = False
):
    row = GeocodeCache(
        query=query,
        lat=1.0 if resolved else None,
        lon=2.0 if resolved else None,
        display_name="cached" if resolved else None,
        resolved=resolved,
        manual=manual,
        updated_at=(datetime.now(UTC) - age).isoformat(),
    )
    db.merge(row)
    db.commit()
    return row


def test_success_is_cached_and_not_looked_up_again(db, monkeypatch):
    calls = _patch_lookup(monkeypatch, {"paris": (48.85, 2.32, "Paris, France")})

    first = resolve_batch(db, ["Paris"])
    second = resolve_batch(db, ["  PARIS "])

    assert first[0].resolved and first[0].lat == 48.85
    assert second[0].resolved and second[0].display_name == "Paris, France"
    assert calls == ["paris"]  # one Nominatim hit total


def test_no_result_is_cached_but_retried_after_ttl(db, monkeypatch):
    calls = _patch_lookup(monkeypatch, {"atlantis": None})

    first = resolve_batch(db, ["Atlantis"])
    fresh = resolve_batch(db, ["Atlantis"])
    assert not first[0].resolved
    assert not fresh[0].resolved
    assert calls == ["atlantis"]  # fresh no-result row is not retried

    # Age the row past the retry TTL; Nominatim now knows the place.
    row = db.get(GeocodeCache, "atlantis")
    row.updated_at = (
        datetime.now(UTC) - geocoding._UNRESOLVED_RETRY - timedelta(hours=1)
    ).isoformat()
    db.commit()
    _patch_lookup(monkeypatch, {"atlantis": (30.0, -40.0, "Atlantis")})

    retried = resolve_batch(db, ["Atlantis"])
    assert retried[0].resolved and retried[0].lat == 30.0
    assert db.get(GeocodeCache, "atlantis").resolved


def test_transient_failure_is_not_cached(db, monkeypatch):
    calls = _patch_lookup(monkeypatch, {"las vegas": GeocodeUnavailableError})

    first = resolve_batch(db, ["Las Vegas"])
    assert not first[0].resolved
    assert db.get(GeocodeCache, "las vegas") is None

    # Nominatim recovered: the very next call retries and caches the success.
    _patch_lookup(monkeypatch, {"las vegas": (36.17, -115.14, "Las Vegas")})
    second = resolve_batch(db, ["Las Vegas"])
    assert second[0].resolved and second[0].lat == 36.17
    assert calls == ["las vegas"]


def test_transient_failure_keeps_stale_row_retryable(db, monkeypatch):
    _cache_row(
        db,
        "grand canyon",
        resolved=False,
        age=geocoding._UNRESOLVED_RETRY + timedelta(days=1),
    )
    _patch_lookup(monkeypatch, {"grand canyon": GeocodeUnavailableError})

    resolve_batch(db, ["Grand Canyon"])

    # Row untouched → still older than the TTL → retried again next call.
    _patch_lookup(monkeypatch, {"grand canyon": (36.1, -112.1, "Grand Canyon")})
    result = resolve_batch(db, ["Grand Canyon"])
    assert result[0].resolved


def test_resolved_rows_are_never_retried(db, monkeypatch):
    _cache_row(db, "vienna", resolved=True, age=timedelta(days=365))
    calls = _patch_lookup(monkeypatch, {})

    result = resolve_batch(db, ["Vienna"])
    assert result[0].resolved and result[0].display_name == "cached"
    assert calls == []


def test_unparsable_updated_at_counts_as_stale(db, monkeypatch):
    db.merge(
        GeocodeCache(
            query="springfield", lat=None, lon=None,
            display_name=None, resolved=False, manual=False, updated_at="not-a-date",
        )
    )
    db.commit()
    calls = _patch_lookup(monkeypatch, {"springfield": (39.8, -89.6, "Springfield")})

    result = resolve_batch(db, ["Springfield"])
    assert result[0].resolved
    assert calls == ["springfield"]


def test_set_override_stores_manual_row_and_echoes_original_query(db):
    result = set_override(
        db, "  Ye Olde Springe  ", 51.5, -0.1, "Ye Olde Springe (historic)"
    )

    assert result.query == "  Ye Olde Springe  "  # original string echoed back
    assert result.resolved and result.manual
    assert result.lat == 51.5 and result.lon == -0.1
    assert result.display_name == "Ye Olde Springe (historic)"

    row = db.get(GeocodeCache, geocoding._normalize("  Ye Olde Springe  "))
    assert row is not None
    assert row.manual is True
    assert row.resolved is True
    assert row.lat == 51.5


def test_manual_override_is_never_re_geocoded(db, monkeypatch):
    # Manually correct a location that is stale enough to normally be retried...
    set_override(db, "Atlantis", 10.0, 20.0, "Atlantis (manual)")
    row = db.get(GeocodeCache, "atlantis")
    row.updated_at = (
        datetime.now(UTC) - geocoding._UNRESOLVED_RETRY - timedelta(days=1)
    ).isoformat()
    db.commit()

    # ...and confirm resolve_batch never calls Nominatim for it, nor overwrites it.
    calls = _patch_lookup(monkeypatch, {})
    result = resolve_batch(db, ["Atlantis"])

    assert calls == []
    assert result[0].resolved and result[0].manual
    assert result[0].lat == 10.0
    assert result[0].display_name == "Atlantis (manual)"


def test_search_candidates_returns_live_results_uncached(db, monkeypatch):
    def fake_get(url, params, headers):
        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return [
                    {"lat": "1.0", "lon": "2.0", "display_name": "Candidate A"},
                    {"lat": "3.0", "lon": "4.0", "display_name": "Candidate B"},
                ]

        assert params["limit"] == 3
        return FakeResponse()

    class FakeClient:
        def __init__(self, timeout=None):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, params, headers):
            return fake_get(url, params, headers)

    monkeypatch.setattr(geocoding.httpx, "Client", FakeClient)

    candidates = search_candidates(db, "Springe", limit=3)

    assert len(candidates) == 2
    assert candidates[0].display_name == "Candidate A"
    assert candidates[0].lat == 1.0
    # Nothing cached: a live search must not touch geocode_cache.
    assert db.get(GeocodeCache, "springe") is None


def test_search_candidates_returns_empty_list_on_failure(db, monkeypatch):
    class FakeClient:
        def __init__(self, timeout=None):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, params, headers):
            raise RuntimeError("boom")

    monkeypatch.setattr(geocoding.httpx, "Client", FakeClient)

    assert search_candidates(db, "Nowhere") == []
