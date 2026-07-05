"""End-to-end shell completion test for the installed scout-dev wrapper."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def test_scout_dev_maps_completion_to_wrapped_scout(tmp_path: Path) -> None:
    root_dir = Path(__file__).resolve().parents[3]
    bin_dir = tmp_path / "bin"
    fake_bin_dir = tmp_path / "fake-bin"
    completion_log = tmp_path / "completion.log"
    call_log = tmp_path / "calls.log"
    bin_dir.mkdir()
    fake_bin_dir.mkdir()
    _write_executable(
        fake_bin_dir / "uv",
        "\n".join(
            [
                "#!/usr/bin/env bash",
                "set -euo pipefail",
                'printf "uv %s\\n" "$*" >>"$SCOUT_DEV_CALL_LOG"',
                'printf "_SCOUT_COMPLETE=%s\\n" "${_SCOUT_COMPLETE:-}" '
                '>>"$SCOUT_DEV_COMPLETION_LOG"',
                'printf "_SCOUT_DEV_COMPLETE=%s\\n" "${_SCOUT_DEV_COMPLETE:-}" '
                '>>"$SCOUT_DEV_COMPLETION_LOG"',
                'printf "ATLAS_SCOUT_COMMAND_NAME=%s\\n" '
                '"${ATLAS_SCOUT_COMMAND_NAME:-}" >>"$SCOUT_DEV_COMPLETION_LOG"',
                "",
            ]
        ),
    )

    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{fake_bin_dir}:{env.get('PATH', '')}",
            "HOME": str(tmp_path / "home"),
            "SCOUT_DEV_CALL_LOG": str(call_log),
            "SCOUT_DEV_COMPLETION_LOG": str(completion_log),
        }
    )
    subprocess.run(
        ["bash", str(root_dir / "install-scout-dev.sh"), "--bin-dir", str(bin_dir)],
        check=True,
        env=env,
        text=True,
        capture_output=True,
    )

    run_env = env | {"_SCOUT_DEV_COMPLETE": "zsh_source"}
    subprocess.run(
        [str(bin_dir / "scout-dev")],
        check=True,
        env=run_env,
        text=True,
        capture_output=True,
    )

    assert call_log.read_text(encoding="utf-8").splitlines() == [
        f"uv run --project {root_dir / 'scout'} scout",
    ]
    assert completion_log.read_text(encoding="utf-8").splitlines() == [
        "_SCOUT_COMPLETE=zsh_source",
        "_SCOUT_DEV_COMPLETE=",
        "ATLAS_SCOUT_COMMAND_NAME=scout-dev",
    ]


def _write_executable(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)
