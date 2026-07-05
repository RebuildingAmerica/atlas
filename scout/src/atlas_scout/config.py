"""Configuration models for Atlas Scout."""

from __future__ import annotations

import json
import os
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from types import NoneType, UnionType
from typing import Union, cast, get_args, get_origin

from pydantic import BaseModel, Field, ValidationError

APP_DIR_NAME = "atlas-scout"


def _standard_config_dir() -> Path:
    """Return the OS-standard per-user config directory for Scout."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / APP_DIR_NAME
    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg_config) if xdg_config else Path.home() / ".config"
    return base / APP_DIR_NAME


def _standard_data_dir() -> Path:
    """Return the OS-standard per-user data directory for Scout."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    if os.name == "nt":
        local_appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        base = Path(local_appdata) if local_appdata else Path.home() / "AppData" / "Local"
        return base / APP_DIR_NAME
    xdg_data = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg_data) if xdg_data else Path.home() / ".local" / "share"
    return base / APP_DIR_NAME


SCOUT_CONFIG_DIR = _standard_config_dir()
SCOUT_DATA_DIR = _standard_data_dir()
SCOUT_CONFIGS_DIR = SCOUT_CONFIG_DIR / "configs"
DEFAULT_DB_PATH = SCOUT_DATA_DIR / "scout.db"

#: Name of the default profile, used when no active profile has been set.
DEFAULT_PROFILE_NAME = "default"

#: Path to the persistent settings file (tracks active profile and other prefs).
SETTINGS_PATH = SCOUT_CONFIG_DIR / "settings.toml"

SECRET_CONFIG_FIELD_NAMES = frozenset({"api_key", "token", "secret", "credential"})

type TomlScalar = str | int | float | bool
type TomlStringList = list[str]
type TomlPrimitive = TomlScalar | TomlStringList
type TomlTargetTable = dict[str, TomlPrimitive]
type TomlTable = dict[str, TomlPrimitive | list[TomlTargetTable]]
type TomlDocument = dict[str, TomlTable]
type ConfigScalarType = type[str] | type[int] | type[float] | type[bool]


class ConfigMutationError(ValueError):
    """Raised when a profile config mutation is not safe or valid."""

    def __init__(self, *, title: str, message: str, hint: str | None = None) -> None:
        """Create a user-facing config mutation error."""
        super().__init__(message)
        self.title = title
        self.message = message
        self.hint = hint


@dataclass(frozen=True, slots=True)
class ConfigField:
    """A scalar profile config field that may be edited through the expert path."""

    section: str
    field: str
    value_type: ConfigScalarType

    @property
    def key(self) -> str:
        """Return the dotted section.field key."""
        return f"{self.section}.{self.field}"


@dataclass(frozen=True, slots=True)
class ConfigValueRow:
    """A scalar config value prepared for display."""

    section: str
    field: str
    value: TomlScalar | None

    @property
    def key(self) -> str:
        """Return the dotted section.field key."""
        return f"{self.section}.{self.field}"


class Settings(BaseModel):
    """Persistent user settings stored outside of any config profile."""

    active_profile: str = DEFAULT_PROFILE_NAME


def load_settings() -> Settings:
    """Load settings from disk, falling back to defaults."""
    if SETTINGS_PATH.exists():
        with SETTINGS_PATH.open("rb") as f:
            data = tomllib.load(f)
        return Settings.model_validate(data)
    return Settings()


def save_settings(settings: Settings) -> None:
    """Persist settings to disk."""
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = [f'active_profile = "{settings.active_profile}"', ""]
    SETTINGS_PATH.write_text("\n".join(lines))


def get_active_profile_name() -> str:
    """Read the active profile name from settings."""
    return load_settings().active_profile


def set_active_profile_name(name: str) -> None:
    """Update the active profile in settings."""
    settings = load_settings()
    settings.active_profile = name
    save_settings(settings)


def get_active_config_path() -> Path:
    """Return the path to the active profile's config file."""
    return SCOUT_CONFIGS_DIR / f"{get_active_profile_name()}.toml"


