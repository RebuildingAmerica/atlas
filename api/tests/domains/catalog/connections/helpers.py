"""Shared helpers for catalog connection tests."""

from __future__ import annotations

from typing import Any

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.models.database import db as database


async def _make_person(
    conn: Any,
    name: str,
    *,
    city: str | None = None,
    state: str | None = None,
    org_id: str | None = None,
) -> str:
    return await EntryCRUD.create(
        conn,
        entry_type="person",
        name=name,
        description=f"{name} bio",
        city=city,
        state=state,
        geo_specificity="local",
        affiliated_org_id=org_id,
    )


async def _make_org(conn: Any, name: str) -> str:
    return await EntryCRUD.create(
        conn,
        entry_type="organization",
        name=name,
        description=f"{name} description",
        city=None,
        state=None,
        geo_specificity="regional",
    )


async def _co_mention(conn: Any, entry_ids: list[str], *, publication: str | None) -> str:
    source_id = database.generate_uuid()
    await conn.execute(
        "INSERT INTO sources (id, url, title, publication, type, extraction_method, "
        "ingested_at, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
        (
            source_id,
            f"https://example.com/{source_id}",
            "Shared Article",
            publication,
            "news_article",
            "manual",
        ),
    )
    for entry_id in entry_ids:
        await conn.execute(
            "INSERT INTO entry_sources (entry_id, source_id, created_at) "
            "VALUES (?, ?, datetime('now'))",
            (entry_id, source_id),
        )
    await conn.commit()
    return source_id


async def _tag_issue(conn: Any, entry_id: str, issue: str) -> None:
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) "
        "VALUES (?, ?, datetime('now'))",
        (entry_id, issue),
    )
    await conn.commit()


def _actor(result: Any, actor_id: str) -> Any:
    return next((a for a in result.actors if a.id == actor_id), None)
