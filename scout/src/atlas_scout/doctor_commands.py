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

REQUIRABLE_CAPABILITY_IDS = (
    "direct-url-runs",
    "search-discovery",
    "atlas-sync",
    "seeded-worker-jobs",
    "search-worker-jobs",
)

# ---------------------------------------------------------------------------
# doctor command
# ---------------------------------------------------------------------------


@click.command("doctor")
@click.option(
    "--worker", "include_worker", is_flag=True, help="Include background worker readiness."
)
@click.option("--atlas-url", default=None, help="Atlas app URL to validate for sync.")
@click.option(
    "--require",
    "required_capability_ids",
    multiple=True,
    type=click.Choice(REQUIRABLE_CAPABILITY_IDS),
    help="Fail unless the named capability is ready. Repeat for multiple capabilities.",
)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def doctor(
    ctx: click.Context,
    include_worker: bool,
    atlas_url: str | None,
    required_capability_ids: tuple[str, ...],
    json_output: bool,
) -> None:
    """Check whether Scout is ready to run discovery and sync results."""
    config: ScoutConfig = ctx.obj["config"]
    report = run_doctor(config, include_worker=include_worker, atlas_url=atlas_url)
    exit_code = report.exit_code_for(required_capability_ids)
    if json_output:
        click.echo(report.to_json(exit_code=exit_code))
    else:
        print_doctor_report(console, report)
    sys.exit(exit_code)
