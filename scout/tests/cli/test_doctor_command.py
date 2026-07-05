"""Scout doctor command tests."""

from __future__ import annotations

import json

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main
from atlas_scout.doctor import DoctorCapability, DoctorCheck, DoctorReport


def _report(*, failed: bool = False) -> DoctorReport:
    status = "fail" if failed else "warn"
    return DoctorReport(
        checks=(
            DoctorCheck(
                id="atlas-account",
                group="Atlas account",
                label="Account",
                status=status,
                message="Not logged in.",
                remediation="Run `scout login`.",
            ),
        ),
        capabilities=(
            DoctorCapability(
                id="direct-url-runs",
                label="Direct URL runs",
                ready=True,
                message="Ready.",
                remediation=None,
            ),
            DoctorCapability(
                id="atlas-sync",
                label="Atlas sync",
                ready=False,
                message="Not ready.",
                remediation="Run `scout login`.",
            ),
        ),
    )


def test_doctor_command_renders_grouped_output(monkeypatch) -> None:
    """Human doctor output should be grouped and action-oriented."""
    monkeypatch.setattr(cli_module, "run_doctor", lambda *_args, **_kwargs: _report())

    result = CliRunner().invoke(main, ["doctor"])

    assert result.exit_code == 0
    assert "Scout readiness" in result.output
    assert "Atlas account" in result.output
    assert "Ready for" in result.output
    assert "Direct URL runs" in result.output
    assert "Run `scout login`" in result.output


def test_doctor_command_outputs_json(monkeypatch) -> None:
    """JSON doctor output should be stable enough for automation."""
    monkeypatch.setattr(cli_module, "run_doctor", lambda *_args, **_kwargs: _report())

    result = CliRunner().invoke(main, ["doctor", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["checks"][0]["id"] == "atlas-account"
    assert payload["capabilities"][0]["id"] == "direct-url-runs"


def test_doctor_failure_exits_nonzero(monkeypatch) -> None:
    """Hard readiness failures should produce a failing command exit."""
    monkeypatch.setattr(cli_module, "run_doctor", lambda *_args, **_kwargs: _report(failed=True))

    result = CliRunner().invoke(main, ["doctor"])

    assert result.exit_code == 1


def test_doctor_worker_flag_requests_worker_checks(monkeypatch) -> None:
    """Worker readiness should only run when requested."""
    captured: dict[str, object] = {}

    def run_fake(*_args: object, **kwargs: object) -> DoctorReport:
        captured.update(kwargs)
        return _report()

    monkeypatch.setattr(cli_module, "run_doctor", run_fake)

    result = CliRunner().invoke(main, ["doctor", "--worker"])

    assert result.exit_code == 0
    assert captured["include_worker"] is True
