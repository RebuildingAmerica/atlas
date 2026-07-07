"""Hand-rolled TOML read/write for Scout profile config files."""

from __future__ import annotations

import json
import tomllib
from typing import TYPE_CHECKING, cast

from pydantic import ValidationError

from atlas_scout.config.errors import ConfigMutationError
from atlas_scout.config.schema import SECRET_CONFIG_FIELD_NAMES, ScoutConfig

if TYPE_CHECKING:
    from pathlib import Path

type TomlScalar = str | int | float | bool
type TomlStringList = list[str]
type TomlPrimitive = TomlScalar | TomlStringList
type TomlTargetTable = dict[str, TomlPrimitive]
type TomlTable = dict[str, TomlPrimitive | list[TomlTargetTable]]
type TomlDocument = dict[str, TomlTable]


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
            (key, value) for key, value in values.items() if not is_toml_table_array(value)
        ]
        table_arrays = [(key, value) for key, value in values.items() if is_toml_table_array(value)]
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


def is_toml_table_array(value: object) -> bool:
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
