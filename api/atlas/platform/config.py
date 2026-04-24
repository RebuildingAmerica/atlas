"""
Configuration management for The Atlas API.

Uses pydantic-settings to load configuration from environment variables
with sensible defaults. Supports dev, staging, and production environments.
"""

import logging
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

API_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    database_backend: Literal["sqlite", "postgres"] = Field(
        default="sqlite", validation_alias="DATABASE_BACKEND"
    )
    """Explicit database backend selection. Must match DATABASE_URL scheme."""

    database_url: str = Field(default="sqlite:///atlas.db", validation_alias="DATABASE_URL")
    """Database connection URL."""

    # API Keys
    anthropic_api_key: str = ""
    """Anthropic API key for Claude access."""

    search_api_key: str | None = None
    """Optional search API key (e.g., SerpAPI, Brave Search)."""

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]
    """Allowed CORS origins for app access."""

    # Logging
    log_level: Literal["debug", "info", "warning", "error", "critical"] = "info"
    """Application log level."""

    # Environment
    environment: Literal["dev", "staging", "production"] = "dev"
    """Current environment."""

    # Deploy mode
    deploy_mode: str = Field(default="", validation_alias="ATLAS_DEPLOY_MODE")
    """Deploy mode. Set to "local" to disable auth; any other value enables auth."""

    auth_internal_secret: str = Field(default="", validation_alias="ATLAS_AUTH_INTERNAL_SECRET")
    """Shared secret for trusted app-to-API requests."""

    auth_api_key_introspection_url: str | None = Field(
        default=None, validation_alias="ATLAS_AUTH_API_KEY_INTROSPECTION_URL"
    )
    """Internal endpoint used to verify API keys."""

    auth_membership_verification_url: str = Field(
        default="", validation_alias="ATLAS_AUTH_MEMBERSHIP_URL"
    )
    """Base URL for the membership verification endpoint."""

    auth_jwt_issuer: str = Field(default="", validation_alias="ATLAS_PUBLIC_URL")
    """JWT issuer (typically the public URL of the auth server)."""

    auth_jwt_audience: str = Field(default="", validation_alias="ATLAS_API_AUDIENCE")
    """Expected JWT audience claim."""

    auth_jwt_jwks_url: str = ""
    """JWKS endpoint URL. Auto-derived from auth_jwt_issuer when not set."""

    # Server
    host: str = "0.0.0.0"
    """Server host address."""

    port: int = Field(default=8000, validation_alias="PORT")
    """Server port number."""

    discovery_inline: bool = False
    """Run discovery synchronously in-process. Useful for tests."""

    # Feature flags
    enable_api_docs: bool | None = None
    """Legacy toggle for OpenAPI spec + docs UI publishing."""

    enable_openapi_spec: bool | None = None
    """Enable the OpenAPI schema endpoint (/openapi.json)."""

    enable_api_docs_ui: bool | None = None
    """Enable interactive documentation UIs (/docs, /redoc)."""

    model_config = SettingsConfigDict(
        env_file=API_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        populate_by_name=True,
    )

    @model_validator(mode="after")
    def set_environment_defaults(self) -> "Settings":
        """Apply environment-sensitive defaults after parsing."""
        # Validate that DATABASE_BACKEND matches DATABASE_URL scheme.
        url_is_postgres = self.database_url.startswith(("postgresql://", "postgres://"))
        if self.database_backend == "postgres" and not url_is_postgres:
            msg = (
                f"DATABASE_BACKEND is 'postgres' but DATABASE_URL does not start with "
                f"postgresql:// or postgres:// (got {self.database_url[:30]}...)"
            )
            raise ValueError(msg)
        if self.database_backend == "sqlite" and url_is_postgres:
            msg = (
                "DATABASE_BACKEND is 'sqlite' but DATABASE_URL is a PostgreSQL URL. "
                "Set DATABASE_BACKEND=postgres explicitly to use PostgreSQL."
            )
            raise ValueError(msg)
        if self.enable_api_docs is not None:
            self.enable_openapi_spec = self.enable_api_docs
            self.enable_api_docs_ui = self.enable_api_docs
        if self.enable_openapi_spec is None:
            self.enable_openapi_spec = True
        if self.enable_api_docs_ui is None:
            self.enable_api_docs_ui = self.environment != "production"
        self.enable_api_docs = self.enable_openapi_spec and self.enable_api_docs_ui
        if self.auth_jwt_issuer:
            base = self.auth_jwt_issuer.rstrip("/")
            # The OAuth issuer includes the auth basePath (/api/auth)
            self.auth_jwt_issuer = f"{base}/api/auth"
            if not self.auth_jwt_jwks_url:
                self.auth_jwt_jwks_url = f"{base}/api/auth/jwks"
        if self.deploy_mode != "local":
            logger.info(
                "Resolved auth configuration",
                extra={
                    "auth_jwt_issuer": self.auth_jwt_issuer or "(not set)",
                    "auth_jwt_jwks_url": self.auth_jwt_jwks_url or "(not set)",
                    "auth_jwt_audience": self.auth_jwt_audience or "(not set)",
                    "auth_membership_url": self.auth_membership_verification_url or "(not set)",
                },
            )
        return self

    def get_database_url(self) -> str:
        """
        Get the full database URL.

        Returns
        -------
        str
            The configured database URL.
        """
        return self.database_url


def get_settings() -> Settings:
    """
    Get the application settings singleton.

    Returns
    -------
    Settings
        The loaded application settings.
    """
    return Settings()
