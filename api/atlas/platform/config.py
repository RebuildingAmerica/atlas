"""
Configuration management for The Atlas API.

Uses pydantic-settings to load configuration from environment variables
with sensible defaults. Supports dev, staging, and production environments.
"""

import logging
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from atlas.platform.config_auth import (
    protected_resource_metadata_url,
    validate_runtime_auth_config,
)

logger = logging.getLogger(__name__)

API_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


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
    cors_origins: list[str] = ["https://atlas.localhost"]
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

    auth_membership_protection_bypass_secret: str = Field(
        default="", validation_alias="ATLAS_AUTH_MEMBERSHIP_PROTECTION_BYPASS_SECRET"
    )
    """Optional edge-protection bypass secret for server-to-server membership checks."""

    auth_jwt_issuer: str = Field(default="", validation_alias="ATLAS_PUBLIC_URL")
    """JWT issuer (typically the public URL of the auth server)."""

    auth_jwt_audience: Annotated[list[str], NoDecode] = Field(
        default_factory=list, validation_alias="ATLAS_AUTH_JWT_AUDIENCES"
    )
    """Accepted JWT audience claims. Comma-separated when supplied via env var.

    A token is accepted when its `aud` claim matches any audience in the list.
    Distinct audiences should be configured for each Resource Server (REST API
    vs. MCP) per RFC 8707 so a token leaked from one cannot be replayed against
    the other.
    """

    auth_jwt_jwks_url: str = ""
    """JWKS endpoint URL. Auto-derived from auth_jwt_issuer when not set."""

    auth_jwt_default_scope: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["discovery:read"],
        validation_alias="ATLAS_AUTH_DEFAULT_SCOPE",
    )
    """Scopes published in the ``WWW-Authenticate`` 401 challenge.

    Per MCP authorization spec §"Protected Resource Metadata Discovery
    Requirements", the challenge SHOULD carry a default scope hint so MCP
    clients can request the smallest token that satisfies a baseline
    ``tools/list`` call before negotiating up via step-up authorization.
    """

    operator_allowed_emails: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        validation_alias="ATLAS_OPERATOR_ALLOWED_EMAILS",
    )
    """Operator emails allowed to access Atlas-maintained review surfaces."""

    @field_validator(
        "operator_allowed_emails",
        "auth_jwt_audience",
        "auth_jwt_default_scope",
        mode="before",
    )
    @classmethod
    def _parse_string_list(cls, value: object) -> list[str]:
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

    discovery_job_worker_enabled: bool = Field(
        default=True, validation_alias="DISCOVERY_JOB_WORKER_ENABLED"
    )
    """Start the API's durable discovery job worker in the application lifespan."""

    firehose_delivery_worker_enabled: bool = Field(
        default=False,
        validation_alias="FIREHOSE_DELIVERY_WORKER_ENABLED",
    )
    """Start the Firehose observation delivery worker in the application lifespan."""

    firehose_delivery_worker_poll_seconds: float = Field(
        default=10,
        validation_alias="FIREHOSE_DELIVERY_WORKER_POLL_SECONDS",
    )
    """Seconds between Firehose delivery worker polling cycles."""

    firehose_delivery_worker_batch_size: int = Field(
        default=25,
        validation_alias="FIREHOSE_DELIVERY_WORKER_BATCH_SIZE",
    )
    """Maximum Firehose observation deliveries claimed per worker pass."""

    firehose_delivery_worker_lease_seconds: int = Field(
        default=60,
        validation_alias="FIREHOSE_DELIVERY_WORKER_LEASE_SECONDS",
    )
    """Lease duration for claimed Firehose observation deliveries."""

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

    # Cost controls
    discovery_max_run_cost: float = Field(default=5.0, validation_alias="DISCOVERY_MAX_RUN_COST")
    """Maximum estimated spend (USD) a single discovery run may incur."""

    discovery_max_daily_cost: float = Field(
        default=50.0, validation_alias="DISCOVERY_MAX_DAILY_COST"
    )
    """Maximum estimated spend (USD) across all discovery runs in a rolling day."""

    discovery_cost_kill_switch: bool = Field(
        default=False, validation_alias="DISCOVERY_COST_KILL_SWITCH"
    )
    """Operator kill switch. When True, discovery spend is halted immediately."""

    enable_openapi_spec: bool | None = None
    """Enable the OpenAPI schema endpoint (/openapi.json)."""

    anonymous_rate_limit_enabled: bool = Field(
        default=True,
        validation_alias="ATLAS_ANON_RATE_LIMIT_ENABLED",
    )
    """Enable in-process rate limits for unauthenticated public traffic."""

    anonymous_rate_limit_reads_per_minute: int = Field(
        default=30,
        ge=0,
        validation_alias="ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE",
    )
    """Anonymous public read requests allowed per client per minute."""

    anonymous_rate_limit_writes_per_minute: int = Field(
        default=10,
        ge=0,
        validation_alias="ATLAS_ANON_RATE_LIMIT_WRITES_PER_MINUTE",
    )
    """Anonymous public write requests allowed per client per minute."""

    anonymous_rate_limit_total_per_hour: int = Field(
        default=120,
        ge=0,
        validation_alias="ATLAS_ANON_RATE_LIMIT_TOTAL_PER_HOUR",
    )
    """Anonymous public requests allowed per client per hour."""

    anonymous_credential_rate_limit_per_minute: int = Field(
        default=60,
        ge=0,
        validation_alias="ATLAS_ANON_CREDENTIAL_RATE_LIMIT_PER_MINUTE",
    )
    """Credential-bearing requests allowed before auth verification per client per minute."""

    anonymous_credential_rate_limit_total_per_hour: int = Field(
        default=600,
        ge=0,
        validation_alias="ATLAS_ANON_CREDENTIAL_RATE_LIMIT_TOTAL_PER_HOUR",
    )
    """Credential-bearing requests allowed before auth verification per client per hour."""

    trusted_proxy_hops: int = Field(
        default=1,
        ge=0,
        validation_alias="ATLAS_TRUSTED_PROXY_HOPS",
    )
    """Number of trusted proxy hops at the end of a forwarded-for chain."""

    trust_unsigned_forward_headers: bool = Field(
        default=False,
        validation_alias="ATLAS_TRUST_UNSIGNED_FORWARD_HEADERS",
    )
    """Trust unsigned forwarded headers when deriving direct API client identity."""

    edge_origin_secret: str = Field(default="", validation_alias="ATLAS_EDGE_ORIGIN_SECRET")
    """Shared secret used by the edge proxy when signing origin identity headers."""

    # MCP widgets
    mcp_widget_assets_dir: str | None = Field(
        default=None, validation_alias="ATLAS_MCP_WIDGET_ASSETS_DIR"
    )
    """Optional override directory for built MCP Apps widget bundles.

    See `atlas.platform.mcp.widgets.resolve_widget_asset_dir`. Only needed
    when the built widget assets don't live at either of that resolver's two
    default locations (a production Docker-populated directory co-located
    with the module, or the monorepo dev build output).
    """

    mcp_form_elicitation_enabled: bool = Field(
        default=True,
        validation_alias="ATLAS_MCP_FORM_ELICITATION_ENABLED",
    )
    """Enable form-mode MCP elicitation for clarification and confirmation flows."""

    mcp_url_elicitation_enabled: bool = Field(
        default=True,
        validation_alias="ATLAS_MCP_URL_ELICITATION_ENABLED",
    )
    """Enable URL-mode MCP elicitation for browser handoff flows."""

    mcp_workbench_handoffs_enabled: bool = Field(
        default=True,
        validation_alias="ATLAS_MCP_WORKBENCH_HANDOFFS_ENABLED",
    )
    """Enable MCP-originated Workbench write handoffs."""

    model_config = SettingsConfigDict(
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
        if self.enable_openapi_spec is None:
            self.enable_openapi_spec = True
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

    @property
    def auth_resource_metadata_url(self) -> str:
        """Return the absolute URL of the protected-resource metadata document.

        Empty string when auth is disabled (no audience configured).
        """
        if not self.auth_jwt_resource_url:
            return ""
        return protected_resource_metadata_url(self.auth_jwt_resource_url)


def get_settings() -> Settings:
    """
    Get the application settings singleton.

    Returns
    -------
    Settings
        The loaded application settings.
    """
    return Settings(_env_file=API_ENV_FILE)


__all__ = ["Settings", "get_settings", "validate_runtime_auth_config"]
