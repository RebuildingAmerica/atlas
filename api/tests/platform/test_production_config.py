"""Production configuration tests."""

import pytest
from _pytest.monkeypatch import MonkeyPatch

from atlas.main import create_app
from atlas.platform.config import Settings, validate_runtime_auth_config


class TestProductionConfig:
    """Tests for production-oriented configuration defaults."""

    def test_openapi_defaults_on_in_production(self) -> None:
        """Production settings should keep OpenAPI public but disable Swagger/ReDoc by default."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            deploy_mode="local",
        )

        assert settings.enable_openapi_spec is True
        assert settings.enable_api_docs_ui is False

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
        """Production app factories should keep health/openapi public without public Swagger/ReDoc."""
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
        with pytest.raises(RuntimeError, match="ATLAS_API_AUDIENCE is required"):
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


class TestSettingsValidatorEdgeCases:
    """Branches in the env-var parser, backend validator, and helper accessors."""

    def test_string_list_validator_accepts_none_as_empty(self) -> None:
        """A None env-var should normalise to an empty list."""
        # Constructing Settings with audience=None exercises the field validator.
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=None,  # type: ignore[arg-type]
        )
        assert settings.auth_jwt_audience == []

    def test_string_list_validator_accepts_python_list(self) -> None:
        """A Python list should pass through with surrounding whitespace stripped."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["  https://a.test  ", "", "https://b.test"],
        )
        assert settings.auth_jwt_audience == ["https://a.test", "https://b.test"]

    def test_string_list_validator_parses_comma_separated_string(self) -> None:
        """A bare comma-separated string should split into a trimmed list."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience="  https://a.test , ,https://b.test ",  # type: ignore[arg-type]
        )
        assert settings.auth_jwt_audience == ["https://a.test", "https://b.test"]

    def test_string_list_validator_parses_comma_separated_env_var(
        self,
        monkeypatch: MonkeyPatch,
    ) -> None:
        """Hosted env vars should accept the documented comma-separated audience format."""
        monkeypatch.setenv("ATLAS_API_AUDIENCE", "https://a.test, https://b.test")

        settings = Settings(database_url="sqlite:///tmp/test.db")

        assert settings.auth_jwt_audience == ["https://a.test", "https://b.test"]

    def test_postgres_backend_with_sqlite_url_rejected(self) -> None:
        """Selecting postgres backend with a sqlite URL should fail loudly."""
        with pytest.raises(ValueError, match="DATABASE_BACKEND is 'postgres'"):
            Settings(
                database_url="sqlite:///atlas.db",
                database_backend="postgres",
            )

    def test_sqlite_backend_with_postgres_url_rejected(self) -> None:
        """Selecting sqlite backend with a postgres URL should fail loudly."""
        with pytest.raises(ValueError, match="DATABASE_BACKEND is 'sqlite'"):
            Settings(
                database_url="postgresql://user:pass@host/db",
                database_backend="sqlite",
            )

    def test_get_database_url_returns_configured_url(self) -> None:
        """The accessor should mirror ``database_url``."""
        settings = Settings(database_url="sqlite:///tmp/test.db")
        assert settings.get_database_url() == "sqlite:///tmp/test.db"

    def test_auth_resource_metadata_url_empty_when_no_audience(self) -> None:
        """Without an audience the metadata URL should be empty."""
        settings = Settings(database_url="sqlite:///tmp/test.db")
        assert settings.auth_resource_metadata_url == ""

    def test_auth_resource_metadata_url_uses_first_audience(self) -> None:
        """When audiences are present, the metadata URL uses the first resource."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["https://atlas.test/api/"],
        )
        assert (
            settings.auth_resource_metadata_url
            == "https://atlas.test/.well-known/oauth-protected-resource/api"
        )

    def test_auth_resource_metadata_url_preserves_mcp_resource_path(self) -> None:
        """MCP resource metadata should be discoverable at the RFC 9728 path."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["https://atlas.test/mcp"],
        )
        assert (
            settings.auth_resource_metadata_url
            == "https://atlas.test/.well-known/oauth-protected-resource/mcp"
        )


class TestDiscoveryCostControls:
    """Cost-ceiling and kill-switch settings that bound discovery spend."""

    def test_cost_controls_have_safe_defaults(self) -> None:
        """The cost ceilings default to bounded values with the kill switch off."""
        settings = Settings(database_url="sqlite:///tmp/test.db")

        assert settings.discovery_max_run_cost == 5.0  # noqa: PLR2004
        assert settings.discovery_max_daily_cost == 50.0  # noqa: PLR2004
        assert settings.discovery_cost_kill_switch is False

    def test_cost_controls_read_environment_overrides(self, monkeypatch: MonkeyPatch) -> None:
        """Operators can tighten the ceilings and flip the kill switch via env vars."""
        monkeypatch.setenv("DISCOVERY_MAX_RUN_COST", "1.25")
        monkeypatch.setenv("DISCOVERY_MAX_DAILY_COST", "9.0")
        monkeypatch.setenv("DISCOVERY_COST_KILL_SWITCH", "true")

        settings = Settings(database_url="sqlite:///tmp/test.db")

        assert settings.discovery_max_run_cost == 1.25  # noqa: PLR2004
        assert settings.discovery_max_daily_cost == 9.0  # noqa: PLR2004
        assert settings.discovery_cost_kill_switch is True


class TestValidateRuntimeAuthConfig:
    """Runtime guard for non-local deploys without a configured audience."""

    def test_local_mode_skips_audience_check(self) -> None:
        """Local deploy mode shouldn't require ATLAS_API_AUDIENCE."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
        )
        # No exception expected.
        validate_runtime_auth_config(settings)

    def test_non_local_mode_requires_audience(self, monkeypatch: MonkeyPatch) -> None:
        """A non-local deploy without ATLAS_API_AUDIENCE should fail fast."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(database_url="sqlite:///tmp/test.db")
        assert settings.deploy_mode == "production"
        assert settings.auth_jwt_audience == []
        with pytest.raises(RuntimeError, match="ATLAS_API_AUDIENCE is required"):
            validate_runtime_auth_config(settings)

    def test_non_local_mode_passes_when_audience_configured(self, monkeypatch: MonkeyPatch) -> None:
        """A non-local deploy with ATLAS_API_AUDIENCE should not raise."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["https://atlas.test/api"],
        )
        # No exception expected.
        validate_runtime_auth_config(settings)
