"""End-to-end tests for the installed scout-dev wrapper."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ScoutDevHarness:
    """Temporary scout-dev install with fake uv and scout executables."""

    root_dir: Path
    bin_dir: Path
    fake_bin_dir: Path
    home_dir: Path
    call_log: Path
    env_log: Path
    portless_ca_file: Path


def test_scout_dev_forwards_dev_atlas_url(tmp_path: Path) -> None:
    harness = _install_harness(tmp_path)

    _run_scout_dev(harness, "login", "--no-browser")
    _run_scout_dev(harness, "setup")
    _run_scout_dev(harness, "worker", "start", "--interval", "1")
    _run_scout_dev(harness, "worker", "run-internal", "--lease-seconds", "30")
    _run_scout_dev(harness, "doctor", "--json")
    _run_scout_dev(harness, "sync", "latest")
    _run_scout_dev(harness, "runs", "sync", "run-123", "--target", "public")
    _run_scout_dev(harness, "--config", "dev.toml", "login", "--no-browser")
    _run_scout_dev(
        harness,
        "login",
        "--no-browser",
        extra_env={"SCOUT_DEV_ATLAS_URL": "https://atlas.localhost:2468"},
    )
    _run_scout_dev(harness, "login", "--atlas-url", "http://custom.test", "--no-browser")
    _run_scout_dev(
        harness,
        "whoami",
        extra_env={"SCOUT_DEV_SCOUT_BIN": str(harness.fake_bin_dir / "scout")},
    )

    assert harness.call_log.read_text(encoding="utf-8").splitlines() == [
        f"uv run --project {harness.root_dir / 'scout'} scout login --atlas-url "
        "https://atlas.localhost --no-browser",
        f"uv run --project {harness.root_dir / 'scout'} scout setup --atlas-url "
        "https://atlas.localhost",
        f"uv run --project {harness.root_dir / 'scout'} scout worker start --atlas-url "
        "https://atlas.localhost --interval 1",
        f"uv run --project {harness.root_dir / 'scout'} scout worker run-internal --atlas-url "
        "https://atlas.localhost --lease-seconds 30",
        f"uv run --project {harness.root_dir / 'scout'} scout doctor --atlas-url "
        "https://atlas.localhost --json",
        f"uv run --project {harness.root_dir / 'scout'} scout sync --atlas-url "
        "https://atlas.localhost latest",
        f"uv run --project {harness.root_dir / 'scout'} scout runs sync --atlas-url "
        "https://atlas.localhost run-123 --target public",
        f"uv run --project {harness.root_dir / 'scout'} scout --config dev.toml login --atlas-url "
        "https://atlas.localhost --no-browser",
        f"uv run --project {harness.root_dir / 'scout'} scout login --atlas-url "
        "https://atlas.localhost:2468 --no-browser",
        f"uv run --project {harness.root_dir / 'scout'} scout login --atlas-url "
        "http://custom.test --no-browser",
        "scout-bin whoami",
    ]


def test_scout_dev_sets_portless_ca_for_local_https(tmp_path: Path) -> None:
    harness = _install_harness(tmp_path)

    _run_scout_dev(harness, "login", "--no-browser")
    _run_scout_dev(
        harness,
        "login",
        "--no-browser",
        extra_env={"SSL_CERT_FILE": "/custom/ca.pem"},
    )
    _run_scout_dev(
        harness,
        "login",
        "--no-browser",
        extra_env={"REQUESTS_CA_BUNDLE": "/custom/requests.pem"},
    )
    _run_scout_dev(harness, "login", "--atlas-url", "http://custom.test", "--no-browser")

    assert harness.env_log.read_text(encoding="utf-8").splitlines() == [
        f"SSL_CERT_FILE={harness.portless_ca_file}",
        "SSL_CERT_FILE=/custom/ca.pem",
        f"SSL_CERT_FILE={harness.portless_ca_file}",
        "SSL_CERT_FILE=",
    ]


def test_scout_dev_uninstaller_removes_managed_wrapper(tmp_path: Path) -> None:
    harness = _install_harness(tmp_path)
    target = harness.bin_dir / "scout-dev"

    _run(
        [
            "bash",
            str(harness.root_dir / "uninstall-scout-dev.sh"),
            "--bin-dir",
            str(harness.bin_dir),
        ],
        env=_base_env(harness),
    )

    assert not target.exists()


def test_scout_dev_uninstaller_refuses_unmanaged_wrapper(tmp_path: Path) -> None:
    harness = _install_harness(tmp_path)
    target = harness.bin_dir / "scout-dev"
    target.write_text("#!/usr/bin/env bash\necho unmanaged\n", encoding="utf-8")

    result = _run(
        [
            "bash",
            str(harness.root_dir / "uninstall-scout-dev.sh"),
            "--bin-dir",
            str(harness.bin_dir),
        ],
        env=_base_env(harness),
        check=False,
    )

    assert result.returncode == 1
    assert "not managed by Atlas" in result.stderr


def test_scout_dev_installer_supports_bin_dir_without_home(tmp_path: Path) -> None:
    root_dir = _repo_root()
    bin_dir = tmp_path / "no-home-bin"

    install_env = os.environ.copy()
    install_env.pop("HOME", None)
    _run(
        ["bash", str(root_dir / "install-scout-dev.sh"), "--bin-dir", str(bin_dir)],
        env=install_env,
    )

    assert (bin_dir / "scout-dev").is_file()

    _run(
        ["bash", str(root_dir / "uninstall-scout-dev.sh"), "--bin-dir", str(bin_dir)],
        env=install_env,
    )

    assert not (bin_dir / "scout-dev").exists()


def _install_harness(tmp_path: Path) -> ScoutDevHarness:
    root_dir = _repo_root()
    bin_dir = tmp_path / "bin"
    fake_bin_dir = tmp_path / "fake-bin"
    home_dir = tmp_path / "home"
    call_log = tmp_path / "scout-calls.log"
    env_log = tmp_path / "scout-env.log"
    portless_ca_file = home_dir / ".portless" / "ca.pem"
    bin_dir.mkdir()
    fake_bin_dir.mkdir()
    portless_ca_file.parent.mkdir(parents=True)
    portless_ca_file.touch()

    _write_executable(
        fake_bin_dir / "scout",
        "\n".join(
            [
                "#!/usr/bin/env bash",
                "set -euo pipefail",
                'printf "scout-bin %s\\n" "$*" >>"$SCOUT_DEV_CALL_LOG"',
                'printf "SSL_CERT_FILE=%s\\n" "${SSL_CERT_FILE:-}" >>"$SCOUT_DEV_ENV_LOG"',
                "",
            ]
        ),
    )
    _write_executable(
        fake_bin_dir / "uv",
        "\n".join(
            [
                "#!/usr/bin/env bash",
                "set -euo pipefail",
                'printf "uv %s\\n" "$*" >>"$SCOUT_DEV_CALL_LOG"',
                'printf "SSL_CERT_FILE=%s\\n" "${SSL_CERT_FILE:-}" >>"$SCOUT_DEV_ENV_LOG"',
                "",
            ]
        ),
    )

    harness = ScoutDevHarness(
        root_dir=root_dir,
        bin_dir=bin_dir,
        fake_bin_dir=fake_bin_dir,
        home_dir=home_dir,
        call_log=call_log,
        env_log=env_log,
        portless_ca_file=portless_ca_file,
    )
    _run(
        ["bash", str(root_dir / "install-scout-dev.sh"), "--bin-dir", str(bin_dir)],
        env=_base_env(harness),
    )

    assert (bin_dir / "scout-dev").is_file()
    return harness


def _run_scout_dev(
    harness: ScoutDevHarness,
    *args: str,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    env = _base_env(harness)
    if extra_env is not None:
        env.update(extra_env)
    return _run([str(harness.bin_dir / "scout-dev"), *args], env=env)


def _base_env(harness: ScoutDevHarness) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{harness.bin_dir}:{harness.fake_bin_dir}:{env.get('PATH', '')}",
            "HOME": str(harness.home_dir),
            "SCOUT_DEV_CALL_LOG": str(harness.call_log),
            "SCOUT_DEV_ENV_LOG": str(harness.env_log),
        }
    )
    return env


def _run(
    args: list[str],
    *,
    env: dict[str, str],
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=check, env=env, text=True, capture_output=True)


def _write_executable(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]
