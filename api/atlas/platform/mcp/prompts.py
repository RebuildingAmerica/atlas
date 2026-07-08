"""Atlas MCP prompts: user-selected civic research workflows."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.mcp.prompts_support import (  # noqa: F401
    _apply_prompt_elicitation_content,
    _clarify_prompt_arguments,
    _evidence_threshold_context,
    _has_prompt_value,
    _install_protocol_wrappers,
    _invalid_params,
    _missing_optional_prompt_fields,
    _missing_prompt_fields,
    _optional_context,
    _optional_prompt_elicitation_schema,
    _params_meta,
    _prompt_candidate_choices,
    _prompt_elicitation_schema,
    _prompt_field_schema,
    _request_missing_prompt_arguments,
    _request_optional_prompt_context,
    _tool_sequence,
)
from atlas.platform.mcp.prompts_templates import _register_prompt_templates

__all__ = [
    "install_prompts",
]


if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def install_prompts(mcp: FastMCP) -> None:
    """Wire Atlas's static MCP prompt catalog onto the server."""
    _register_prompt_templates(mcp)
    _install_protocol_wrappers(mcp)
