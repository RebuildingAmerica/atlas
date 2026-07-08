"""Production configuration validator edge-case tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.platform.config import Settings

if TYPE_CHECKING:
    from _pytest.monkeypatch import MonkeyPatch


class TestSettingsValidatorEdgeCases:
    """Branches in the env-var parser, backend validator, and helper accessors."""

    def test_string_list_validator_accepts_none_as_empty(self) -> None:
        """A None env-var should normalise to an empty list."""
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

    def test_string_list_validator_parses_comma_separated_env_vars(
        self, monkeypatch: MonkeyPatch
    ) -> None:
        """Comma-separated env vars should reach the list validator unchanged."""
        monkeypatch.setenv(
            "ATLAS_AUTH_JWT_AUDIENCES", "https://atlas.test/mcp,https://api.atlas.test"
        )
        monkeypatch.setenv("ATLAS_AUTH_DEFAULT_SCOPE", "discovery:read,profiles:write")

        settings = Settings(database_url="sqlite:///tmp/test.db")

        assert settings.auth_jwt_audience == [
            "https://atlas.test/mcp",
            "https://api.atlas.test",
        ]
        assert settings.auth_jwt_default_scope == ["discovery:read", "profiles:write"]

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
            auth_jwt_audience=["https://atlas.test/"],
        )
        assert settings.auth_resource_metadata_url == (
            "https://atlas.test/.well-known/oauth-protected-resource"
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

    def test_auth_resource_metadata_url_without_resource_path(self) -> None:
        """A root audience should keep the metadata document at the base path."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            auth_jwt_audience=["https://atlas.test/"],
        )
        assert settings.auth_resource_metadata_url == (
            "https://atlas.test/.well-known/oauth-protected-resource"
        )
