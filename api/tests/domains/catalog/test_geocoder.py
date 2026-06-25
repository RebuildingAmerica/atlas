"""Tests for the cheapest-first entry geocoder."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx

from atlas.domains.catalog.geo import geocoder
from atlas.domains.catalog.geo.geocoder import GeocodeResult, geocode_entry

if TYPE_CHECKING:
    import pytest

# A stand-in request URL for the mocked Census responses. The geocoder never
# inspects it; it only needs a request attached so .json()/.status_code work.
_STUB_REQUEST_URL = "https://geocoding.example/onelineaddress"

# Kansas City, MO city centroid from the bundled gazetteer (asserted on the
# offline-cascade path).
_KANSAS_CITY_LAT = 39.1
_KANSAS_CITY_LNG = -94.58


class _FakeAsyncClient:
    """Fake httpx.AsyncClient that returns (or raises) a configured response."""

    def __init__(self, response: httpx.Response | Exception) -> None:
        self._response = response
        self.last_url: str | None = None
        self.last_params: dict[str, Any] | None = None

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    async def get(self, url: str, params: dict[str, Any] | None = None) -> httpx.Response:
        self.last_url = url
        self.last_params = params
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def _patch_client(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response | Exception
) -> _FakeAsyncClient:
    """Patch the geocoder's httpx.AsyncClient with a fake returning ``response``."""
    client = _FakeAsyncClient(response)

    def factory(*, timeout: float) -> _FakeAsyncClient:
        del timeout
        return client

    monkeypatch.setattr(geocoder.httpx, "AsyncClient", factory)
    return client


def _census_response(matches: list[dict[str, Any]], *, status: int = 200) -> httpx.Response:
    """Build a Census-shaped JSON response."""
    return httpx.Response(
        status,
        json={"result": {"addressMatches": matches}},
        request=httpx.Request("GET", _STUB_REQUEST_URL),
    )


class TestRooftopPath:
    """When remote lookups are allowed, a rooftop match wins."""

    async def test_rooftop_match_returns_census_result(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client = _patch_client(
            monkeypatch,
            _census_response([{"coordinates": {"x": -97.74, "y": 30.27}}]),
        )

        result = await geocode_entry(
            "Austin", "TX", "123 Congress Ave, Austin, TX", allow_remote=True
        )

        assert result == GeocodeResult(
            latitude=30.27, longitude=-97.74, precision="rooftop", source="census"
        )
        assert client.last_params is not None
        assert client.last_params["address"] == "123 Congress Ave, Austin, TX"

    async def test_no_matches_falls_through_to_city(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_client(monkeypatch, _census_response([]))

        result = await geocode_entry("Kansas City", "MO", "Unmatched address", allow_remote=True)

        assert result is not None
        assert result.precision == "city"
        assert result.source == "gazetteer"

    async def test_http_error_falls_through_to_city(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_client(
            monkeypatch,
            httpx.ConnectError("boom", request=httpx.Request("GET", _STUB_REQUEST_URL)),
        )

        result = await geocode_entry("Denver", "CO", "Some address", allow_remote=True)

        assert result is not None
        assert result.precision == "city"

    async def test_non_200_status_falls_through_to_city(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_client(monkeypatch, _census_response([], status=503))

        result = await geocode_entry("Seattle", "WA", "Some address", allow_remote=True)

        assert result is not None
        assert result.precision == "city"

    async def test_unparseable_payload_falls_through_to_city(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bad = httpx.Response(
            200,
            json={"unexpected": "shape"},
            request=httpx.Request("GET", _STUB_REQUEST_URL),
        )
        _patch_client(monkeypatch, bad)

        result = await geocode_entry("Boston", "MA", "Some address", allow_remote=True)

        assert result is not None
        assert result.precision == "city"

    async def test_match_without_coordinates_falls_through_to_city(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_client(monkeypatch, _census_response([{"matchedAddress": "no coords here"}]))

        result = await geocode_entry("Miami", "FL", "Some address", allow_remote=True)

        assert result is not None
        assert result.precision == "city"

    async def test_match_with_partial_coordinates_falls_through_to_city(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_client(monkeypatch, _census_response([{"coordinates": {"x": -80.19}}]))

        result = await geocode_entry("Miami", "FL", "Some address", allow_remote=True)

        assert result is not None
        assert result.precision == "city"


class TestRemoteGating:
    """The Census round-trip must only happen when explicitly allowed."""

    async def test_remote_not_called_when_disallowed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = _patch_client(
            monkeypatch,
            _census_response([{"coordinates": {"x": -1.0, "y": 1.0}}]),
        )

        result = await geocode_entry("Kansas City", "MO", "123 Main St", allow_remote=False)

        # Census was never consulted; the offline city centroid is used instead.
        assert client.last_url is None
        assert result is not None
        assert result.source == "gazetteer"
        assert result.precision == "city"

    async def test_remote_skipped_without_full_address(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client = _patch_client(
            monkeypatch,
            _census_response([{"coordinates": {"x": -1.0, "y": 1.0}}]),
        )

        result = await geocode_entry("Kansas City", "MO", None, allow_remote=True)

        assert client.last_url is None
        assert result is not None
        assert result.precision == "city"


class TestOfflineCascade:
    """Without remote lookups, resolution falls city -> state -> None."""

    async def test_city_centroid_when_known(self) -> None:
        result = await geocode_entry("Kansas City", "MO", None)
        assert result is not None
        assert result.precision == "city"
        assert result.source == "gazetteer"
        assert result.latitude == _KANSAS_CITY_LAT
        assert result.longitude == _KANSAS_CITY_LNG

    async def test_state_centroid_when_city_unknown(self) -> None:
        result = await geocode_entry("Nowheresville", "MO", None)
        assert result is not None
        assert result.precision == "state"
        assert result.source == "gazetteer"

    async def test_state_centroid_when_no_city(self) -> None:
        result = await geocode_entry(None, "TX", None)
        assert result is not None
        assert result.precision == "state"

    async def test_none_when_unplaceable(self) -> None:
        assert await geocode_entry(None, None, None) is None

    async def test_none_when_state_unknown(self) -> None:
        assert await geocode_entry("Somewhere", "ZZ", None) is None
