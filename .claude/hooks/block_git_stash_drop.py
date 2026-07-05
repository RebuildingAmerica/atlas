#!/usr/bin/env python3
"""Block destructive stash deletion in Claude Code Bash tool calls."""

from __future__ import annotations

import json
import re
import shlex
import sys

BLOCKED_STASH_COMMANDS = {"clear", "drop"}
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
FALLBACK_BLOCK_RE = re.compile(
    r"(^|[\s;&|()])(?:\S*/)?git(?:\s+-[^\s;&|()]+(?:\s+[^\s;&|()]+)?)*"
    r"\s+stash\s+(drop|clear)(\s|$)"
)


def _is_git_token(token: str) -> bool:
    return token == "git" or token.endswith("/git")


def _skip_git_global_options(tokens: list[str], index: int) -> int:
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            return index + 1
        if not token.startswith("-"):
            return index
        if token in GIT_OPTIONS_WITH_VALUES:
            index += 2
            continue
        if token.startswith(GIT_OPTIONS_WITH_VALUE_PREFIXES):
            index += 1
            continue
        index += 1
    return index


def _command_deletes_stash(command: str) -> bool:
    try:
        tokens = shlex.split(command)
    except ValueError:
        return bool(FALLBACK_BLOCK_RE.search(command))

    for index, token in enumerate(tokens):
        if not _is_git_token(token):
            continue
        subcommand_index = _skip_git_global_options(tokens, index + 1)
        if subcommand_index >= len(tokens) or tokens[subcommand_index] != "stash":
            continue
        stash_command_index = subcommand_index + 1
        while stash_command_index < len(tokens) and tokens[stash_command_index].startswith("-"):
            stash_command_index += 1
        if (
            stash_command_index < len(tokens)
            and tokens[stash_command_index] in BLOCKED_STASH_COMMANDS
        ):
            return True
    return bool(FALLBACK_BLOCK_RE.search(command))


def _block() -> int:
    reason = (
        "git stash drop/clear is banned in this shared checkout. Stashes may belong "
        "to other agents; preserve them or ask the user."
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
    return 1


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
    if _command_deletes_stash(command):
        return _block()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