class LLMConfig(BaseModel):
    """Configuration for the LLM provider (model selection and concurrency)."""

    provider: str = "ollama"
    model: str = "llama3.1:8b"
    base_url: str | None = None
    ollama_base_url: str | None = None
    lmstudio_base_url: str | None = None
    api_key: str | None = None
    max_concurrent: int = 10
    timeout_seconds: float = 120.0

    def configured_base_url(self, provider: str) -> str | None:
        """Return a configured endpoint for a local provider, including legacy fallback."""
        normalized = provider.strip().lower()
        if normalized == "ollama":
            return self.ollama_base_url or self._legacy_base_url_for("ollama")
        if normalized == "lmstudio":
            return self.lmstudio_base_url or self._legacy_base_url_for("lmstudio")
        return None

    def set_configured_base_url(self, provider: str, base_url: str | None) -> None:
        """Store an endpoint on the provider-specific field."""
        normalized = provider.strip().lower()
        if normalized == "ollama":
            self.ollama_base_url = base_url
        elif normalized == "lmstudio":
            self.lmstudio_base_url = base_url
        self.base_url = None

    def clear_configured_base_url(self, provider: str) -> None:
        """Clear a provider endpoint and any matching legacy endpoint."""
        self.set_configured_base_url(provider, None)

    def has_configured_base_url(self, provider: str) -> bool:
        """Return whether a local provider has an explicit endpoint configured."""
        return self.configured_base_url(provider) is not None

    def _legacy_base_url_for(self, provider: str) -> str | None:
        if self.provider.strip().lower() == provider:
            return self.base_url
        return None


class ScraperConfig(BaseModel):
    """Configuration for the web scraper (concurrency, depth, and caching)."""

    max_concurrent_searches: int = 0
    max_concurrent_fetches: int = 20
    page_cache_ttl_days: int = 7
    revisit_cached_urls: bool = False
    follow_links: bool = True
    max_link_depth: int = 2
    max_pages_per_seed: int = 20
    request_delay_ms: int = 200
    browser_fallback_enabled: bool = True
    browser_render_timeout_ms: int = 15000
    max_browser_renders_per_run: int = 8
    max_browser_concurrent: int = 1
    search_country: str = ""
    search_freshness: str = ""


class RuntimeConfig(BaseModel):
    """Configuration for adaptive runtime sizing and resource caps."""

    auto_tune: bool = True
    max_memory_percent: int = 70
    max_total_workers: int | None = None


class PipelineConfig(BaseModel):
    """Configuration for pipeline behavior (dedup, scoring, gap analysis)."""

    dedup_batch_size: int = 50
    min_entry_score: float = 0.3
    gap_analysis: bool = True
    iterative_deepening: bool = False
    reuse_cached_extractions: bool = True


class ScheduleTarget(BaseModel):
    """A single location+issues pair to run on a schedule."""

    location: str
    issues: list[str] = Field(default_factory=list)
    search_depth: str = "standard"


class ScheduleConfig(BaseModel):
    """Configuration for automated scheduled discovery runs."""

    enabled: bool = False
    cron: str = "0 2 * * *"
    max_concurrent_runs: int = 2
    targets: list[ScheduleTarget] = Field(default_factory=list)


class ContributionConfig(BaseModel):
    """Configuration for contributing discovered entries back to Atlas."""

    enabled: bool = False
    api_key: str = ""
    atlas_url: str = "https://atlas.rebuildingus.org"
    min_score: float = 0.7


class StoreConfig(BaseModel):
    """Configuration for the local SQLite store path."""

    path: str = str(DEFAULT_DB_PATH)


class ScoutConfig(BaseModel):
    """Root configuration model for Atlas Scout."""

    llm: LLMConfig = Field(default_factory=LLMConfig)
    scraper: ScraperConfig = Field(default_factory=ScraperConfig)
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    contribution: ContributionConfig = Field(default_factory=ContributionConfig)
    store: StoreConfig = Field(default_factory=StoreConfig)


