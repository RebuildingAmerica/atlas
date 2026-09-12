"""Tests for the keyless nonprofit registry provider."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from atlas_discovery_engine.registry import (
    ProPublicaRegistryProvider,
    RegistryOrganization,
    registry_terms_for_issue,
)

pytestmark = pytest.mark.asyncio


def _hit(ein: str, name: str = "Housing Trust") -> dict[str, Any]:
    return {
        "ein": ein,
        "name": name,
        "city": "Fresno",
        "state": "CA",
        "ntee_code": "L21",
    }


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self) -> None:
        if self.status_code >= httpx.codes.BAD_REQUEST:
            raise httpx.HTTPStatusError(
                "registry error",
                request=httpx.Request("GET", ProPublicaRegistryProvider.SEARCH_ENDPOINT),
                response=httpx.Response(self.status_code),
            )

    def json(self) -> Any:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _ScriptedClient:
    """Answers each GET with the next scripted response."""

    def __init__(self, responses: list[Any]) -> None:
        self._responses = list(responses)
        self.pages: list[Any] = []

    async def __aenter__(self) -> _ScriptedClient:
        return self

    async def __aexit__(self, *_args: Any) -> None:
        return None

    async def get(self, _url: str, params: dict[str, Any] | None = None) -> Any:
        self.pages.append((params or {}).get("page"))
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class TestProPublicaRegistryProvider:
    async def test_returns_organizations_with_a_citable_source(self, monkeypatch: Any) -> None:
        """Every organization carries the registry page that names it."""
        client = _ScriptedClient([_FakeResponse(payload={"organizations": [_hit("123")]})])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        orgs = await ProPublicaRegistryProvider().search_organizations("housing", "CA", limit=5)

        assert orgs == [
            RegistryOrganization(
                name="Housing Trust",
                city="Fresno",
                state="CA",
                registry_id="123",
                source_url=f"{ProPublicaRegistryProvider.ORGANIZATION_URL}/123",
                category_code="L21",
                website=None,
            )
        ]

    async def test_pages_until_the_limit_is_reached(self, monkeypatch: Any) -> None:
        """A limit wider than one page keeps asking for more."""
        full_page = {"organizations": [_hit(str(i)) for i in range(25)]}
        client = _ScriptedClient(
            [
                _FakeResponse(payload=full_page),
                _FakeResponse(payload={"organizations": [_hit("x")]}),
            ]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        orgs = await ProPublicaRegistryProvider().search_organizations("housing", "CA", limit=26)

        assert len(orgs) == 26
        assert client.pages == [0, 1]

    async def test_stops_when_the_limit_lands_on_a_page_boundary(self, monkeypatch: Any) -> None:
        """A limit of exactly one full page asks once and does not over-fetch."""
        client = _ScriptedClient(
            [_FakeResponse(payload={"organizations": [_hit(str(i)) for i in range(25)]})]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        orgs = await ProPublicaRegistryProvider().search_organizations("housing", "CA", limit=25)

        assert len(orgs) == 25
        assert client.pages == [0]

    async def test_stops_early_on_a_short_page(self, monkeypatch: Any) -> None:
        """A page below the registry's page size is the last one."""
        client = _ScriptedClient([_FakeResponse(payload={"organizations": [_hit("1")]})])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        orgs = await ProPublicaRegistryProvider().search_organizations("housing", "CA", limit=50)

        assert len(orgs) == 1
        assert client.pages == [0]

    async def test_keeps_nothing_for_a_non_positive_limit(self, monkeypatch: Any) -> None:
        """A zero limit spends no request at all."""
        client = _ScriptedClient([])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        assert await ProPublicaRegistryProvider().search_organizations("h", "CA", limit=0) == []
        assert client.pages == []

    async def test_a_term_nothing_matches_is_not_a_failure(self, monkeypatch: Any) -> None:
        """ProPublica answers 404 for an unmatched term, not an empty page."""
        client = _ScriptedClient([_FakeResponse(status_code=404)])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        assert await ProPublicaRegistryProvider().search_organizations("zzz", "NE", limit=5) == []
        assert client.pages == [0]

    @pytest.mark.parametrize(
        "response",
        [
            _FakeResponse(status_code=503),
            _FakeResponse(payload=ValueError("not json")),
            _FakeResponse(payload=["unexpected shape"]),
        ],
        ids=["http_error", "non_json", "non_object"],
    )
    async def test_a_page_the_registry_cannot_answer_ends_the_walk(
        self, monkeypatch: Any, response: Any
    ) -> None:
        """A free public API failing mid-walk costs the rest, not the run."""
        client = _ScriptedClient([response])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        assert await ProPublicaRegistryProvider().search_organizations("h", "CA", limit=50) == []

    async def test_a_transport_failure_ends_the_walk(self, monkeypatch: Any) -> None:
        """A refused connection is not an exception the caller should handle."""
        client = _ScriptedClient([httpx.ConnectTimeout("no route")])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        assert await ProPublicaRegistryProvider().search_organizations("h", "CA", limit=5) == []

    async def test_blank_registry_fields_become_none(self, monkeypatch: Any) -> None:
        """Absent and whitespace-only fields must not reach an Atlas record."""
        client = _ScriptedClient(
            [
                _FakeResponse(
                    payload={
                        "organizations": [
                            {"ein": " 99 ", "name": " Trust ", "city": "  ", "state": None}
                        ]
                    }
                )
            ]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        orgs = await ProPublicaRegistryProvider().search_organizations("h", "CA", limit=1)

        assert orgs[0].name == "Trust"
        assert orgs[0].city is None
        assert orgs[0].state is None
        assert orgs[0].category_code is None


class TestRegistryTermsForIssue:
    def test_drops_phrases_too_long_to_match_a_registered_name(self) -> None:
        """Registry search matches names, so article phrasing finds nothing."""
        terms = registry_terms_for_issue(
            ["affordable housing", "housing crisis in american cities", "rent"]
        )

        assert terms == ["affordable housing", "rent"]

    def test_keeps_the_configured_order(self) -> None:
        """Callers spend the quota in the order the taxonomy prefers."""
        assert registry_terms_for_issue(["rent", "affordable housing"]) == [
            "rent",
            "affordable housing",
        ]
