#!/usr/bin/env python3
"""Shared Claude/Codex hook adapter for Atlas agent policy."""

from __future__ import annotations

import importlib.util
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable
    from types import ModuleType


class HookConfigurationError(RuntimeError):
    """Raised when the hook cannot load its shared policy checker."""


BLOCKED_COMMAND_MESSAGES = (
    ("--no-verify", "--no-verify is banned. Fix the underlying issue instead of skipping hooks."),
)
PATCH_PATH_RE = re.compile(r"^\*\*\* (?:Add|Update|Delete) File: (?P<path>.+)$", re.MULTILINE)
DIFF_PATH_RE = re.compile(r"^(?:---|\+\+\+) [ab]/(?P<path>.+)$", re.MULTILINE)
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


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_checker() -> ModuleType:
    checker_path = _repo_root() / "scripts" / "check" / "file_placement.py"
    spec = importlib.util.spec_from_file_location("atlas_file_placement", checker_path)
    if spec is None or spec.loader is None:
        raise HookConfigurationError
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _hook_response(reason: str) -> str:
    return json.dumps(
        {
            "decision": "block",
            "reason": reason,
            "hookSpecificOutput": {"permissionDecision": "deny"},
            "systemMessage": reason,
        },
        separators=(",", ":"),
    )


def _block(reason: str) -> int:
    print(_hook_response(reason))
    return 1


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
        return bool(re.search(r"(^|[\s;&|()])git\s+stash\s+(drop|clear)(\s|$)", command))

    for index, token in enumerate(tokens):
        if not _is_git_token(token):
            continue
        subcommand_index = _skip_git_global_options(tokens, index + 1)
        if subcommand_index >= len(tokens) or tokens[subcommand_index] != "stash":
            continue
        stash_command_index = subcommand_index + 1
        while stash_command_index < len(tokens) and tokens[stash_command_index].startswith("-"):
            stash_command_index += 1
        if stash_command_index < len(tokens) and tokens[stash_command_index] in {"drop", "clear"}:
            return True
    return False


def _blocked_command_reason(command: str) -> str | None:
    for blocked_text, reason in BLOCKED_COMMAND_MESSAGES:
        if blocked_text in command:
            return reason
    if _command_deletes_stash(command):
        return (
            "git stash drop/clear is banned in this shared checkout. Stashes may belong "
            "to other agents; preserve them or ask the user."
        )
    return None


def _strings_from_value(value: object) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                yield item


def _extract_paths_from_text(text: str) -> list[str]:
    paths = [match.group("path").strip() for match in PATCH_PATH_RE.finditer(text)]
    paths.extend(match.group("path").strip() for match in DIFF_PATH_RE.finditer(text))
    return paths


def _extract_paths(tool_input: object) -> list[str]:
    if not isinstance(tool_input, dict):
        return []

    paths: list[str] = []
    for key in ("file_path", "path", "file_paths", "paths", "files"):
        paths.extend(_strings_from_value(tool_input.get(key)))

    for key in ("command", "content", "patch", "input"):
        value = tool_input.get(key)
        if isinstance(value, str):
            paths.extend(_extract_paths_from_text(value))

    return paths


def _run_changed_file_check() -> list[object]:
    checker = _load_checker()
    try:
        paths = checker.collect_paths(
            argparse_like(paths=[], staged=False, changed=True, tracked=False),
            root=_repo_root(),
        )
    except subprocess.CalledProcessError:
        return []
    return checker.evaluate_paths(paths, repo_root=_repo_root(), require_exists=True)


def argparse_like(**kwargs: object) -> object:
    return type("Args", (), kwargs)()


def _violations_for_paths(paths: list[str]) -> list[object]:
    if not paths:
        return []
    checker = _load_checker()
    return checker.evaluate_paths(paths, repo_root=_repo_root())


def _format_violation_reason(violations: list[object]) -> str:
    first = violations[0]
    path = getattr(first, "path", "unknown path")
    reason = getattr(first, "reason", "file placement policy violation")
    if len(violations) == 1:
        return f"{path}: {reason}"
    return f"{path}: {reason} ({len(violations)} total file placement violations)"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    event = payload.get("hook_event_name")
    tool_input = payload.get("tool_input")

    if isinstance(tool_input, dict):
        command = tool_input.get("command")
        if isinstance(command, str):
            reason = _blocked_command_reason(command)
            if reason is not None:
                return _block(reason)

    if event == "PreToolUse":
        violations = _violations_for_paths(_extract_paths(tool_input))
        if violations:
            return _block(_format_violation_reason(violations))
        return 0

    if event in {"PostToolUse", "Stop"}:
        violations = _run_changed_file_check()
        if violations:
            return _block(_format_violation_reason(violations))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
