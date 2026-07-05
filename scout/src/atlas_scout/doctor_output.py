"""Presentation helpers for Scout doctor."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

from rich.text import Text

if TYPE_CHECKING:
    from rich.console import Console

    from atlas_scout.doctor import DoctorCheck, DoctorReport, DoctorStatus

STATUS_LABELS: dict[DoctorStatus, str] = {
    "ok": "OK",
    "warn": "Needs attention",
    "fail": "Blocked",
}

STATUS_STYLES: dict[DoctorStatus, str] = {
    "ok": "green",
    "warn": "yellow",
    "fail": "red",
}


def print_doctor_report(console: Console, report: DoctorReport) -> None:
    """Render Scout readiness in grouped, action-oriented text."""
    console.print()
    console.print("[bold]Scout readiness[/]")

    for group, checks in _group_checks(report.checks).items():
        console.print()
        console.print(f"[bold]{group}[/]")
        for check in checks:
            status = _status_text(check.status)
            console.print(f"  {status}  {check.label}: {check.message}")
            if check.remediation:
                console.print(f"      {check.remediation}")

    ready = [capability for capability in report.capabilities if capability.ready]
    not_ready = [capability for capability in report.capabilities if not capability.ready]

    if ready:
        console.print()
        console.print("[bold]Ready for[/]")
        for capability in ready:
            console.print(f"  {capability.label}")

    if not_ready:
        console.print()
        console.print("[bold]Not ready for[/]")
        for capability in not_ready:
            console.print(f"  {capability.label}: {capability.message}")
            if capability.remediation:
                console.print(f"      {capability.remediation}")


def _group_checks(checks: tuple[DoctorCheck, ...]) -> dict[str, list[DoctorCheck]]:
    """Group checks while preserving the original group order."""
    grouped: dict[str, list[DoctorCheck]] = defaultdict(list)
    for check in checks:
        grouped[check.group].append(check)
    return dict(grouped)


def _status_text(status: DoctorStatus) -> Text:
    """Return a styled status label."""
    return Text(STATUS_LABELS[status], style=STATUS_STYLES[status])
