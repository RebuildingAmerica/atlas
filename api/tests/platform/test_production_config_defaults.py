"""Production configuration defaults tests."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from atlas.main import create_app
from atlas.platform.config import API_ENV_FILE, Settings, get_settings

if TYPE_CHECKING:
    from _pytest.monkeypatch import MonkeyPatch


class TestProductionConfig:
    """Tests for production-oriented configuration defaults."""

    def test_api_env_file_points_to_api_package_root(self) -> None:
        """The API dev server should load api/.env when started by pnpm dev."""
        assert Path(__file__).resolve().parents[2] / ".env" == API_ENV_FILE

    def test_get_settings_loads_api_env_file(
        self, tmp_path: Path, monkeypatch: MonkeyPatch
    ) -> None:
        """Runtime settings should read the configured API env file."""
        env_file = tmp_path / ".env"
        env_file.write_text("DATABASE_URL=sqlite:///tmp/from-api-env.db\n")
        monkeypatch.setattr("atlas.platform.config.API_ENV_FILE", env_file)

        settings = get_settings()

        assert settings.database_url == "sqlite:///tmp/from-api-env.db"

    def test_openapi_defaults_on_in_production(self) -> None:
        """Production settings should publish the spec."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            deploy_mode="local",
        )

        assert settings.enable_openapi_spec is True

    def test_openapi_defaults_on_outside_production(self) -> None:
        """Development-like environments should publish the spec."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="staging",
        )

        assert settings.enable_openapi_spec is True

    def test_health_endpoint_includes_environment(self, monkeypatch: MonkeyPatch) -> None:
        """Production app factories should keep health and OpenAPI public."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            deploy_mode="local",
        )

        monkeypatch.setattr("atlas.main.get_settings", lambda: settings)
        app = create_app()

        health_route = next(
            route for route in app.routes if getattr(route, "path", None) == "/health"
        )
        openapi_route = next(
            route for route in app.routes if getattr(route, "path", None) == "/openapi.json"
        )
        route_paths = {getattr(route, "path", None) for route in app.routes}

        assert app.docs_url is None
        assert app.redoc_url is None
        assert app.openapi_url is None
        assert health_route.endpoint.__name__ == "health_check"
        assert openapi_route.endpoint.__name__ == "openapi_schema"
        assert "/docs" not in route_paths
        assert "/redoc" not in route_paths

    def test_app_factory_requires_audience_for_non_local_auth(
        self,
        monkeypatch: MonkeyPatch,
    ) -> None:
        """Production app startup should fail before serving unauthenticated MCP."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            cors_origins=["https://atlas.test"],
            deploy_mode="production",
        )

        monkeypatch.setattr("atlas.main.get_settings", lambda: settings)
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_JWT_AUDIENCES is required"):
            create_app()

    def test_auth_settings_use_atlas_prefixed_environment_variables(
        self, monkeypatch: MonkeyPatch
    ) -> None:
        """The API should consume the canonical ATLAS_* auth environment variables."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "")
        monkeypatch.setenv(
            "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
            "http://atlas-web:3000/api/auth/internal/api-key",
        )
        monkeypatch.setenv("ATLAS_AUTH_INTERNAL_SECRET", "internal-secret")

        settings = Settings(database_url="sqlite:///tmp/test.db", environment="production")

        assert settings.deploy_mode == ""
        assert (
            settings.auth_api_key_introspection_url
            == "http://atlas-web:3000/api/auth/internal/api-key"
        )
        assert settings.auth_internal_secret == "internal-secret"

    def test_database_url_uses_environment_override(self, monkeypatch: MonkeyPatch) -> None:
        """The API should respect DATABASE_URL when the API process is booted by env."""
        monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/e2e-atlas.db")

        settings = Settings(environment="production")

        assert settings.database_url == "sqlite:////tmp/e2e-atlas.db"

    def test_jwt_jwks_url_auto_derived_from_issuer(self, monkeypatch: MonkeyPatch) -> None:
        """JWKS URL should be auto-derived when only ATLAS_PUBLIC_URL is set."""
        monkeypatch.setenv("ATLAS_PUBLIC_URL", "https://atlas.test")

        settings = Settings(database_url="sqlite:///tmp/test.db")

        assert settings.auth_jwt_issuer == "https://atlas.test/api/auth"
        assert settings.auth_jwt_jwks_url == "https://atlas.test/api/auth/jwks"

    def test_jwt_jwks_url_not_overridden_when_explicit(self, monkeypatch: MonkeyPatch) -> None:
        """An explicitly set JWKS URL should not be overwritten by auto-derivation."""
        monkeypatch.setenv("ATLAS_PUBLIC_URL", "https://atlas.test")

        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_jwks_url="https://custom.test/jwks",
        )

        assert settings.auth_jwt_issuer == "https://atlas.test/api/auth"
        assert settings.auth_jwt_jwks_url == "https://custom.test/jwks"
