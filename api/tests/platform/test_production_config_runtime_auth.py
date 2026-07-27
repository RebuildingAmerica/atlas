"""Runtime auth validation tests for production configuration."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.main import create_app
from atlas.platform.config import Settings, validate_runtime_auth_config

if TYPE_CHECKING:
    from _pytest.monkeypatch import MonkeyPatch


class TestValidateRuntimeAuthConfig:
    """An instance with accounts must carry complete auth configuration."""

    def test_single_user_skips_audience_check(self) -> None:
        """A single-user deployment has no accounts, so it needs no audience."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=False,
        )
        validate_runtime_auth_config(settings)

    def test_multi_user_requires_audience(self) -> None:
        """An instance with accounts and no ATLAS_AUTH_JWT_AUDIENCES should fail fast."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_audience=[],
        )
        assert settings.auth_jwt_audience == []
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_JWT_AUDIENCES is required"):
            validate_runtime_auth_config(settings)

    def test_multi_user_passes_when_audience_configured(self) -> None:
        """An instance with accounts and ATLAS_AUTH_JWT_AUDIENCES should not raise."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_issuer="https://atlas.test",
            auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
            auth_membership_verification_url="https://atlas.test",
        )
        validate_runtime_auth_config(settings)

    def test_multi_user_requires_internal_secret(self) -> None:
        """A hosted deploy needs the shared app/API secret for trusted internal calls."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_audience=["https://atlas.test/mcp"],
            auth_internal_secret="",
        )
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_INTERNAL_SECRET is required"):
            validate_runtime_auth_config(settings)

    def test_multi_user_requires_api_key_introspection(self) -> None:
        """Hosted API-key access needs the app introspection endpoint."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_audience=["https://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url=None,
        )
        with pytest.raises(
            RuntimeError,
            match="ATLAS_AUTH_API_KEY_INTROSPECTION_URL is required",
        ):
            validate_runtime_auth_config(settings)

    def test_multi_user_requires_membership_verification(
        self,
    ) -> None:
        """Hosted workspace checks need the app membership verification endpoint."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_audience=["https://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
            auth_membership_verification_url="",
        )
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_MEMBERSHIP_URL is required"):
            validate_runtime_auth_config(settings)

    def test_multi_user_requires_public_url(self) -> None:
        """Hosted OAuth challenges need the app origin to publish metadata URLs."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_audience=["https://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
            auth_membership_verification_url="https://atlas.test",
            auth_jwt_issuer="",
        )
        with pytest.raises(RuntimeError, match="ATLAS_PUBLIC_URL is required"):
            validate_runtime_auth_config(settings)

    def test_multi_user_requires_https_public_url(self) -> None:
        """Hosted OAuth metadata must not advertise an insecure issuer origin."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_issuer="http://atlas.test",
            auth_jwt_audience=["http://atlas.test/mcp"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
            auth_membership_verification_url="https://atlas.test",
        )
        with pytest.raises(RuntimeError, match="ATLAS_PUBLIC_URL must use https"):
            validate_runtime_auth_config(settings)

    def test_multi_user_allows_loopback_public_url_for_e2e(
        self,
    ) -> None:
        """Local E2E runs auth-enabled services on loopback HTTP."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_issuer="http://127.0.0.1:3100",
            auth_jwt_audience=["http://127.0.0.1:3100/mcp", "http://127.0.0.1:8000"],
            auth_internal_secret="internal-secret",
            auth_api_key_introspection_url="http://127.0.0.1:3100/api/auth/internal/api-key",
            auth_membership_verification_url="http://127.0.0.1:3100",
        )

        validate_runtime_auth_config(settings)

    def test_multi_user_requires_mcp_audience_first(self) -> None:
        """The first audience drives the MCP protected-resource metadata URL."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
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
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            multi_user=True,
            auth_jwt_audience=[],
            discovery_job_worker_enabled=False,
        )
        monkeypatch.setattr("atlas.main.get_settings", lambda: settings)

        with pytest.raises(RuntimeError, match="ATLAS_AUTH_JWT_AUDIENCES is required"):
            create_app()


class TestRefuseIdentityHarnessOutsideStaging:
    """A seam that skips identity verification belongs only to the proof lane."""

    def test_production_refuses_the_harness(self) -> None:
        """Production must not accept synthetic did:web identities."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            atproto_oauth_e2e_harness=True,
        )
        with pytest.raises(RuntimeError, match="only for the staging proof lane"):
            validate_runtime_auth_config(settings)

    def test_single_user_does_not_exempt_the_harness(self) -> None:
        """The refusal runs ahead of the no-accounts early return, not behind it.

        Whoever runs the instance, a verified badge shown to a reader has to
        mean the same thing.
        """
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            multi_user=False,
            atproto_oauth_e2e_harness=True,
        )
        with pytest.raises(RuntimeError, match="only for the staging proof lane"):
            validate_runtime_auth_config(settings)

    def test_staging_allows_the_harness(self) -> None:
        """Staging runs the proof lane, so the harness stays available there."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="staging",
            multi_user=False,
            atproto_oauth_e2e_harness=True,
        )
        validate_runtime_auth_config(settings)


class TestValidationHasNoEnvironmentExemption:
    """Requirements follow from accounts, not from which environment this is."""

    def test_dev_environment_is_not_exempt(self) -> None:
        """The escape hatch that caused the original divergence is gone.

        The API used to skip every check when ENVIRONMENT was dev, while the app
        enforced them regardless, so the default contributor stack was hosted to
        one half and dev to the other.
        """
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="dev",
            multi_user=True,
            auth_jwt_audience=[],
        )
        with pytest.raises(RuntimeError, match="ATLAS_AUTH_JWT_AUDIENCES is required"):
            validate_runtime_auth_config(settings)

    def test_single_user_needs_no_account_config(self) -> None:
        """With no accounts there is nothing to authenticate against."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            multi_user=False,
        )
        validate_runtime_auth_config(settings)
