"""Static seed data for the Atlas Briefing Room demo."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import date


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


@dataclass(frozen=True)
class _DemoLane:
    """Private demo brief lane built from the public profile seed."""

    brief_title: str
    list_name: str
    list_description: str
    location_query: str
    state: str
    issue_areas: tuple[str, ...]
    research_goal: str
    entry_slugs: tuple[str, ...]
    buyer_segment: str
    summary: str
    gaps: tuple[dict[str, str], ...]
    reasoning_signals: tuple[str, ...]
    source_reason: str


DEMO_ORG_ID = "local"
DEMO_USER_ID = "local-operator"
DEMO_BRIEF_TITLE = "Detroit Housing Landscape Brief"
DEMO_LIST_NAME = "Detroit housing follow-up"
DEMO_LOCATION_QUERY = "Detroit, MI"
DEMO_STATE = "MI"
DEMO_ISSUE_AREAS = ("housing_affordability",)
DEMO_RESEARCH_GOAL = "landscape_scan"
DEMO_ENTRY_SLUGS = ("eastside-housing-network", "maya-thompson")
DEMO_ARTIFACT_KIND = "briefing_room_demo"
CORROBORATED_SOURCE_THRESHOLD = 2

DEMO_LANES = (
    _DemoLane(
        brief_title=DEMO_BRIEF_TITLE,
        list_name=DEMO_LIST_NAME,
        list_description="Seeded follow-up list for the Detroit housing Briefing Room demo.",
        location_query=DEMO_LOCATION_QUERY,
        state=DEMO_STATE,
        issue_areas=DEMO_ISSUE_AREAS,
        research_goal=DEMO_RESEARCH_GOAL,
        entry_slugs=DEMO_ENTRY_SLUGS,
        buyer_segment="housing advocacy, funders, and nonprofit media",
        summary=(
            "Detroit housing work in the seeded demo centers on Eastside Housing Network "
            "and organizer Maya Thompson. The public profile layer gives the buyer named "
            "actors, source receipts, and visible gaps that can become a private follow-up "
            "brief instead of a loose search result."
        ),
        gaps=(
            {
                "label": "Funder relationships",
                "detail": "No source-backed funder or coalition relationship has been reviewed yet.",
            },
            {
                "label": "Current campaign calendar",
                "detail": "The demo seed does not include upcoming meeting or action dates.",
            },
        ),
        reasoning_signals=(
            "The organization and person records are linked by public sources.",
            "Multiple source receipts support the Detroit housing lane.",
            "Known gaps are preserved so the demo does not overstate coverage.",
        ),
        source_reason="This source gives the brief a public receipt for Detroit housing work.",
    ),
    _DemoLane(
        brief_title="Phoenix Worker Power Brief",
        list_name="Phoenix worker-power follow-up",
        list_description="Seeded follow-up list for the Phoenix labor Briefing Room demo.",
        location_query="Phoenix, AZ",
        state="AZ",
        issue_areas=("wage_theft_and_labor_rights", "immigration_and_belonging"),
        research_goal="partner_scan",
        entry_slugs=("sun-valley-worker-center", "luis-alvarez"),
        buyer_segment="labor organizations and worker-power funders",
        summary=(
            "Phoenix worker-power coverage centers on Sun Valley Worker Center and "
            "organizer Luis Alvarez. The lane shows how Atlas can move from public "
            "labor sources to a buyer-ready actor set for wage-theft defense, immigrant "
            "worker support, and rapid follow-up."
        ),
        gaps=(
            {
                "label": "Employer and industry map",
                "detail": "The seed does not yet connect campaigns to specific employers or sectors.",
            },
            {
                "label": "Coalition partners",
                "detail": "Legal, faith, and mutual-aid partners need a second source review.",
            },
        ),
        reasoning_signals=(
            "The worker center and organizer records share source-backed labor context.",
            "Sources show wage-theft defense and worker training as concrete program lines.",
            "The brief keeps employer and coalition gaps visible for the next pass.",
        ),
        source_reason="This source gives the brief a public receipt for Phoenix worker-power work.",
    ),
    _DemoLane(
        brief_title="Milwaukee Democracy Field Brief",
        list_name="Milwaukee democracy follow-up",
        list_description="Seeded follow-up list for the Milwaukee democracy Briefing Room demo.",
        location_query="Milwaukee, WI",
        state="WI",
        issue_areas=(
            "voter_suppression_and_electoral_access",
            "local_government_and_civic_engagement",
        ),
        research_goal="ecosystem_map",
        entry_slugs=("great-lakes-civic-lab", "aisha-patel"),
        buyer_segment="pro-democracy organizations, foundations, and campaigns",
        summary=(
            "Milwaukee democracy coverage centers on Great Lakes Civic Lab and Aisha "
            "Patel. The lane demonstrates a source-backed path from civic data tools "
            "to turnout infrastructure, volunteer networks, and reviewable gaps before "
            "a campaign or foundation uses the intelligence."
        ),
        gaps=(
            {
                "label": "Partner coverage",
                "detail": "Neighborhood groups and election-protection partners need more sources.",
            },
            {
                "label": "Active cycle timing",
                "detail": "The seed does not yet confirm next election-cycle milestones.",
            },
        ),
        reasoning_signals=(
            "The organization and technologist records share election-access source context.",
            "Sources identify civic tools, turnout infrastructure, and volunteer coordination.",
            "Cycle timing and partner coverage remain explicit follow-up gaps.",
        ),
        source_reason="This source gives the brief a public receipt for Milwaukee democracy work.",
    ),
)

DEMO_BRIEF_TITLES = tuple(lane.brief_title for lane in DEMO_LANES)
DEMO_LIST_NAMES = tuple(lane.list_name for lane in DEMO_LANES)
