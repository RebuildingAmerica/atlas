"""Production configuration tests."""

from _pytest.monkeypatch import MonkeyPatch

from atlas.main import create_app
from atlas.platform.config import Settings


class TestProductionConfig:
    """Tests for production-oriented configuration defaults."""

    def test_openapi_defaults_on_in_production(self) -> None:
        """Production settings should publish the OpenAPI spec and docs by default."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
        )

        assert settings.enable_openapi_spec is True
        assert settings.enable_api_docs_ui is True

    def test_openapi_defaults_on_outside_production(self) -> None:
        """Development-like environments should continue to expose docs by default."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="staging",
        )

        assert settings.enable_openapi_spec is True
        assert settings.enable_api_docs_ui is True

    def test_legacy_enable_api_docs_populates_new_flags(self) -> None:
        """Legacy settings continue to map onto the explicit OpenAPI flags."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            enable_api_docs=False,
        )

        assert settings.enable_openapi_spec is False
        assert settings.enable_api_docs_ui is False

    def test_health_endpoint_includes_environment(self, monkeypatch: MonkeyPatch) -> None:
        """The health endpoint should expose the active environment for operators."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
        )

        monkeypatch.setattr("atlas.main.get_settings", lambda: settings)
        app = create_app()

        health_route = next(
            route for route in app.routes if getattr(route, "path", None) == "/health"
        )
        docs_route = next(route for route in app.routes if getattr(route, "path", None) == "/docs")
        redoc_route = next(
            route for route in app.routes if getattr(route, "path", None) == "/redoc"
        )
        openapi_route = next(
            route for route in app.routes if getattr(route, "path", None) == "/openapi.json"
        )

        assert app.docs_url is None
        assert app.redoc_url is None
        assert app.openapi_url is None
        assert health_route.endpoint.__name__ == "health_check"
        assert docs_route.endpoint.__name__ == "swagger_ui"
        assert redoc_route.endpoint.__name__ == "redoc_ui"
        assert openapi_route.endpoint.__name__ == "openapi_schema"

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
