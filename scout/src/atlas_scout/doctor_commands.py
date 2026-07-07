"""Scout doctor command."""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING

import click

from atlas_scout.cli_context import console
from atlas_scout.diagnostics import run_doctor
from atlas_scout.diagnostics.output import print_doctor_report

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

# ---------------------------------------------------------------------------
# doctor command
# ---------------------------------------------------------------------------


@click.command("doctor")
@click.option(
    "--worker", "include_worker", is_flag=True, help="Include background worker readiness."
)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def doctor(ctx: click.Context, include_worker: bool, json_output: bool) -> None:
    """Check whether Scout is ready to run discovery and sync results."""
    config: ScoutConfig = ctx.obj["config"]
    report = run_doctor(config, include_worker=include_worker)
    if json_output:
        click.echo(report.to_json())
    else:
        print_doctor_report(console, report)
    sys.exit(report.exit_code)
