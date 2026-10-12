"""Factory imports do not construct a second server beside a hosted instance."""

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from atlas import main


def test_default_application_is_created_once_when_asgi_loader_requests_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = []
    expected = FastAPI()

    def create() -> FastAPI:
        created.append(expected)
        return expected

    monkeypatch.setattr(main, "create_app", create)
    main._get_default_application.cache_clear()
    try:
        assert main.__getattr__("app") is expected
        assert main.__getattr__("app") is expected
        assert created == [expected]
    finally:
        main._get_default_application.cache_clear()


def test_unknown_module_attribute_does_not_construct_a_server() -> None:
    with pytest.raises(AttributeError, match="missing_application"):
        main.__getattr__("missing_application")


def test_hosted_prepared_routes_preserve_http_and_openapi() -> None:
    router = APIRouter()

    @router.get("/prepared")
    async def prepared() -> dict[str, bool]:
        return {"ok": True}

    app = main.create_app(prepared_http_routes=router.routes, mcp_asgi_app=FastAPI())
    client = TestClient(app)
    assert client.get("/prepared").json() == {"ok": True}
    assert "/prepared" in app.openapi()["paths"]
    assert client.get("/health").status_code == 200
