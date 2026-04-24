"""Seed launch-ready public profile data into the Atlas catalog."""

from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING

from atlas.models import EntryCRUD, SourceCRUD, get_db_connection, init_db
from atlas.models.database import db

if TYPE_CHECKING:
    import aiosqlite


@dataclass(frozen=True)
class SeedSource:
    url: str
    title: str
    publication: str
    published_date: date
    source_type: str
    extraction_context: str


@dataclass(frozen=True)
class SeedEntry:
    slug: str
    entry_type: str
    name: str
    description: str
    city: str | None
    state: str | None
    region: str | None
    geo_specificity: str
    website: str | None
    email: str | None
    phone: str | None
    social_media: dict[str, str] | None
    affiliated_org_slug: str | None
    verified: bool
    last_verified: date | None
    first_seen: date
    last_seen: date
    issue_areas: tuple[str, ...]
    sources: tuple[SeedSource, ...]


SEED_ENTRIES: tuple[SeedEntry, ...] = (
    SeedEntry(
        slug="eastside-housing-network",
        entry_type="organization",
        name="Eastside Housing Network",
        description="Tenant defense coalition coordinating housing clinics, eviction monitoring, and neighborhood action across Detroit neighborhoods.",
        city="Detroit",
        state="MI",
        region=None,
        geo_specificity="local",
        website="https://example.org/eastside-housing-network",
        email="hello@eastsidehousingnetwork.example.org",
        phone="313-555-0112",
        social_media={"instagram": "@eastsidehousingnetwork"},
        affiliated_org_slug=None,
        verified=True,
        last_verified=date(2026, 4, 19),
        first_seen=date(2026, 3, 1),
        last_seen=date(2026, 4, 19),
        issue_areas=("housing_affordability", "homelessness_and_housing_insecurity"),
        sources=(
            SeedSource(
                url="https://example.org/eastside-housing-network/about",
                title="About Eastside Housing Network",
                publication="Eastside Housing Network",
                published_date=date(2026, 4, 19),
                source_type="org_website",
                extraction_context="The coalition runs tenant clinics, eviction monitoring, and neighborhood action meetings across Detroit.",
            ),
            SeedSource(
                url="https://detroitledger.example.com/tenant-clinics-expand",
                title="Detroit tenant clinics expand eastside coverage",
                publication="Detroit Ledger",
                published_date=date(2026, 4, 16),
                source_type="news_article",
                extraction_context="Eastside Housing Network expanded weekly tenant clinics and legal referrals in Detroit.",
            ),
            SeedSource(
                url="https://greatlakeshousingwatch.example.com/maya-thompson-eastside-housing-network",
                title="Maya Thompson and Eastside Housing Network organize block-by-block",
                publication="Great Lakes Housing Watch",
                published_date=date(2026, 4, 18),
                source_type="news_article",
                extraction_context="Maya Thompson and Eastside Housing Network linked tenant unions, legal clinics, and neighborhood councils across Detroit.",
            ),
        ),
    ),
    SeedEntry(
        slug="sun-valley-worker-center",
        entry_type="organization",
        name="Sun Valley Worker Center",
        description="Regional labor organization connecting wage-theft defense, immigration support, training, and direct worker advocacy across Phoenix.",
        city="Phoenix",
        state="AZ",
        region="Phoenix metro",
        geo_specificity="regional",
        website="https://example.org/sun-valley-worker-center",
        email="contact@sunvalleyworkercenter.example.org",
        phone="602-555-0144",
        social_media={"instagram": "@sunvalleyworkers"},
        affiliated_org_slug=None,
        verified=False,
        last_verified=None,
        first_seen=date(2026, 3, 5),
        last_seen=date(2026, 4, 16),
        issue_areas=("wage_theft_and_labor_rights", "immigration_and_belonging"),
        sources=(
            SeedSource(
                url="https://example.org/sun-valley-worker-center/programs",
                title="Sun Valley Worker Center programs",
                publication="Sun Valley Worker Center",
                published_date=date(2026, 4, 16),
                source_type="org_website",
                extraction_context="The worker center combines wage-theft defense, training, and direct support for immigrant workers across Phoenix.",
            ),
            SeedSource(
                url="https://phoenixcivicreport.example.com/warehouse-workers-defense-network",
                title="Phoenix warehouse workers build a stronger defense network",
                publication="Phoenix Civic Report",
                published_date=date(2026, 4, 14),
                source_type="news_article",
                extraction_context="Sun Valley Worker Center coordinated wage-theft defense and organizing training for hospitality and warehouse workers.",
            ),
            SeedSource(
                url="https://desertlaborjournal.example.com/luis-alvarez-sun-valley-worker-center",
                title="Luis Alvarez helps Phoenix workers organize across industries",
                publication="Desert Labor Journal",
                published_date=date(2026, 4, 13),
                source_type="news_article",
                extraction_context="Luis Alvarez worked with Sun Valley Worker Center to support immigrant workers facing wage theft and retaliation.",
            ),
        ),
    ),
    SeedEntry(
        slug="great-lakes-civic-lab",
        entry_type="organization",
        name="Great Lakes Civic Lab",
        description="Election and community-engagement lab supporting civic data, public-interest tools, and turnout work in Milwaukee and across Wisconsin.",
        city="Milwaukee",
        state="WI",
        region="Greater Milwaukee",
        geo_specificity="regional",
        website="https://example.org/great-lakes-civic-lab",
        email="team@greatlakesciviclab.example.org",
        phone="414-555-0198",
        social_media={"instagram": "@greatlakesciviclab"},
        affiliated_org_slug=None,
        verified=True,
        last_verified=date(2026, 4, 13),
        first_seen=date(2026, 3, 8),
        last_seen=date(2026, 4, 13),
        issue_areas=(
            "voter_suppression_and_electoral_access",
            "local_government_and_civic_engagement",
        ),
        sources=(
            SeedSource(
                url="https://example.org/great-lakes-civic-lab/tools",
                title="Great Lakes Civic Lab tools and programs",
                publication="Great Lakes Civic Lab",
                published_date=date(2026, 4, 13),
                source_type="org_website",
                extraction_context="Great Lakes Civic Lab publishes civic-data tools and turnout resources for Milwaukee organizers.",
            ),
            SeedSource(
                url="https://milwaukeecitydesk.example.com/civic-lab-turnout-dashboard",
                title="Milwaukee civic lab launches turnout dashboard",
                publication="Milwaukee City Desk",
                published_date=date(2026, 4, 12),
                source_type="news_article",
                extraction_context="Great Lakes Civic Lab launched a turnout dashboard focused on election access and volunteer coordination.",
            ),
            SeedSource(
                url="https://midwestdemocracyreview.example.com/aisha-patel-great-lakes-civic-lab",
                title="Aisha Patel documents election access work in Milwaukee",
                publication="Midwest Democracy Review",
                published_date=date(2026, 4, 11),
                source_type="government_record",
                extraction_context="Aisha Patel and Great Lakes Civic Lab documented local election-access efforts and volunteer networks in Milwaukee.",
            ),
        ),
    ),
    SeedEntry(
        slug="river-county-clean-transit-coalition",
        entry_type="organization",
        name="River County Clean Transit Coalition",
        description="Regional coalition pushing electrified bus systems, safer streets, and equitable transit investment across Minneapolis and nearby suburbs.",
        city="Minneapolis",
        state="MN",
        region="Twin Cities",
        geo_specificity="regional",
        website="https://example.org/river-county-clean-transit",
        email="hello@rivercountytransit.example.org",
        phone="612-555-0131",
        social_media={"instagram": "@rivercountytransit"},
        affiliated_org_slug=None,
        verified=False,
        last_verified=None,
        first_seen=date(2026, 3, 11),
        last_seen=date(2026, 4, 11),
        issue_areas=("public_transit", "climate_adaptation_and_resilience"),
        sources=(
            SeedSource(
                url="https://example.org/river-county-clean-transit/campaigns",
                title="River County Clean Transit Coalition campaigns",
                publication="River County Clean Transit Coalition",
                published_date=date(2026, 4, 11),
                source_type="org_website",
                extraction_context="The coalition is campaigning for electrified buses, safer streets, and equitable transit investment.",
            ),
            SeedSource(
                url="https://northstartransportnews.example.com/clean-transit-coalition-pushes-electrification",
                title="Transit coalition pushes electrification and safer streets",
                publication="North Star Transport News",
                published_date=date(2026, 4, 10),
                source_type="news_article",
                extraction_context="River County Clean Transit Coalition pressed local leaders to accelerate bus electrification and safer-street investments.",
            ),
            SeedSource(
                url="https://uppermidwestclimatemonitor.example.com/jordan-kim-river-county-clean-transit",
                title="Jordan Kim links climate resilience and mobility campaigns",
                publication="Upper Midwest Climate Monitor",
                published_date=date(2026, 4, 9),
                source_type="report",
                extraction_context="Jordan Kim worked with River County Clean Transit Coalition on climate and mobility campaigns across Minneapolis.",
            ),
        ),
    ),
    SeedEntry(
        slug="maya-thompson",
        entry_type="person",
        name="Maya Thompson",
        description="Housing organizer connecting tenant unions, legal clinics, and neighborhood councils across Detroit.",
        city="Detroit",
        state="MI",
        region=None,
        geo_specificity="local",
        website=None,
        email="maya@eastsidehousingnetwork.example.org",
        phone=None,
        social_media=None,
        affiliated_org_slug="eastside-housing-network",
        verified=True,
        last_verified=date(2026, 4, 18),
        first_seen=date(2026, 3, 2),
        last_seen=date(2026, 4, 18),
        issue_areas=("housing_affordability", "homelessness_and_housing_insecurity"),
        sources=(
            SeedSource(
                url="https://greatlakeshousingwatch.example.com/maya-thompson-eastside-housing-network",
                title="Maya Thompson and Eastside Housing Network organize block-by-block",
                publication="Great Lakes Housing Watch",
                published_date=date(2026, 4, 18),
                source_type="news_article",
                extraction_context="Maya Thompson linked tenant unions, legal clinics, and neighborhood councils across Detroit.",
            ),
            SeedSource(
                url="https://detroitcommunityvoice.example.com/maya-thompson-tenant-unions",
                title="Tenant unions turn to Maya Thompson for coalition strategy",
                publication="Detroit Community Voice",
                published_date=date(2026, 4, 12),
                source_type="news_article",
                extraction_context="Maya Thompson helped neighborhood tenant unions coordinate legal referrals and block-level organizing.",
            ),
        ),
    ),
    SeedEntry(
        slug="luis-alvarez",
        entry_type="person",
        name="Luis Alvarez",
        description="Worker center strategist helping hospitality and warehouse workers organize across Phoenix.",
        city="Phoenix",
        state="AZ",
        region=None,
        geo_specificity="local",
        website=None,
        email="luis@sunvalleyworkercenter.example.org",
        phone="602-555-0179",
        social_media=None,
        affiliated_org_slug="sun-valley-worker-center",
        verified=False,
        last_verified=None,
        first_seen=date(2026, 3, 4),
        last_seen=date(2026, 4, 14),
        issue_areas=("wage_theft_and_labor_rights", "immigration_and_belonging"),
        sources=(
            SeedSource(
                url="https://desertlaborjournal.example.com/luis-alvarez-sun-valley-worker-center",
                title="Luis Alvarez helps Phoenix workers organize across industries",
                publication="Desert Labor Journal",
                published_date=date(2026, 4, 13),
                source_type="news_article",
                extraction_context="Luis Alvarez supported immigrant workers facing wage theft and retaliation in Phoenix.",
            ),
            SeedSource(
                url="https://phoenixwarehousebeat.example.com/luis-alvarez-worker-defense-hotline",
                title="Worker defense hotline expands with Luis Alvarez",
                publication="Phoenix Warehouse Beat",
                published_date=date(2026, 4, 14),
                source_type="podcast",
                extraction_context="Luis Alvarez described how the worker center connects warehouse workers to organizing support and rapid response.",
            ),
        ),
    ),
    SeedEntry(
        slug="aisha-patel",
        entry_type="person",
        name="Aisha Patel",
        description="Civic technologist documenting local election access efforts, volunteer networks, and turnout campaigns.",
        city="Milwaukee",
        state="WI",
        region=None,
        geo_specificity="local",
        website="https://example.org/aisha-patel",
        email="aisha@greatlakesciviclab.example.org",
        phone=None,
        social_media=None,
        affiliated_org_slug="great-lakes-civic-lab",
        verified=True,
        last_verified=date(2026, 4, 12),
        first_seen=date(2026, 3, 7),
        last_seen=date(2026, 4, 12),
        issue_areas=(
            "voter_suppression_and_electoral_access",
            "local_government_and_civic_engagement",
        ),
        sources=(
            SeedSource(
                url="https://midwestdemocracyreview.example.com/aisha-patel-great-lakes-civic-lab",
                title="Aisha Patel documents election access work in Milwaukee",
                publication="Midwest Democracy Review",
                published_date=date(2026, 4, 11),
                source_type="government_record",
                extraction_context="Aisha Patel documented election-access efforts, volunteer networks, and turnout operations in Milwaukee.",
            ),
            SeedSource(
                url="https://milwaukeeneighbors.example.com/aisha-patel-civic-data-volunteers",
                title="Civic data volunteers build turnout infrastructure in Milwaukee",
                publication="Milwaukee Neighbors",
                published_date=date(2026, 4, 12),
                source_type="news_article",
                extraction_context="Aisha Patel coordinated volunteer networks and public-interest tools around election access.",
            ),
        ),
    ),
    SeedEntry(
        slug="jordan-kim",
        entry_type="person",
        name="Jordan Kim",
        description="Transit advocate building climate and mobility campaigns with local governments and mutual-aid groups.",
        city="Minneapolis",
        state="MN",
        region=None,
        geo_specificity="local",
        website="https://example.org/jordan-kim",
        email=None,
        phone=None,
        social_media=None,
        affiliated_org_slug="river-county-clean-transit-coalition",
        verified=False,
        last_verified=None,
        first_seen=date(2026, 3, 10),
        last_seen=date(2026, 4, 10),
        issue_areas=("public_transit", "climate_adaptation_and_resilience"),
        sources=(
            SeedSource(
                url="https://uppermidwestclimatemonitor.example.com/jordan-kim-river-county-clean-transit",
                title="Jordan Kim links climate resilience and mobility campaigns",
                publication="Upper Midwest Climate Monitor",
                published_date=date(2026, 4, 9),
                source_type="report",
                extraction_context="Jordan Kim linked climate resilience, electrified buses, and safer streets in Minneapolis campaigns.",
            ),
            SeedSource(
                url="https://minneapolisstreetgrid.example.com/jordan-kim-bus-electrification-coalition",
                title="Jordan Kim pushes bus electrification with neighborhood groups",
                publication="Minneapolis Street Grid",
                published_date=date(2026, 4, 10),
                source_type="news_article",
                extraction_context="Jordan Kim worked with local governments and mutual-aid groups on electrified transit and safer streets.",
            ),
        ),
    ),
)


