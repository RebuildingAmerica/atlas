"""Registry checkpoints preserve research through owner replacement."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock

import pytest
from atlas_discovery_engine.registry import RegistryOrganization, RegistrySearchPage

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.pipeline.runner import DiscoveryPipelineJob
from atlas.models import DiscoveryRunCRUD
from atlas.platform.config import Settings


async def claim(conn) -> tuple[str, DiscoveryPipelineJob]:
    run = await DiscoveryRunCRUD.create(
        conn, location_query="Las Vegas, NV", state="NV", issue_areas=["housing_affordability"]
    )
    job_id = await DiscoveryJobCRUD.create(conn, run_id=run)
    await DiscoveryJobCRUD.claim_next(conn, claimed_by="owner-1")
    return job_id, DiscoveryPipelineJob(run, "Las Vegas, NV", "NV", ["housing_affordability"])


@pytest.mark.asyncio
async def test_registry_pages_resume_and_keep_first_ein_without_repeating_calls(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import registry_checkpoints as registry

    job_id, job = await claim(test_db)
    first = RegistryOrganization("Coalition", "Las Vegas", "NV", "111", "https://example.org/111")
    duplicate = RegistryOrganization("Other name", None, "NV", "111", "https://example.org/111")
    second = RegistryOrganization("Union", "Las Vegas", "NV", "222", "https://example.org/222")
    provider = AsyncMock()
    provider.search_page.side_effect = [
        RegistrySearchPage([first] * 25, True),
        RegistrySearchPage([duplicate, second], False),
    ]
    monkeypatch.setattr(registry.ProPublicaRegistryProvider, "search_page", provider.search_page)
    monkeypatch.setattr(registry, "registry_terms_for_issue", lambda _terms: ["housing"])
    settings = Settings(
        _env_file=None, discovery_registry_max_organizations=30, discovery_registry_max_people=0
    )
    args = {
        "job_id": job_id,
        "claimed_by": "owner-1",
        "job": job,
        "settings": settings,
        "today": date(2026, 10, 10),
    }
    assert await registry.advance_registry_discovery(test_db, **args) is None
    await test_db.execute(
        "UPDATE discovery_jobs SET claimed_by = 'owner-2' WHERE id = ?", (job_id,)
    )
    await test_db.commit()
    args["claimed_by"] = "owner-2"
    assert await registry.advance_registry_discovery(test_db, **args) is None
    result = await registry.advance_registry_discovery(test_db, **args)
    assert [(item.ein, item.name) for item in result.organizations] == [
        ("111", "Coalition"),
        ("222", "Union"),
    ]
    assert provider.search_page.await_count == 2
    assert await registry.advance_registry_discovery(test_db, **args) == result
    assert provider.search_page.await_count == 2


@pytest.mark.asyncio
async def test_filing_and_officer_units_rehydrate_dates_sources_and_roles(
    test_db, monkeypatch
) -> None:
    from dataclasses import replace

    from atlas_discovery_engine.filing_returns import FilingOfficer
    from atlas_discovery_engine.filings import OrganizationFiling

    from atlas.domains.discovery.pipeline import registry_checkpoints as registry
    from atlas.domains.discovery.resolution import register_mentions

    job_id, job = await claim(test_db)
    row = RegistryOrganization("Coalition", "Las Vegas", "NV", "111", "https://example.org/111")
    search = AsyncMock(return_value=RegistrySearchPage([row], False))
    monkeypatch.setattr(registry.ProPublicaRegistryProvider, "search_page", search)
    monkeypatch.setattr(registry, "registry_terms_for_issue", lambda _terms: ["housing"])
    monkeypatch.setattr(register_mentions, "_type_conflict", lambda officer: not officer.name)
    filing = OrganizationFiling(
        "111",
        "202510729349300100",
        (FilingOfficer("Ana Ortiz", "Chair"), FilingOfficer("Ben Lee", "Director")),
        return_type="990",
        tax_period_end=date(2025, 12, 31),
    )
    advance = AsyncMock(
        side_effect=lambda _provider, state: replace(state, filings=(filing,), done=True)
    )
    monkeypatch.setattr(registry, "advance_filing_lookup", advance)
    settings = Settings(
        _env_file=None, discovery_registry_max_organizations=1, discovery_registry_max_people=2
    )
    args = {
        "job_id": job_id,
        "claimed_by": "owner-1",
        "job": job,
        "settings": settings,
        "today": date(2026, 10, 10),
    }
    for _ in range(4):
        assert await registry.advance_registry_discovery(test_db, **args) is None
    result = await registry.advance_registry_discovery(test_db, **args)
    assert [person.name for person in result.people] == ["Ana Ortiz", "Ben Lee"]
    assert result.people[0].role.current
    assert result.people[0].role.observed_on == date(2025, 12, 31)
    assert result.people[0].source.url.endswith("/111/202510729349300100/full")
    assert "Chair" in result.people[0].context
    assert search.await_count == advance.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["cancel", "owner", "date", "budget"])
async def test_changed_owner_or_inputs_cannot_consume_next_registry_unit(
    test_db, monkeypatch, change
) -> None:
    from atlas.domains.discovery.pipeline import registry_checkpoints as registry
    from atlas.domains.discovery.pipeline.web_checkpoints import (
        CheckpointInputsChangedError,
        CheckpointLeaseLostError,
    )

    job_id, job = await claim(test_db)
    search = AsyncMock(return_value=RegistrySearchPage([], False))
    monkeypatch.setattr(registry.ProPublicaRegistryProvider, "search_page", search)
    monkeypatch.setattr(registry, "registry_terms_for_issue", lambda _terms: ["housing", "homes"])
    settings = Settings(
        _env_file=None, discovery_registry_max_organizations=1, discovery_registry_max_people=0
    )
    args = {
        "job_id": job_id,
        "claimed_by": "owner-1",
        "job": job,
        "settings": settings,
        "today": date(2026, 10, 10),
    }
    await registry.advance_registry_discovery(test_db, **args)
    if change == "cancel":
        await DiscoveryJobCRUD.cancel(test_db, job_id)
    elif change == "owner":
        args["claimed_by"] = "owner-2"
    elif change == "date":
        args["today"] = date(2026, 10, 11)
    else:
        args["settings"] = settings.model_copy(update={"discovery_registry_max_people": 2})
    with pytest.raises((CheckpointInputsChangedError, CheckpointLeaseLostError)):
        await registry.advance_registry_discovery(test_db, **args)
    assert search.await_count == 1


@pytest.mark.asyncio
async def test_cancellation_during_provider_does_not_commit_evidence(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import registry_checkpoints as registry
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError

    job_id, job = await claim(test_db)

    async def search(*_args: object, **_kwargs: object) -> RegistrySearchPage:
        await DiscoveryJobCRUD.cancel(test_db, job_id)
        return RegistrySearchPage([], False)

    monkeypatch.setattr(registry.ProPublicaRegistryProvider, "search_page", search)
    settings = Settings(
        _env_file=None, discovery_registry_max_organizations=1, discovery_registry_max_people=0
    )
    with pytest.raises(CheckpointLeaseLostError):
        await registry.advance_registry_discovery(
            test_db,
            job_id=job_id,
            claimed_by="owner-1",
            job=job,
            settings=settings,
            today=date(2026, 10, 10),
        )
    cursor = await test_db.execute(
        "SELECT COUNT(*) FROM discovery_web_checkpoints WHERE job_id = ?", (job_id,)
    )
    assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_reopened_connections_resume_filing_progress_and_skip_nonpeople(
    test_db, db_url, monkeypatch
) -> None:
    from dataclasses import replace

    from atlas_discovery_engine.filing_returns import FilingOfficer, NameField
    from atlas_discovery_engine.filings import OrganizationFiling

    from atlas.domains.discovery.pipeline import registry_checkpoints as registry
    from atlas.domains.discovery.resolution import register_mentions
    from atlas.platform.database import get_db_connection

    job_id, job = await claim(test_db)
    rows = [
        RegistryOrganization("", None, "NV", "", "https://example.org/empty"),
        RegistryOrganization("Coalition", None, "NV", "111", "https://example.org/111"),
    ]
    search = AsyncMock(return_value=RegistrySearchPage(rows, False))
    monkeypatch.setattr(registry.ProPublicaRegistryProvider, "search_page", search)
    monkeypatch.setattr(registry, "registry_terms_for_issue", lambda _terms: ["housing"])
    monkeypatch.setattr(register_mentions, "_type_conflict", lambda officer: not officer.name)
    filing = OrganizationFiling(
        "111",
        "202510729349300100",
        (
            FilingOfficer("Trust Bank", "Trustee", name_field=NameField.BUSINESS),
            FilingOfficer("Ana Ortiz", "Chair"),
        ),
    )

    async def advance(_provider: object, state: object) -> object:
        if state.archives is None:
            return replace(state, archives={"2025": ["https://example.org/archive"]})
        assert state.archives == {"2025": ["https://example.org/archive"]}
        return replace(state, filings=(filing,), done=True)

    progress = AsyncMock(side_effect=advance)
    monkeypatch.setattr(registry, "advance_filing_lookup", progress)
    settings = Settings(
        _env_file=None, discovery_registry_max_organizations=2, discovery_registry_max_people=3
    )
    result = None
    for _ in range(10):
        conn = await get_db_connection(db_url)
        try:
            result = await registry.advance_registry_discovery(
                conn,
                job_id=job_id,
                claimed_by="owner-1",
                job=job,
                settings=settings,
                today=date(2026, 10, 10),
            )
        finally:
            await conn.close()
        if result is not None:
            break
    assert result is not None
    assert [person.name for person in result.people] == ["Ana Ortiz"]
    assert [org.ein for org in result.organizations] == ["111"]
    assert search.await_count == 1
    assert progress.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("zero_budget", [True, False])
async def test_empty_plan_finishes_without_network_and_freezes_inputs(
    test_db, monkeypatch, zero_budget
) -> None:
    from atlas.domains.discovery.pipeline import registry_checkpoints as registry
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointInputsChangedError

    job_id, job = await claim(test_db)
    search = AsyncMock(side_effect=AssertionError("unexpected network"))
    monkeypatch.setattr(registry.ProPublicaRegistryProvider, "search_page", search)
    monkeypatch.setattr(
        registry, "registry_terms_for_issue", lambda _terms: ["housing"] if zero_budget else []
    )
    settings = Settings(
        _env_file=None, discovery_registry_max_organizations=0 if zero_budget else 5
    )
    result = await registry.advance_registry_discovery(
        test_db,
        job_id=job_id,
        claimed_by="owner-1",
        job=job,
        settings=settings,
        today=date(2026, 10, 10),
    )
    assert result is not None
    assert result.mention_count == 0
    search.assert_not_awaited()
    with pytest.raises(CheckpointInputsChangedError):
        await registry.advance_registry_discovery(
            test_db,
            job_id=job_id,
            claimed_by="owner-1",
            job=job,
            settings=settings,
            today=date(2026, 10, 11),
        )


@pytest.mark.asyncio
async def test_timeout_retries_only_unfinished_page(test_db, monkeypatch) -> None:
    import asyncio

    from atlas.domains.discovery.pipeline import registry_checkpoints as registry

    job_id, job = await claim(test_db)
    row = RegistryOrganization("Coalition", None, "NV", "111", "https://example.org/111")
    search = AsyncMock(return_value=RegistrySearchPage([row] * 25, True))
    monkeypatch.setattr(registry.ProPublicaRegistryProvider, "search_page", search)
    monkeypatch.setattr(registry, "registry_terms_for_issue", lambda _terms: ["housing"])
    settings = Settings(
        _env_file=None, discovery_registry_max_organizations=30, discovery_registry_max_people=0
    )
    args = {
        "job_id": job_id,
        "claimed_by": "owner-1",
        "job": job,
        "settings": settings,
        "today": date(2026, 10, 10),
    }
    await registry.advance_registry_discovery(test_db, **args)

    async def stuck(*_args: object, **_kwargs: object) -> None:
        await asyncio.Event().wait()

    search.side_effect = stuck
    monkeypatch.setattr(registry, "_UNIT_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(TimeoutError):
        await registry.advance_registry_discovery(test_db, **args)
    search.side_effect = None
    search.return_value = RegistrySearchPage([], False)
    await registry.advance_registry_discovery(test_db, **args)
    result = await registry.advance_registry_discovery(test_db, **args)
    assert [org.ein for org in result.organizations] == ["111"]
    assert [call.kwargs["page"] for call in search.await_args_list] == [0, 1, 1]


@pytest.mark.asyncio
async def test_raw_officer_budget_stops_next_hundred_organization_batch(
    test_db, monkeypatch
) -> None:
    from dataclasses import replace

    from atlas_discovery_engine.filing_returns import FilingOfficer, NameField
    from atlas_discovery_engine.filings import OrganizationFiling

    from atlas.domains.discovery.pipeline import registry_checkpoints as registry

    job_id, job = await claim(test_db)
    rows = [
        RegistryOrganization(
            f"Coalition {index}", None, "NV", str(index), f"https://example.org/{index}"
        )
        for index in range(101)
    ]
    search = AsyncMock(
        side_effect=[
            RegistrySearchPage(rows[start : start + 25], start < 100) for start in range(0, 101, 25)
        ]
    )
    monkeypatch.setattr(registry.ProPublicaRegistryProvider, "search_page", search)
    monkeypatch.setattr(registry, "registry_terms_for_issue", lambda _terms: ["housing"])
    filing = OrganizationFiling(
        "0",
        "202510729349300100",
        (FilingOfficer("Trust Bank", "Trustee", name_field=NameField.BUSINESS),),
    )
    progress = AsyncMock(
        side_effect=lambda _provider, state: replace(state, filings=(filing,), done=True)
    )
    monkeypatch.setattr(registry, "advance_filing_lookup", progress)
    settings = Settings(
        _env_file=None, discovery_registry_max_organizations=101, discovery_registry_max_people=1
    )
    result = None
    for _ in range(10):
        result = await registry.advance_registry_discovery(
            test_db,
            job_id=job_id,
            claimed_by="owner-1",
            job=job,
            settings=settings,
            today=date(2026, 10, 10),
        )
        if result is not None:
            break
    assert result is not None
    assert len(result.organizations) == 101
    assert result.people == []
    assert search.await_count == 5
    assert progress.await_count == 1
    assert progress.await_args.args[1].eins == tuple(str(index) for index in range(100))
