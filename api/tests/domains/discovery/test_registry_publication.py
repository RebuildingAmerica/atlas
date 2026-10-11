"""Catalog writes and their retry receipts survive or roll back together."""

from __future__ import annotations

from datetime import date

import pytest
from atlas_shared import PageContent

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.resolution.mentions import (
    OrganizationMention,
    PersonMention,
    RoleMention,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD


async def _claim(conn) -> tuple[str, str]:
    run = await DiscoveryRunCRUD.create(
        conn, location_query="Las Vegas, NV", state="NV", issue_areas=["housing_affordability"]
    )
    job = await DiscoveryJobCRUD.create(conn, run_id=run)
    await DiscoveryJobCRUD.claim_next(conn, claimed_by="first")
    return run, job


def _organization() -> OrganizationMention:
    return OrganizationMention(
        name="Housing Trust",
        ein="111",
        city="Las Vegas",
        state="NV",
        website=None,
        source=PageContent(url="https://example.org/111", title="Registry"),
        context="Registered nonprofit 111.",
    )


def _person(organization: OrganizationMention) -> PersonMention:
    return PersonMention(
        name="Ana Ortiz",
        display_name="Ana Ortiz",
        organization=organization,
        role=RoleMention(
            relationship_type="board_member",
            evidence_label="Director",
            observed_on=date(2025, 12, 31),
            current=False,
        ),
        type_conflict=False,
        source=PageContent(url="https://example.org/111/filing", title="Return"),
        context="Ana Ortiz was a director.",
    )


@pytest.mark.asyncio
async def test_publication_replay_keeps_catalog_sources_and_curator_history(test_db) -> None:
    from atlas.domains.discovery.pipeline.registry_publication import publish_registry_mention
    from atlas.domains.moderation.review_queue import ReviewQueueCRUD

    run, job = await _claim(test_db)
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "issue_areas": ["housing_affordability"],
        "today": date(2026, 10, 10),
    }
    org = _organization()
    first = await publish_registry_mention(test_db, unit_key="org:0", mention=org, **args)
    person = await publish_registry_mention(
        test_db, unit_key="person:0", mention=_person(org), organization_unit_key="org:0", **args
    )
    assert first.published == 1
    assert person.held == {"no_current_role": 1}
    entry_id = person.entry_ids[0]
    pending = await ReviewQueueCRUD.list_pending(test_db)
    assert len(pending) == 1
    await test_db.execute(
        "UPDATE review_queue SET status = 'rejected' WHERE entity_id = ?", (entry_id,)
    )
    await EntryCRUD.update(test_db, entry_id, name="Curated Name")
    replay = await publish_registry_mention(
        test_db, unit_key="person:0", mention=_person(org), organization_unit_key="org:0", **args
    )
    assert replay == person
    assert (await EntryCRUD.get_by_id(test_db, entry_id)).name == "Curated Name"
    assert await ReviewQueueCRUD.list_pending(test_db) == []
    cursor = await test_db.execute("SELECT COUNT(*) FROM entries")
    assert (await cursor.fetchone())[0] == 2
    cursor = await test_db.execute("SELECT COUNT(*) FROM entry_sources")
    assert (await cursor.fetchone())[0] == 2


@pytest.mark.asyncio
async def test_failure_after_nested_commits_leaves_no_catalog_or_receipt(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import registry_publication as publication

    run, job = await _claim(test_db)
    original = publication._store_organization

    async def fail_after_writes(*args: object, **kwargs: object) -> str:
        await original(*args, **kwargs)
        msg = "interrupted before receipt"
        raise RuntimeError(msg)

    monkeypatch.setattr(publication, "_store_organization", fail_after_writes)
    with pytest.raises(RuntimeError, match="before receipt"):
        await publication.publish_registry_mention(
            test_db,
            job_id=job,
            claimed_by="first",
            run_id=run,
            unit_key="org:0",
            mention=_organization(),
            issue_areas=[],
            today=date(2026, 10, 10),
        )
    for table in ["entries", "sources", "entry_sources", "discovery_web_checkpoints"]:
        cursor = await test_db.execute(f"SELECT COUNT(*) FROM {table}")
        assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_commit_acknowledgement_loss_is_resolved_from_receipt(test_db, db_url) -> None:
    from atlas.domains.discovery.pipeline.registry_publication import publish_registry_mention
    from atlas.platform.database import get_db_connection

    run, job = await _claim(test_db)
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "unit_key": "org:0",
        "mention": _organization(),
        "issue_areas": [],
        "today": date(2026, 10, 10),
    }

    class LostAcknowledgement:
        execute = test_db.execute

        async def commit(self) -> None:
            await test_db.commit()
            msg = "acknowledgement lost"
            raise ConnectionError(msg)

    with pytest.raises(ConnectionError, match="acknowledgement"):
        await publish_registry_mention(LostAcknowledgement(), **args)
    conn = await get_db_connection(db_url)
    try:
        result = await publish_registry_mention(conn, **args)
        cursor = await conn.execute("SELECT id FROM entries")
        assert await cursor.fetchall() == [(result.entry_ids[0],)]
        assert result.published == 1
    finally:
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["mention", "issues", "date", "owner", "cancel"])
async def test_receipt_rejects_changed_evidence_or_inactive_owner(test_db, change) -> None:
    from dataclasses import replace

    from atlas.domains.discovery.pipeline.registry_publication import publish_registry_mention
    from atlas.domains.discovery.pipeline.web_checkpoints import (
        CheckpointInputsChangedError,
        CheckpointLeaseLostError,
    )

    run, job = await _claim(test_db)
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "unit_key": "org:0",
        "mention": _organization(),
        "issue_areas": [],
        "today": date(2026, 10, 10),
    }
    await publish_registry_mention(test_db, **args)
    if change == "mention":
        args["mention"] = replace(_organization(), name="Changed Name")
    elif change == "issues":
        args["issue_areas"] = ["housing_affordability"]
    elif change == "date":
        args["today"] = date(2026, 10, 11)
    elif change == "owner":
        args["claimed_by"] = "other"
    else:
        await DiscoveryJobCRUD.cancel(test_db, job)
    with pytest.raises((CheckpointInputsChangedError, CheckpointLeaseLostError)):
        await publish_registry_mention(test_db, **args)


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [True, False])
async def test_person_requires_matching_committed_organization(test_db, missing) -> None:
    from dataclasses import replace

    from atlas.domains.discovery.pipeline.registry_publication import publish_registry_mention
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointInputsChangedError

    run, job = await _claim(test_db)
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "issue_areas": [],
        "today": date(2026, 10, 10),
    }
    if not missing:
        await publish_registry_mention(
            test_db, unit_key="org:0", mention=replace(_organization(), ein="222"), **args
        )
    with pytest.raises((ValueError, CheckpointInputsChangedError)):
        await publish_registry_mention(
            test_db,
            unit_key="person:0",
            mention=_person(_organization()),
            organization_unit_key="org:0",
            **args,
        )
    cursor = await test_db.execute("SELECT COUNT(*) FROM entries WHERE type = 'person'")
    assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["key", "person", "organization"])
