"""
Configuration management for The Atlas API.

Uses pydantic-settings to load configuration from environment variables
with sensible defaults. Supports dev, staging, and production environments.
"""

import logging
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
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

    auth_jwt_audience: list[str] = Field(
        default_factory=list, validation_alias="ATLAS_API_AUDIENCE"
    )
    """Accepted JWT audience claims. Comma-separated when supplied via env var.

    A token is accepted when its `aud` claim matches any audience in the list.
    Distinct audiences should be configured for each Resource Server (REST API
    vs. MCP) per RFC 8707 so a token leaked from one cannot be replayed against
    the other.
    """

    auth_jwt_jwks_url: str = ""
    """JWKS endpoint URL. Auto-derived from auth_jwt_issuer when not set."""

    @field_validator("auth_jwt_audience", mode="before")
    @classmethod
    def _parse_audience_list(cls, value: object) -> list[str]:
        """Accept either a comma-separated env-var string or a Python list."""
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return [item.strip() for item in str(value).split(",") if item.strip()]

    # Server
    host: str = "0.0.0.0"
    """Server host address."""

    port: int = Field(default=8000, validation_alias="PORT")
    """Server port number."""

    discovery_inline: bool = False
    """Run discovery synchronously in-process. Useful for tests."""

    # Pipeline tuning
    discovery_search_depth: str = Field(
        default="standard", validation_alias="DISCOVERY_SEARCH_DEPTH"
    )
    """Search depth for query generation ('standard' or 'deep')."""

    discovery_min_entry_score: float = Field(
        default=0.3, validation_alias="DISCOVERY_MIN_ENTRY_SCORE"
    )
    """Minimum entry score for ranking (0.0-1.0)."""

    discovery_max_extraction_concurrency: int = Field(
        default=4, validation_alias="DISCOVERY_MAX_EXTRACTION_CONCURRENCY"
    )
    """Maximum concurrent extraction calls."""

    discovery_follow_links: bool = Field(default=False, validation_alias="DISCOVERY_FOLLOW_LINKS")
    """Follow links from fetched pages to discover additional sources."""

    discovery_max_link_depth: int = Field(default=1, validation_alias="DISCOVERY_MAX_LINK_DEPTH")
    """Maximum link-following depth."""

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

    @property
    def auth_jwt_resource_url(self) -> str:
        """Return the canonical resource URL for protected-resource metadata.

        Picks the first configured audience as the resource URL the API
        publishes via ``WWW-Authenticate: Bearer resource_metadata=...``.
        Empty when auth is disabled.
        """
        return self.auth_jwt_audience[0] if self.auth_jwt_audience else ""


def get_settings() -> Settings:
    """
    Get the application settings singleton.

    Returns
    -------
    Settings
        The loaded application settings.
    """
    return Settings()


def validate_runtime_auth_config(settings: Settings) -> None:
    """Fail fast when an auth-enabled deployment is missing required config.

    Called from app startup (not from Settings construction) so unit tests can
    instantiate ``Settings`` without supplying production env vars.

    Parameters
    ----------
    settings:
        The resolved application settings.

    Raises
    ------
    RuntimeError
        When ``ATLAS_DEPLOY_MODE`` is not ``"local"`` and ``ATLAS_API_AUDIENCE``
        is empty, since the API would otherwise emit RFC 6750 challenges
        without a discovery URL.
    """
    if settings.deploy_mode == "local":
        return
    if not settings.auth_jwt_audience:
        msg = (
            "ATLAS_API_AUDIENCE is required when ATLAS_DEPLOY_MODE is not 'local'. "
            "Set it to the canonical resource URL(s) the API accepts in JWT 'aud' "
            "claims, e.g. https://atlas.example.com/api."
        )
        raise RuntimeError(msg)
