"""Tests for shared agent file placement enforcement."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from types import ModuleType


REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _checker() -> ModuleType:
    return _load_module(
        "atlas_file_placement_under_test",
        REPO_ROOT / "scripts" / "check" / "file_placement.py",
    )


def _hook(
    payload: dict[str, object], *, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "check" / "agent_policy_hook.py"),
        ],
        cwd=cwd or REPO_ROOT,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )


def _violations_for(*paths: str) -> list[object]:
    return _checker().evaluate_paths(list(paths), repo_root=REPO_ROOT)


def _discovered_test_roots() -> tuple[Path, ...]:
    return _checker().discover_python_test_roots(REPO_ROOT)


def test_python_tests_cannot_live_directly_under_discovered_test_roots() -> None:
    roots = _discovered_test_roots()
    assert roots

    violations = _checker().evaluate_paths(
        [(root / "test_bad.py").as_posix() for root in roots],
        repo_root=REPO_ROOT,
    )

    assert len(violations) == len(roots)
    assert all("directly in" in violation.reason for violation in violations)


def test_nested_python_tests_and_root_support_files_are_allowed() -> None:
    roots = _discovered_test_roots()
    assert roots

    violations = _checker().evaluate_paths(
        [
            path
            for root in roots
            for path in (
                (root / "unit" / "test_ok.py").as_posix(),
                (root / "integration" / "test_ok.py").as_posix(),
                (root / "conftest.py").as_posix(),
                (root / "README.md").as_posix(),
            )
        ],
        repo_root=REPO_ROOT,
    )

    assert violations == []


def test_agent_hook_blocks_direct_write_to_root_python_test_file() -> None:
    target = (_discovered_test_roots()[0] / "test_handoff.py").as_posix()
    result = _hook(
        {
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "tool_input": {"file_path": target, "content": ""},
        }
    )

    assert result.returncode == 1
    response = json.loads(result.stdout)
    assert response["decision"] == "block"
    assert response["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert target in response["reason"]


def test_agent_hook_blocks_from_multiple_process_working_directories() -> None:
    target = (_discovered_test_roots()[0] / "test_handoff.py").as_posix()
    payload = {
        "hook_event_name": "PreToolUse",
        "tool_name": "Write",
        "tool_input": {"file_path": target, "content": ""},
    }

    for cwd in (REPO_ROOT, REPO_ROOT / "api"):
        result = _hook(payload, cwd=cwd)

        assert result.returncode == 1
        assert target in json.loads(result.stdout)["reason"]


def test_agent_hook_blocks_apply_patch_that_adds_root_python_test_file() -> None:
    target = (_discovered_test_roots()[0] / "test_handoff.py").as_posix()
    result = _hook(
        {
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": {
                "command": "apply_patch <<'PATCH'\n"
                "*** Begin Patch\n"
                f"*** Add File: {target}\n"
                "+def test_bad():\n"
                "+    pass\n"
                "*** End Patch\n"
                "PATCH\n",
            },
        }
    )

    assert result.returncode == 1
    assert target in json.loads(result.stdout)["reason"]


def test_agent_hook_allows_nested_python_test_file_patch() -> None:
    target = (_discovered_test_roots()[0] / "handoff" / "test_bundle.py").as_posix()
    result = _hook(
        {
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": {
                "command": "apply_patch <<'PATCH'\n"
                "*** Begin Patch\n"
                f"*** Add File: {target}\n"
                "+def test_ok():\n"
                "+    pass\n"
                "*** End Patch\n"
                "PATCH\n",
            },
        }
    )

    assert result.returncode == 0
    assert result.stdout == ""


def test_agent_hook_blocks_bypassing_or_deleting_git_guards() -> None:
    for command in ("git commit --no-verify", "git stash drop", "git stash clear"):
        result = _hook(
            {
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": command},
            }
        )

        assert result.returncode == 1
        assert json.loads(result.stdout)["decision"] == "block"


def test_agent_hook_stop_event_checks_changed_files() -> None:
    result = _hook(
        {
            "hook_event_name": "Stop",
            "tool_name": "Stop",
            "tool_input": {},
        }
    )

    assert result.returncode == 0
