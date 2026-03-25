"""
Configuration management for The Atlas backend.

Uses pydantic-settings to load configuration from environment variables
with sensible defaults. Supports dev, staging, and production environments.
"""

from typing import Literal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    database_url: str = "sqlite:///atlas.db"
    """SQLite database URL."""

    # API Keys
    anthropic_api_key: str
    """Anthropic API key for Claude access."""

    search_api_key: str | None = None
    """Optional search API key (e.g., SerpAPI, Brave Search)."""

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]
    """Allowed CORS origins for frontend access."""

    # Logging
    log_level: Literal["debug", "info", "warning", "error", "critical"] = "info"
    """Application log level."""

    # Environment
    environment: Literal["dev", "staging", "production"] = "dev"
    """Current environment."""

    # Server
    host: str = "0.0.0.0"
    """Server host address."""

    port: int = 8000
    """Server port number."""

    # Feature flags
    enable_api_docs: bool = True
    """Enable OpenAPI documentation endpoints (/docs, /redoc)."""

    class Config:
        """Pydantic configuration."""

        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False

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
    return Settings()  # type: ignore[return-value]
