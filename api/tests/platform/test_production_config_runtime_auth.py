"""Runtime auth validation tests for production configuration."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.main import create_app
from atlas.platform.config import Settings, validate_runtime_auth_config

if TYPE_CHECKING:
    from _pytest.monkeypatch import MonkeyPatch


class TestValidateRuntimeAuthConfig:
    """Runtime guard for non-local deploys without a configured audience."""

    def test_local_mode_skips_audience_check(self) -> None:
        """Local deploy mode shouldn't require ATLAS_AUTH_JWT_AUDIENCES."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
        )
        validate_runtime_auth_config(settings)

    def test_non_local_mode_requires_audience(self, monkeypatch: MonkeyPatch) -> None:
        """A non-local deploy without ATLAS_AUTH_JWT_AUDIENCES should fail fast."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(database_url="sqlite:///tmp/test.db")
        assert settings.deploy_mode == "production"
        assert settings.auth_jwt_audience == []
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_JWT_AUDIENCES is required"):
            validate_runtime_auth_config(settings)

    def test_non_local_mode_passes_when_audience_configured(self, monkeypatch: MonkeyPatch) -> None:
        """A non-local deploy with ATLAS_AUTH_JWT_AUDIENCES should not raise."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_issuer="https://atlas.test",
            auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
            auth_membership_verification_url="https://atlas.test",
        )
        validate_runtime_auth_config(settings)

    def test_non_local_mode_requires_internal_secret(self, monkeypatch: MonkeyPatch) -> None:
        """A hosted deploy needs the shared app/API secret for trusted internal calls."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["https://atlas.test/mcp"],
        )
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_INTERNAL_SECRET is required"):
            validate_runtime_auth_config(settings)

    def test_non_local_mode_requires_api_key_introspection(self, monkeypatch: MonkeyPatch) -> None:
        """Hosted API-key access needs the app introspection endpoint."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["https://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
        )
        with pytest.raises(
            RuntimeError,
            match="ATLAS_AUTH_API_KEY_INTROSPECTION_URL is required",
        ):
            validate_runtime_auth_config(settings)

    def test_non_local_mode_requires_membership_verification(
        self, monkeypatch: MonkeyPatch
    ) -> None:
        """Hosted workspace checks need the app membership verification endpoint."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["https://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        )
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_MEMBERSHIP_URL is required"):
            validate_runtime_auth_config(settings)

    def test_non_local_mode_requires_public_url(self, monkeypatch: MonkeyPatch) -> None:
        """Hosted OAuth challenges need the app origin to publish metadata URLs."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["https://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
            auth_membership_verification_url="https://atlas.test",
        )
        with pytest.raises(RuntimeError, match="ATLAS_PUBLIC_URL is required"):
            validate_runtime_auth_config(settings)

    def test_non_local_mode_requires_https_public_url(self, monkeypatch: MonkeyPatch) -> None:
        """Hosted OAuth metadata must not advertise an insecure issuer origin."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_issuer="http://atlas.test",
            auth_jwt_audience=["http://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
            auth_membership_verification_url="https://atlas.test",
        )
        with pytest.raises(RuntimeError, match="ATLAS_PUBLIC_URL must use https"):
            validate_runtime_auth_config(settings)

    def test_non_local_mode_allows_loopback_public_url_for_e2e(
        self, monkeypatch: MonkeyPatch
    ) -> None:
        """Local E2E runs auth-enabled services on loopback HTTP."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_issuer="http://127.0.0.1:3100",
            auth_jwt_audience=["http://127.0.0.1:3100/mcp", "http://127.0.0.1:8000"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="http://127.0.0.1:3100/api/auth/internal/api-key",
            auth_membership_verification_url="http://127.0.0.1:3100",
        )

        validate_runtime_auth_config(settings)

    def test_non_local_mode_requires_mcp_audience_first(self, monkeypatch: MonkeyPatch) -> None:
        """The first audience drives the MCP protected-resource metadata URL."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_issuer="https://atlas.test",
            auth_jwt_audience=["https://api.atlas.test", "https://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
            auth_membership_verification_url="https://atlas.test",
        )
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_JWT_AUDIENCES must put"):
            validate_runtime_auth_config(settings)

    def test_lifespan_runs_runtime_auth_validation(self, monkeypatch: MonkeyPatch) -> None:
        """App startup should fail before serving MCP with missing hosted auth config."""
        monkeypatch.setenv("ATLAS_DEPLOY_MODE", "production")
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="production",
            discovery_job_worker_enabled=False,
        )
        monkeypatch.setattr("atlas.main.get_settings", lambda: settings)

        with pytest.raises(RuntimeError, match="ATLAS_AUTH_JWT_AUDIENCES is required"):
            create_app()