def load_config_data(path: Path) -> TomlDocument:
    """Load raw profile TOML data for safe mutation."""
    if not path.exists():
        return {}
    with path.open("rb") as handle:
        return cast("TomlDocument", tomllib.load(handle))


def write_config_data(path: Path, data: TomlDocument) -> None:
    """Write profile TOML with scalar tables and list-of-table values."""
    _drop_secret_config_fields(data)
    _validate_config_document(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for section, values in data.items():
        scalar_items = [
            (key, value) for key, value in values.items() if not _is_toml_table_array(value)
        ]
        table_arrays = [
            (key, value) for key, value in values.items() if _is_toml_table_array(value)
        ]
        if scalar_items:
            lines.append(f"[{section}]")
            for key, value in scalar_items:
                lines.append(f"{key} = {_format_toml_value(value)}")
            lines.append("")
        for key, value in table_arrays:
            tables = cast("list[TomlTargetTable]", value)
            for table in tables:
                lines.append(f"[[{section}.{key}]]")
                for table_key, table_value in table.items():
                    lines.append(f"{table_key} = {_format_toml_value(table_value)}")
                lines.append("")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def scalar_config_rows(config: ScoutConfig) -> list[ConfigValueRow]:
    """Return all non-secret scalar profile fields for display."""
    rows: list[ConfigValueRow] = []
    for section, model_type in _iter_config_section_types():
        section_obj = getattr(config, section)
        for field in model_type.model_fields:
            if field in SECRET_CONFIG_FIELD_NAMES:
                continue
            if _scalar_type_for_field(model_type, field) is None:
                continue
            value = getattr(section_obj, field)
            rows.append(
                ConfigValueRow(section=section, field=field, value=cast("TomlScalar | None", value))
            )
    return rows


def get_scalar_config_value(config: ScoutConfig, key: str) -> TomlScalar | None:
    """Return one validated scalar config value."""
    field = scalar_config_field(key)
    section_obj = getattr(config, field.section)
    return cast("TomlScalar | None", getattr(section_obj, field.field))


def set_scalar_config_value(path: Path, key: str, raw_value: str) -> TomlScalar:
    """Set one validated scalar config field in a profile file."""
    field = scalar_config_field(key)
    value = _coerce_scalar_value(raw_value, field.value_type)
    data = load_config_data(path)
    section = _config_section_table(data, field.section)
    section[field.field] = value
    write_config_data(path, data)
    return value


def save_local_model_settings(
    path: Path,
    config: ScoutConfig,
    *,
    provider: str,
    model: str,
    base_url: str | None,
) -> None:
    """Persist selected local model settings without storing secrets."""
    data = load_config_data(path)
    llm = _config_section_table(data, "llm")
    llm["provider"] = provider
    llm["model"] = model
    llm.pop("base_url", None)
    if config.llm.ollama_base_url:
        llm["ollama_base_url"] = config.llm.ollama_base_url
    if config.llm.lmstudio_base_url:
        llm["lmstudio_base_url"] = config.llm.lmstudio_base_url
    if base_url:
        if provider == "ollama":
            llm["ollama_base_url"] = base_url
        elif provider == "lmstudio":
            llm["lmstudio_base_url"] = base_url
    write_config_data(path, data)


def update_schedule_settings(
    path: Path,
    *,
    enabled: bool | None,
    cron: str | None,
    max_concurrent_runs: int | None,
) -> ScheduleConfig:
    """Persist schedule scalar settings and return the validated schedule config."""
    data = load_config_data(path)
    schedule = _config_section_table(data, "schedule")
    if enabled is not None:
        schedule["enabled"] = enabled
    if cron is not None:
        schedule["cron"] = cron
    if max_concurrent_runs is not None:
        schedule["max_concurrent_runs"] = max_concurrent_runs
    write_config_data(path, data)
    return load_config(path).schedule


def add_schedule_target(path: Path, target: ScheduleTarget) -> ScheduleConfig:
    """Append one structured schedule target to the profile."""
    data = load_config_data(path)
    schedule = _config_section_table(data, "schedule")
    targets = _schedule_target_tables(schedule)
    targets.append(_schedule_target_to_table(target))
    schedule["targets"] = targets
    write_config_data(path, data)
    return load_config(path).schedule


def remove_schedule_target(path: Path, index: int) -> ScheduleTarget:
    """Remove one schedule target by zero-based index."""
    data = load_config_data(path)
    schedule = _config_section_table(data, "schedule")
    current_targets = load_config(path).schedule.targets
    if index < 0 or index >= len(current_targets):
        raise ConfigMutationError(
            title="Schedule target not found",
            message=f"target {index + 1} is not configured.",
        )
    removed = current_targets[index]
    remaining = [
        _schedule_target_to_table(target)
        for target_index, target in enumerate(current_targets)
        if target_index != index
    ]
    if remaining:
        schedule["targets"] = remaining
    else:
        schedule.pop("targets", None)
    write_config_data(path, data)
    return removed


def clear_schedule_targets(path: Path) -> int:
    """Remove every configured schedule target and return the number removed."""
    data = load_config_data(path)
    schedule = _config_section_table(data, "schedule")
    removed_count = len(load_config(path).schedule.targets)
    schedule.pop("targets", None)
    write_config_data(path, data)
    return removed_count


def scalar_config_field(key: str) -> ConfigField:
    """Return a validated scalar config field description."""
    parts = key.split(".")
    if len(parts) != 2:
        raise ConfigMutationError(
            title="Invalid config key",
            message="key must be section.field.",
            hint="Example: llm.provider",
        )
    section, field = parts
    model_type = _config_section_type(section)
    if field in SECRET_CONFIG_FIELD_NAMES:
        raise ConfigMutationError(
            title="Secret config not saved",
            message="Secrets are not saved in Scout profile config.",
            hint=(
                "Use `scout search connect` for search, `scout login` for Atlas sync, "
                "or an environment variable for automation."
            ),
        )
    if field not in model_type.model_fields:
        raise ConfigMutationError(
            title="Unknown config field",
            message=f"{section}.{field} is not a Scout profile setting.",
            hint=f"Known fields in {section}: {', '.join(sorted(model_type.model_fields))}",
        )
    value_type = _scalar_type_for_field(model_type, field)
    if value_type is None:
        raise ConfigMutationError(
            title="Structured config field",
            message=f"{section}.{field} cannot be edited with `scout config set`.",
            hint=_structured_config_hint(section, field),
        )
    return ConfigField(section=section, field=field, value_type=value_type)


def load_config(path: Path) -> ScoutConfig:
    """Load ScoutConfig from a TOML file. Falls back to defaults if file is missing."""
    _prepare_user_dirs()

    if not path.exists():
        return ScoutConfig()

    with path.open("rb") as f:
        data = tomllib.load(f)

    return ScoutConfig.model_validate(data)


def _iter_config_section_types() -> list[tuple[str, type[BaseModel]]]:
    """Return root config sections that are modeled as Pydantic objects."""
    sections: list[tuple[str, type[BaseModel]]] = []
    for section, field in ScoutConfig.model_fields.items():
        annotation = field.annotation
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            sections.append((section, annotation))
    return sections


def _config_section_type(section: str) -> type[BaseModel]:
    """Return the Pydantic model type for a root config section."""
    for section_name, model_type in _iter_config_section_types():
        if section_name == section:
            return model_type
    valid_sections = ", ".join(sorted(ScoutConfig.model_fields))
    raise ConfigMutationError(
        title="Unknown config section",
        message=f"{section} is not a Scout profile config section.",
        hint=f"Valid sections: {valid_sections}",
    )


def _scalar_type_for_field(model_type: type[BaseModel], field: str) -> ConfigScalarType | None:
    """Return the editable scalar type for one model field, or None for structured fields."""
    annotation = model_type.model_fields[field].annotation
    return _scalar_type_for_annotation(annotation)


def _scalar_type_for_annotation(annotation: object) -> ConfigScalarType | None:
    """Return the scalar type represented by a field annotation."""
    if annotation in (str, int, float, bool):
        return annotation
    origin = get_origin(annotation)
    if origin in (Union, UnionType):
        args = [arg for arg in get_args(annotation) if arg is not NoneType]
        if len(args) == 1:
            return _scalar_type_for_annotation(args[0])
    return None


def _coerce_scalar_value(raw_value: str, value_type: ConfigScalarType) -> TomlScalar:
    """Coerce a CLI string into a TOML scalar using the config field type."""
    if value_type is bool:
        lowered = raw_value.strip().lower()
        if lowered in {"true", "yes", "1", "on"}:
            return True
        if lowered in {"false", "no", "0", "off"}:
            return False
        raise ConfigMutationError(
            title="Invalid config value",
            message=f"{raw_value!r} is not a boolean.",
            hint="Use true or false.",
        )
    if value_type is int:
        try:
            return int(raw_value)
        except ValueError as exc:
            raise ConfigMutationError(
                title="Invalid config value",
                message=f"{raw_value!r} is not an integer.",
            ) from exc
    if value_type is float:
        try:
            return float(raw_value)
        except ValueError as exc:
            raise ConfigMutationError(
                title="Invalid config value",
                message=f"{raw_value!r} is not a number.",
            ) from exc
    return raw_value


def _config_section_table(data: TomlDocument, section: str) -> TomlTable:
    """Return a mutable root config table, creating it if needed."""
    existing = data.setdefault(section, {})
    if not isinstance(existing, dict):
        raise ConfigMutationError(
            title="Invalid config file",
            message=f"{section} must be a TOML table.",
        )
    return existing


def _schedule_target_tables(schedule: TomlTable) -> list[TomlTargetTable]:
    """Return schedule target tables from raw TOML data."""
    existing = schedule.get("targets")
    if existing is None:
        return []
    if _is_toml_table_array(existing):
        return list(cast("list[TomlTargetTable]", existing))
    raise ConfigMutationError(
        title="Invalid schedule config",
        message="schedule.targets must be a TOML array of tables.",
    )


def _schedule_target_to_table(target: ScheduleTarget) -> TomlTargetTable:
    """Convert a schedule target into a TOML table."""
    return {
        "location": target.location,
        "issues": list(target.issues),
        "search_depth": target.search_depth,
    }


def _structured_config_hint(section: str, field: str) -> str:
    """Return domain command guidance for structured config fields."""
    if section == "schedule" and field == "targets":
        return "Use `scout config schedule target add`, `list`, `remove`, or `clear`."
    return f"Use a domain-specific `scout config {section}` command for this setting."


def _drop_secret_config_fields(data: TomlDocument) -> None:
    """Remove legacy secret-like fields before writing profile TOML."""
    for values in data.values():
        for field in list(values):
            if field in SECRET_CONFIG_FIELD_NAMES:
                values.pop(field, None)


def _validate_config_document(data: TomlDocument) -> None:
    """Validate raw config data through the ScoutConfig schema."""
    try:
        ScoutConfig.model_validate(data)
    except ValidationError as exc:
        raise ConfigMutationError(
            title="Invalid config value",
            message=str(exc.errors()[0]["msg"]),
        ) from exc


def _is_toml_table_array(value: object) -> bool:
    """Return whether a TOML value is an array of tables."""
    return isinstance(value, list) and all(isinstance(item, dict) for item in value)


def _format_toml_value(value: object) -> str:
    """Format one supported TOML value."""
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return "[" + ", ".join(json.dumps(item) for item in value) + "]"
    raise ConfigMutationError(
        title="Invalid config value",
        message=f"Cannot write TOML value of type {type(value).__name__}.",
    )


def _prepare_user_dirs() -> None:
    """Ensure the standardized Scout config and data directories exist."""
    SCOUT_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    SCOUT_DATA_DIR.mkdir(parents=True, exist_ok=True)
