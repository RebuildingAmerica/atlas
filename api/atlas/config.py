"""Compatibility exports for the canonical Atlas platform settings module.

This module keeps older imports working while Atlas standardizes on
``atlas.platform.config`` as the single runtime-settings implementation.
"""

from atlas.platform.config import Settings, get_settings

__all__ = ["Settings", "get_settings"]
