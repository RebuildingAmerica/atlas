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


async def contribute_entries(
    entries: list[RankedEntry],
    *,
    atlas_url: str,
    api_key: str,
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

    url = f"{atlas_url.rstrip('/')}/api/v1/entries"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    import asyncio

    created = 0
    failed = 0
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=30.0) as client:

        async def _post_one(ranked: RankedEntry) -> tuple[bool, str]:
            entry = ranked.entry
            payload = {
                "type": str(entry.entry_type),
                "name": entry.name,
                "description": entry.description or "",
                "city": entry.city,
                "state": entry.state,
                "geo_specificity": str(entry.geo_specificity),
                "region": entry.region,
                "website": entry.website,
                "email": entry.email,
                "social_media": entry.social_media or {},
                "issue_areas": entry.issue_areas,
                "last_seen": entry.last_seen.isoformat() if entry.last_seen else None,
            }
            try:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                return True, ""
            except httpx.HTTPStatusError as exc:
                reason = f"{entry.name}: HTTP {exc.response.status_code}"
                logger.warning("Contribution failed for %s: %s", entry.name, reason)
                return False, reason
            except httpx.RequestError as exc:
                reason = f"{entry.name}: {exc}"
                logger.warning("Contribution failed for %s: %s", entry.name, reason)
                return False, reason

        results = await asyncio.gather(*[_post_one(r) for r in eligible])
        for success, reason in results:
            if success:
                created += 1
            else:
                failed += 1
                errors.append(reason)

    return ContributionResult(
        attempted=len(eligible),
        created=created,
        failed=failed,
        errors=errors,
    )
