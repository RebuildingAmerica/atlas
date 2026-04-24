"""
Step 7: Contribute discovered entries to the Atlas API.

Pushes ranked entries that meet the minimum score threshold to the
Atlas REST API so discovery results flow into the public directory.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx
from atlas_shared import (
    DiscoveryContributionRequest,
    DiscoveryContributionResponse,
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunStats,
    DiscoveryRunSyncRequest,
    DiscoveryRunSyncResponse,
    PageContent,
)

if TYPE_CHECKING:
    from atlas_shared import RankedEntry

logger = logging.getLogger(__name__)

__all__ = ["ContributionResult", "contribute_entries"]


@dataclass(slots=True)
class ContributionResult:
    """Summary of a contribution batch."""

    attempted: int
    created: int
    failed: int
    errors: list[str]
    run_id: str | None = None
    sync_status: str | None = None
    duplicate: bool = False


async def contribute_entries(
    entries: list[RankedEntry],
    *,
    atlas_url: str,
    api_key: str,
    location_query: str,
    state: str,
    issue_areas: list[str],
    sources: list[PageContent],
    stats: DiscoveryRunStats,
    search_depth: str = "standard",
    min_score: float = 0.7,
) -> ContributionResult:
    """
    Push ranked entries to the Atlas API.

    Parameters
    ----------
    entries : list[RankedEntry]
        Ranked entries from the pipeline.
    atlas_url : str
        Base URL of the Atlas API (e.g., ``https://atlas.rebuildingus.org``).
    api_key : str
        API key for authentication.
    location_query : str
        Location query that defined the run.
    state : str
        2-letter state code for the run.
    issue_areas : list[str]
        Issue areas targeted by the run.
    sources : list[PageContent]
        Source pages fetched during the run.
    stats : DiscoveryRunStats
        Run statistics to persist alongside the contribution.
    search_depth : str
        Discovery depth hint used by the runner.
    min_score : float
        Minimum score threshold for contribution (default 0.7).

    Returns
    -------
    ContributionResult
        Summary of how many entries were created, skipped, or failed.
    """
    eligible = [e for e in entries if e.score >= min_score]
    if not eligible:
        return ContributionResult(attempted=0, created=0, failed=0, errors=[])

    url = f"{atlas_url.rstrip('/')}/api/discovery-runs/contributions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key

    payload = DiscoveryContributionRequest(
        run=DiscoveryRunInput(
            location_query=location_query,
            state=state,
            issue_areas=issue_areas,
            search_depth=search_depth,
        ),
        stats=stats,
        sources=sources,
        ranked_entries=eligible,
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                json=payload.model_dump(mode="json"),
                headers=headers,
            )
            response.raise_for_status()
            created_payload = DiscoveryContributionResponse.model_validate(response.json())
    except httpx.HTTPStatusError as exc:
        reason = f"contribution batch failed: HTTP {exc.response.status_code}"
        logger.warning("Contribution failed: %s", reason)
        return ContributionResult(attempted=len(eligible), created=0, failed=len(eligible), errors=[reason])
    except httpx.RequestError as exc:
        reason = f"contribution batch failed: {exc}"
        logger.warning("Contribution failed: %s", reason)
        return ContributionResult(attempted=len(eligible), created=0, failed=len(eligible), errors=[reason])

    created = created_payload.entries_persisted
    failed = max(len(eligible) - created, 0)
    return ContributionResult(attempted=len(eligible), created=created, failed=failed, errors=[])


async def sync_run_artifacts(
    artifacts: DiscoveryRunArtifacts,
    *,
    atlas_url: str,
    api_key: str,
) -> ContributionResult:
    """Sync a canonical local run bundle to the Atlas run-sync API."""
    url = f"{atlas_url.rstrip('/')}/api/discovery-runs/syncs"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key

    payload = DiscoveryRunSyncRequest(artifacts=artifacts)
    attempted = len(artifacts.ranked_entries)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                json=payload.model_dump(mode="json"),
                headers=headers,
            )
            response.raise_for_status()
            created_payload = DiscoveryRunSyncResponse.model_validate(response.json())
    except httpx.HTTPStatusError as exc:
        reason = f"run sync failed: HTTP {exc.response.status_code}"
        logger.warning("Run sync failed: %s", reason)
        return ContributionResult(attempted=attempted, created=0, failed=attempted, errors=[reason])
    except httpx.RequestError as exc:
        reason = f"run sync failed: {exc}"
        logger.warning("Run sync failed: %s", reason)
        return ContributionResult(attempted=attempted, created=0, failed=attempted, errors=[reason])

    created = created_payload.entries_persisted
    failed = 0 if created_payload.duplicate else max(attempted - created, 0)
    return ContributionResult(
        attempted=attempted,
        created=created,
        failed=failed,
        errors=[],
        run_id=created_payload.run_id,
        sync_status=created_payload.sync_status,
        duplicate=created_payload.duplicate,
    )
