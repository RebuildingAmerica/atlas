"""Default scoring threshold behavior for Scout pipeline runs."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest
from atlas_shared import PageContent

from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_default_threshold_saves_single_source_structured_entries(
    tmp_db_path: Path,
) -> None:
    """Default runs should persist ordinary source-backed entries."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    class StructuredFetcher:
        max_concurrent = 1

        def bind_run(self, _run_id: str) -> None:
            return None

        async def fetch_tracked_verbose(
            self,
            url: str,
            task_id: str,
            _store: object,
        ) -> dict[str, object]:
            return {
                "url": url,
                "task_id": task_id,
                "page": PageContent(
                    url="https://example.gov/candidates.csv",
                    text="\n".join(
                        [
                            "name,office,office_state,district,party,election_year,city,state",
                            '"DOE, JANE",House,CA,12,Democratic,2026,Los Angeles,CA',
                            '"SMITH, JOHN",Mayor,TX,,Independent,2026,Dallas,TX',
                        ]
                    ),
                    title="candidates.csv",
                    structured_data={"resource_format": "csv"},
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
            }

    provider = AsyncMock()
    provider.max_concurrent = 1
    provider.complete.return_value = Completion(text="[]")

    result = await run_pipeline(
        location="United States",
        issues=["electoral_reform"],
        provider=provider,
        store=store,
        direct_urls=["https://example.gov/candidates.csv"],
        fetcher=StructuredFetcher(),
        follow_links=False,
    )

    saved_entries = await store.list_entries(run_id=result.run_id)

    assert len(result.ranked_entries) == 2
    assert len(saved_entries) == 2

    await store.close()
