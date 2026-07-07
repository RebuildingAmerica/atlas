#!/usr/bin/env python3
"""Block git commands that try to bypass hooks with --no-verify."""

from __future__ import annotations

import json
import re
import shlex
import sys

GIT_OPTIONS_WITH_VALUES = {
    "--config-env",
    "--exec-path",
    "--git-dir",
    "--namespace",
    "--work-tree",
    "-C",
    "-c",
}
GIT_OPTIONS_WITH_VALUE_PREFIXES = tuple(f"{option}=" for option in GIT_OPTIONS_WITH_VALUES)
SHELL_SEPARATORS = {"&&", "||", ";", "|"}
FALLBACK_BLOCK_RE = re.compile(r"(^|[\s;&|()])(?:\S*/)?git\b[^\n;&|]*--no-verify\b")


def _is_git_token(token: str) -> bool:
    return token == "git" or token.endswith("/git")


def _skip_git_global_options(tokens: list[str], index: int) -> int:
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            return index + 1
        if token in SHELL_SEPARATORS or not token.startswith("-"):
            return index
        if token in GIT_OPTIONS_WITH_VALUES:
            index += 2
            continue
        if token.startswith(GIT_OPTIONS_WITH_VALUE_PREFIXES):
            index += 1
            continue
        index += 1
    return index


def _git_command_uses_no_verify(command: str) -> bool:
    try:
        tokens = shlex.split(command)
    except ValueError:
        return bool(FALLBACK_BLOCK_RE.search(command))

    for index, token in enumerate(tokens):
        if not _is_git_token(token):
            continue
        argument_index = _skip_git_global_options(tokens, index + 1)
        while argument_index < len(tokens) and tokens[argument_index] not in SHELL_SEPARATORS:
            if tokens[argument_index] == "--no-verify":
                return True
            argument_index += 1
    return bool(FALLBACK_BLOCK_RE.search(command))


def _deny() -> int:
    reason = (
        "git --no-verify is banned in this repo. Run the hooks and fix the "
        "underlying failure instead of bypassing verification."
    )
    print(
        json.dumps(
            {
                "decision": "block",
                "reason": reason,
                "hookSpecificOutput": {"permissionDecision": "deny"},
                "systemMessage": reason,
            },
            separators=(",", ":"),
        )
    )
    return 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0
    command = tool_input.get("command")
    if not isinstance(command, str):
        return 0
    if _git_command_uses_no_verify(command):
        return _deny()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
