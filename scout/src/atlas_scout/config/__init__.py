"""Configuration models for Atlas Scout.

Public API facade over the config/ package: OS-standard path resolution
(paths), the Pydantic profile schema (schema), TOML read/write (toml_io),
persistent active-profile settings (settings), and profile scalar/schedule
mutation helpers (mutations).
"""

from __future__ import annotations

from atlas_scout.config.errors import ConfigMutationError
from atlas_scout.config.mutations import (
    ConfigField,
    ConfigScalarType,
    ConfigValueRow,
    add_schedule_target,
    clear_schedule_targets,
    get_scalar_config_value,
    load_config,
    remove_schedule_target,
    save_local_model_settings,
    scalar_config_field,
    scalar_config_rows,
    set_scalar_config_value,
    update_schedule_settings,
)
from atlas_scout.config.paths import (
    APP_DIR_NAME,
    DEFAULT_DB_PATH,
    DEFAULT_PROFILE_NAME,
    SCOUT_CONFIG_DIR,
    SCOUT_CONFIGS_DIR,
    SCOUT_DATA_DIR,
    SETTINGS_PATH,
)
from atlas_scout.config.schema import (
    SECRET_CONFIG_FIELD_NAMES,
    ContributionConfig,
    LLMConfig,
    PipelineConfig,
    RuntimeConfig,
    ScheduleConfig,
    ScheduleTarget,
    ScoutConfig,
    ScraperConfig,
    StoreConfig,
)
from atlas_scout.config.settings import (
    Settings,
    get_active_config_path,
    get_active_profile_name,
    load_settings,
    save_settings,
    set_active_profile_name,
)
from atlas_scout.config.toml_io import (
    TomlDocument,
    TomlPrimitive,
    TomlScalar,
    TomlStringList,
    TomlTable,
    TomlTargetTable,
    load_config_data,
    write_config_data,
)

__all__ = [
    "APP_DIR_NAME",
    "DEFAULT_DB_PATH",
    "DEFAULT_PROFILE_NAME",
    "SCOUT_CONFIGS_DIR",
    "SCOUT_CONFIG_DIR",
    "SCOUT_DATA_DIR",
    "SECRET_CONFIG_FIELD_NAMES",
    "SETTINGS_PATH",
    "ConfigField",
    "ConfigMutationError",
    "ConfigScalarType",
    "ConfigValueRow",
    "ContributionConfig",
    "LLMConfig",
    "PipelineConfig",
    "RuntimeConfig",
    "ScheduleConfig",
    "ScheduleTarget",
    "ScoutConfig",
    "ScraperConfig",
    "Settings",
    "StoreConfig",
    "TomlDocument",
    "TomlPrimitive",
    "TomlScalar",
    "TomlStringList",
    "TomlTable",
    "TomlTargetTable",
    "add_schedule_target",
    "clear_schedule_targets",
    "get_active_config_path",
    "get_active_profile_name",
    "get_scalar_config_value",
    "load_config",
    "load_config_data",
    "load_settings",
    "remove_schedule_target",
    "save_local_model_settings",
    "save_settings",
    "scalar_config_field",
    "scalar_config_rows",
    "set_active_profile_name",
    "set_scalar_config_value",
    "update_schedule_settings",
    "write_config_data",
]
