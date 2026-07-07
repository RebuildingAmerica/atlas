"""Profile config loading, scalar-field editing, and schedule-target CRUD."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from types import NoneType, UnionType
from typing import TYPE_CHECKING, Union, cast, get_args, get_origin

from pydantic import BaseModel

from atlas_scout.config import paths
from atlas_scout.config.errors import ConfigMutationError
from atlas_scout.config.schema import (
    SECRET_CONFIG_FIELD_NAMES,
    ScheduleConfig,
    ScheduleTarget,
    ScoutConfig,
)
from atlas_scout.config.toml_io import (
    TomlDocument,
    TomlScalar,
    TomlTable,
    TomlTargetTable,
    is_toml_table_array,
    load_config_data,
    write_config_data,
)

if TYPE_CHECKING:
    from pathlib import Path

type ConfigScalarType = type[str] | type[int] | type[float] | type[bool]


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


def load_config(path: Path) -> ScoutConfig:
    """Load ScoutConfig from a TOML file. Falls back to defaults if file is missing."""
    paths.prepare_user_dirs()

    if not path.exists():
        return ScoutConfig()

    with path.open("rb") as f:
        data = tomllib.load(f)

    return ScoutConfig.model_validate(data)


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
    if is_toml_table_array(existing):
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