async def _get_entry_id_by_slug(conn: aiosqlite.Connection, slug: str) -> str | None:
    entry = await EntryCRUD.get_by_slug(conn, slug)
    return entry.id if entry is not None else None


async def _ensure_entry(
    conn: aiosqlite.Connection, seed: SeedEntry, affiliated_org_id: str | None
) -> str:
    existing_id = await _get_entry_id_by_slug(conn, seed.slug)
    if existing_id is None:
        existing_id = await EntryCRUD.create(
            conn,
            entry_type=seed.entry_type,
            name=seed.name,
            description=seed.description,
            city=seed.city,
            state=seed.state,
            region=seed.region,
            geo_specificity=seed.geo_specificity,
            website=seed.website,
            email=seed.email,
            phone=seed.phone,
            social_media=seed.social_media,
            affiliated_org_id=affiliated_org_id,
            first_seen=seed.first_seen,
            last_seen=seed.last_seen,
        )

    await conn.execute(
        """
        UPDATE entries
        SET type = ?,
            name = ?,
            description = ?,
            city = ?,
            state = ?,
            region = ?,
            geo_specificity = ?,
            website = ?,
            email = ?,
            phone = ?,
            social_media = ?,
            affiliated_org_id = ?,
            active = 1,
            verified = ?,
            last_verified = ?,
            first_seen = ?,
            last_seen = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            seed.entry_type,
            seed.name,
            seed.description,
            seed.city,
            seed.state,
            seed.region,
            seed.geo_specificity,
            seed.website,
            seed.email,
            seed.phone,
            json.dumps(seed.social_media) if seed.social_media else None,
            affiliated_org_id,
            1 if seed.verified else 0,
            seed.last_verified.isoformat() if seed.last_verified else None,
            seed.first_seen.isoformat(),
            seed.last_seen.isoformat(),
            db.now_iso(),
            existing_id,
        ),
    )
    await conn.commit()
    await EntryCRUD.set_vanity_slug(conn, existing_id, seed.slug)
    return existing_id


async def _sync_issue_areas(
    conn: aiosqlite.Connection, entry_id: str, issue_areas: tuple[str, ...]
) -> None:
    await conn.execute("DELETE FROM entry_issue_areas WHERE entry_id = ?", (entry_id,))
    await conn.executemany(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
        [(entry_id, issue_area, db.now_iso()) for issue_area in issue_areas],
    )
    await conn.commit()


async def _ensure_source(conn: aiosqlite.Connection, source: SeedSource) -> str:
    existing = await SourceCRUD.get_by_url(conn, source.url)
    if existing is None:
        return await SourceCRUD.create(
            conn,
            url=source.url,
            source_type=source.source_type,
            extraction_method="manual",
            title=source.title,
            publication=source.publication,
            published_date=source.published_date,
        )

    await SourceCRUD.update(
        conn,
        existing.id,
        title=source.title,
        publication=source.publication,
        published_date=source.published_date,
    )
    return existing.id


async def _sync_sources(
    conn: aiosqlite.Connection, entry_id: str, sources: tuple[SeedSource, ...]
) -> None:
    await conn.execute("DELETE FROM entry_sources WHERE entry_id = ?", (entry_id,))
    await conn.commit()
    for source in sources:
        source_id = await _ensure_source(conn, source)
        await SourceCRUD.link_to_entry(conn, entry_id, source_id, source.extraction_context)


async def seed_profiles(database_url: str) -> None:
    await init_db(database_url)
    conn = await get_db_connection(database_url)
    try:
        await conn.execute("PRAGMA busy_timeout = 30000")
        org_ids_by_slug: dict[str, str] = {}

        for seed in SEED_ENTRIES:
            if seed.entry_type != "organization":
                continue
            entry_id = await _ensure_entry(conn, seed, affiliated_org_id=None)
            org_ids_by_slug[seed.slug] = entry_id
            await _sync_issue_areas(conn, entry_id, seed.issue_areas)
            await _sync_sources(conn, entry_id, seed.sources)

        for seed in SEED_ENTRIES:
            if seed.entry_type != "person":
                continue
            affiliated_org_id = org_ids_by_slug.get(seed.affiliated_org_slug or "")
            entry_id = await _ensure_entry(conn, seed, affiliated_org_id=affiliated_org_id)
            await _sync_issue_areas(conn, entry_id, seed.issue_areas)
            await _sync_sources(conn, entry_id, seed.sources)
    finally:
        await conn.close()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed public Atlas profile data.")
    parser.add_argument(
        "--database-url",
        default="sqlite:///atlas.db",
        help="Database URL to seed. Defaults to sqlite:///atlas.db.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    asyncio.run(seed_profiles(args.database_url))


if __name__ == "__main__":
    main()
