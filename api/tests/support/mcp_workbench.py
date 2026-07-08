"""Shared test helpers for MCP workbench handoff tests."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoverySyncInfo,
)

from atlas.platform.mcp.elicitation import CLIENT_CAPABILITIES_META_KEY


def _elicitation_meta() -> dict[str, Any]:
    return {CLIENT_CAPABILITIES_META_KEY: {"elicitation": {"form": {}}}}


class FakeWorkbenchContext:
    def __init__(
        self,
        *,
        action: str,
        content: object | None = None,
        form: bool = True,
        user_id: str | None = "user_1",
        org_id: str | None = "org_1",
    ) -> None:
        meta = _elicitation_meta() if form else {}
        auth_payload = {"sub": user_id, "org_id": org_id}
        self.request_context = SimpleNamespace(
            meta=meta,
            request=SimpleNamespace(state=SimpleNamespace(mcp_auth_payload=auth_payload)),
        )
        self.action = action
        self.content = content
        self.calls: list[dict[str, object]] = []

    async def elicit(self, *, message: str, schema: type[object]) -> object:
        self.calls.append({"message": message, "schema": schema})
        return SimpleNamespace(action=self.action, data=self.content)


class FakeWorkbenchContextWithBrokenMeta:
    @property
    def request_context(self) -> object:
        raise ValueError


class FakeWorkbenchContextWithBrokenRequest:
    class RequestContext:
        meta = _elicitation_meta()

        @property
        def request(self) -> object:
            raise ValueError

    request_context = RequestContext()


class FakeConnection:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def _accepting_context(content: object) -> FakeWorkbenchContext:
    return FakeWorkbenchContext(action="accept", content=content)


def _all_confirmation_content() -> SimpleNamespace:
    return SimpleNamespace(
        confirm_save=True,
        confirm_export=True,
        confirm_sync=True,
        confirm_create=True,
        confirm_watch=True,
        visibility="workspace",
        review_state="in_review",
        notification_preference="immediate",
        format="json",
        source_linkage_ack=True,
    )


def _scout_artifacts(local_run_id: str) -> DiscoveryRunArtifacts:
    return DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(
                location_query="Wichita, KS",
                state="KS",
                issue_areas=["worker_cooperatives"],
            ),
            status="completed",
            sync=DiscoverySyncInfo(local_run_id=local_run_id, sync_status="ready"),
        ),
        stats=DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=0,
            sources_processed=0,
            entries_extracted=0,
            entries_after_dedup=0,
            entries_confirmed=0,
        ),
        sources=[],
        ranked_entries=[],
    )