async def test_invalid_unit_dependencies_fail_before_writes(test_db, invalid) -> None:
    from atlas.domains.discovery.pipeline.registry_publication import publish_registry_mention

    run, job = await _claim(test_db)
    with pytest.raises(ValueError, match="organization key"):
        await publish_registry_mention(
            test_db,
            job_id=job,
            claimed_by="first",
            run_id=run,
            unit_key="" if invalid == "key" else "unit:0",
            mention=_person(_organization()) if invalid == "person" else _organization(),
            organization_unit_key="org:0" if invalid == "organization" else None,
            issue_areas=[],
            today=date(2026, 10, 10),
        )


@pytest.mark.asyncio
async def test_expiration_during_local_work_rolls_back_sources_and_catalog(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import registry_publication as publication
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError

    run, job = await _claim(test_db)
    original = publication._store_organization

    async def expire(*args: object, **kwargs: object) -> str:
        result = await original(*args, **kwargs)
        await test_db.execute(
            "UPDATE discovery_jobs SET claimed_until = '2000-01-01T00:00:00+00:00' WHERE id = ?",
            (job,),
        )
        return result

    monkeypatch.setattr(publication, "_store_organization", expire)
    with pytest.raises(CheckpointLeaseLostError):
        await publication.publish_registry_mention(
            test_db,
            job_id=job,
            claimed_by="first",
            run_id=run,
            unit_key="org:0",
            mention=_organization(),
            issue_areas=[],
            today=date(2026, 10, 10),
        )
    for table in ["entries", "sources", "discovery_web_checkpoints"]:
        cursor = await test_db.execute(f"SELECT COUNT(*) FROM {table}")
        assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_helper_cannot_end_the_enclosing_transaction(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import registry_publication as publication

    run, job = await _claim(test_db)

    async def rogue(conn: object, *_args: object) -> None:
        await conn.execute("COMMIT")

    monkeypatch.setattr(publication, "_store_organization", rogue)
    with pytest.raises(ValueError, match="enclosing transaction"):
        await publication.publish_registry_mention(
            test_db,
            job_id=job,
            claimed_by="first",
            run_id=run,
            unit_key="org:0",
            mention=_organization(),
            issue_areas=[],
            today=date(2026, 10, 10),
        )
    cursor = await test_db.execute("SELECT COUNT(*) FROM discovery_web_checkpoints")
    assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_competing_replays_serialize_and_do_not_duplicate_publication(
    test_db, db_url, monkeypatch
) -> None:
    import asyncio

    from atlas.domains.discovery.pipeline import registry_publication as publication
    from atlas.platform.database import get_db_connection

    run, job = await _claim(test_db)
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "unit_key": "org:0",
        "mention": _organization(),
        "issue_areas": [],
        "today": date(2026, 10, 10),
    }
    inside = asyncio.Event()
    release = asyncio.Event()
    original = publication._store_organization
    calls = 0

    async def hold(*args: object, **kwargs: object) -> str:
        nonlocal calls
        calls += 1
        result = await original(*args, **kwargs)
        inside.set()
        await release.wait()
        return result

    monkeypatch.setattr(publication, "_store_organization", hold)
    first = await get_db_connection(db_url)
    second = await get_db_connection(db_url)
    try:
        async with asyncio.timeout(5):
            task = asyncio.create_task(publication.publish_registry_mention(first, **args))
            await inside.wait()
            replay = asyncio.create_task(publication.publish_registry_mention(second, **args))
            release.set()
            first_result, second_result = await asyncio.gather(task, replay)
        assert first_result == second_result
        assert calls == 1
        cursor = await test_db.execute("SELECT COUNT(*) FROM entries")
        assert (await cursor.fetchone())[0] == 1
        cursor = await test_db.execute("SELECT COUNT(*) FROM discovery_web_checkpoints")
        assert (await cursor.fetchone())[0] == 1
    finally:
        release.set()
        await first.close()
        await second.close()
