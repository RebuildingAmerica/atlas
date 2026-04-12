"""
Issue area taxonomy and search terms for the Atlas ecosystem.

Defines 11 domains with 51 issue areas that entries can be tagged with.
Each issue area has a slug, display name, description, and domain.
Also provides search term mappings used by the autodiscovery pipeline.
"""

from pydantic import BaseModel, ConfigDict

__all__ = [
    "ALL_ISSUE_SLUGS",
    "DOMAINS",
    "ISSUE_AREAS_BY_DOMAIN",
    "ISSUE_SEARCH_TERMS",
    "IssueArea",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
]


class IssueArea(BaseModel):
    """An issue area within a domain."""

    model_config = ConfigDict(frozen=True)

    slug: str
    """Unique identifier for the issue area (e.g., 'worker_cooperatives')."""

    name: str
    """Human-readable name (e.g., 'Worker Cooperatives')."""

    description: str
    """Brief description of what this issue area covers."""

    domain: str
    """The domain this issue area belongs to."""


# ---------------------------------------------------------------------------
# Internal registry
# ---------------------------------------------------------------------------

_ISSUE_AREAS: dict[str, IssueArea] = {}


def _register_issues(domain: str, issues: list[tuple[str, str, str]]) -> None:
    """Register issues for a domain."""
    for slug, name, description in issues:
        _ISSUE_AREAS[slug] = IssueArea(
            slug=slug,
            name=name,
            description=description,
            domain=domain,
        )


# ---------------------------------------------------------------------------
# Economic Security
# ---------------------------------------------------------------------------
_register_issues(
    "Economic Security",
    [
        (
            "automation_and_ai_displacement",
            "Automation and AI Displacement",
            "Work, jobs, and livelihoods disrupted by automation and AI.",
        ),
        (
            "gig_economy_and_precarious_work",
            "Gig Economy and Precarious Work",
            "Gig workers, contract labor, and precarious employment.",
        ),
        (
            "income_inequality_and_wealth_concentration",
            "Income Inequality and Wealth Concentration",
            "Wage gaps, wealth distribution, and economic inequality.",
        ),
        (
            "healthcare_economics_and_medical_debt",
            "Healthcare Economics and Medical Debt",
            "Medical debt, healthcare costs, and economic burden of illness.",
        ),
        (
            "student_debt_and_college_affordability",
            "Student Debt and College Affordability",
            "Student loan burden and accessibility of higher education.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Housing and the Built Environment
# ---------------------------------------------------------------------------
_register_issues(
    "Housing and the Built Environment",
    [
        (
            "housing_affordability",
            "Housing Affordability",
            "Affordable housing, rent, housing crises, and tenant organizing.",
        ),
        (
            "suburban_sprawl_and_car_dependency",
            "Suburban Sprawl and Car Dependency",
            "Urban sprawl, car culture, and land use patterns.",
        ),
        (
            "homelessness_and_housing_insecurity",
            "Homelessness and Housing Insecurity",
            "Homelessness, housing instability, and housing insecurity.",
        ),
        (
            "zoning_and_land_use",
            "Zoning and Land Use",
            "Zoning policy, land use regulation, and urban planning.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Climate and Environment
# ---------------------------------------------------------------------------
_register_issues(
    "Climate and Environment",
    [
        (
            "climate_adaptation_and_resilience",
            "Climate Adaptation and Resilience",
            "Preparing for and adapting to climate impacts.",
        ),
        (
            "environmental_justice_and_pollution",
            "Environmental Justice and Pollution",
            "Pollution, environmental racism, and environmental justice.",
        ),
        (
            "sustainable_agriculture_and_food_systems",
            "Sustainable Agriculture and Food Systems",
            "Sustainable farming, local food systems, and food security.",
        ),
        (
            "water_access_and_infrastructure",
            "Water Access and Infrastructure",
            "Water quality, water access, and water infrastructure.",
        ),
        (
            "energy_transition",
            "Energy Transition",
            "Renewable energy, energy policy, and just energy transition.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Democracy and Governance
# ---------------------------------------------------------------------------
_register_issues(
    "Democracy and Governance",
    [
        (
            "voter_suppression_and_electoral_access",
            "Voter Suppression and Electoral Access",
            "Voting rights, voter suppression, and electoral access.",
        ),
        (
            "local_government_and_civic_engagement",
            "Local Government and Civic Engagement",
            "Local governance, civic participation, and community organizing.",
        ),
        (
            "political_polarization_and_democratic_norms",
            "Political Polarization and Democratic Norms",
            "Political polarization, institutional health, and democratic norms.",
        ),
        (
            "money_in_politics",
            "Money in Politics",
            "Campaign finance, political donations, and influence.",
        ),
        (
            "electoral_reform",
            "Electoral Reform",
            "Voting systems, representation reform, and election administration.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Technology and Information
# ---------------------------------------------------------------------------
_register_issues(
    "Technology and Information",
    [
        (
            "social_media_and_mental_health",
            "Social Media and Mental Health",
            "Social media impact, digital mental health, and well-being.",
        ),
        (
            "misinformation_and_epistemic_crisis",
            "Misinformation and Epistemic Crisis",
            "Misinformation, disinformation, and information ecosystems.",
        ),
        (
            "digital_privacy_and_surveillance",
            "Digital Privacy and Surveillance",
            "Privacy rights, surveillance, and data protection.",
        ),
        (
            "broadband_access_and_digital_divide",
            "Broadband Access and Digital Divide",
            "Internet access, digital equity, and the digital divide.",
        ),
        (
            "platform_monopolies_and_tech_accountability",
            "Platform Monopolies and Tech Accountability",
            "Tech monopolies, platform regulation, and tech accountability.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Education
# ---------------------------------------------------------------------------
_register_issues(
    "Education",
    [
        (
            "k12_education_inequality",
            "K-12 Education Inequality",
            "K-12 education access, quality, and inequities.",
        ),
        (
            "higher_education_affordability",
            "Higher Education Affordability",
            "College access, affordability, and completion.",
        ),
        (
            "vocational_and_alternative_pathways",
            "Vocational and Alternative Pathways",
            "Vocational training, apprenticeships, and non-traditional education.",
        ),
        (
            "education_funding_and_policy",
            "Education Funding and Policy",
            "Education policy, funding, and school governance.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Health and Social Connection
# ---------------------------------------------------------------------------
_register_issues(
    "Health and Social Connection",
    [
        (
            "mental_health_crisis_and_access",
            "Mental Health Crisis and Access",
            "Mental health, mental illness, and mental health services.",
        ),
        (
            "loneliness_and_social_isolation",
            "Loneliness and Social Isolation",
            "Social isolation, loneliness, and community connection.",
        ),
        (
            "addiction_and_harm_reduction",
            "Addiction and Harm Reduction",
            "Substance abuse, addiction, and harm reduction approaches.",
        ),
        (
            "healthcare_access_and_coverage",
            "Healthcare Access and Coverage",
            "Healthcare access, coverage, and health equity.",
        ),
        (
            "community_health_infrastructure",
            "Community Health Infrastructure",
            "Public health, clinics, and community health systems.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Infrastructure and Public Goods
# ---------------------------------------------------------------------------
_register_issues(
    "Infrastructure and Public Goods",
    [
        (
            "transportation_and_mobility",
            "Transportation and Mobility",
            "Transportation systems, mobility, and transit accessibility.",
        ),
        (
            "public_transit",
            "Public Transit",
            "Public transportation, transit systems, and transit equity.",
        ),
        (
            "broadband_and_digital_access",
            "Broadband and Digital Access",
            "Internet infrastructure and digital access.",
        ),
        (
            "water_infrastructure",
            "Water Infrastructure",
            "Water systems, pipes, and water infrastructure.",
        ),
        (
            "physical_infrastructure_decay",
            "Physical Infrastructure Decay",
            "Infrastructure maintenance, roads, bridges, and infrastructure decay.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Justice and Public Safety
# ---------------------------------------------------------------------------
_register_issues(
    "Justice and Public Safety",
    [
        (
            "criminal_justice_reform_and_mass_incarceration",
            "Criminal Justice Reform and Mass Incarceration",
            "Criminal justice, incarceration, and judicial reform.",
        ),
        (
            "policing_and_community_safety",
            "Policing and Community Safety",
            "Policing, public safety, and police accountability.",
        ),
        (
            "immigration_and_belonging",
            "Immigration and Belonging",
            "Immigration, immigrant rights, and belonging.",
        ),
        (
            "restorative_justice",
            "Restorative Justice",
            "Restorative justice, conflict resolution, and healing.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Rural-Urban Divide
# ---------------------------------------------------------------------------
_register_issues(
    "Rural-Urban Divide",
    [
        (
            "rural_economic_decline_and_brain_drain",
            "Rural Economic Decline and Brain Drain",
            "Rural economies, job loss, and population decline.",
        ),
        (
            "cultural_resentment_and_political_division",
            "Cultural Resentment and Political Division",
            "Cultural conflicts and rural-urban political division.",
        ),
        (
            "rural_healthcare_and_services",
            "Rural Healthcare and Services",
            "Rural healthcare access, services, and infrastructure.",
        ),
        (
            "urban_rural_coalition_building",
            "Urban-Rural Coalition Building",
            "Cross-community organizing and urban-rural connections.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Labor and Worker Power
# ---------------------------------------------------------------------------
_register_issues(
    "Labor and Worker Power",
    [
        (
            "union_organizing",
            "Union Organizing",
            "Labor organizing, unionization, and collective bargaining.",
        ),
        (
            "worker_cooperatives",
            "Worker Cooperatives",
            "Worker-owned cooperatives and cooperative enterprises.",
        ),
        (
            "workplace_safety_and_conditions",
            "Workplace Safety and Conditions",
            "Workplace safety, conditions, and occupational health.",
        ),
        (
            "wage_theft_and_labor_rights",
            "Wage Theft and Labor Rights",
            "Wage theft, labor rights, and worker protections.",
        ),
        (
            "just_transition",
            "Just Transition",
            "Just transitions in economic and energy systems.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Public exports
# ---------------------------------------------------------------------------

DOMAINS: list[str] = [
    "Economic Security",
    "Housing and the Built Environment",
    "Climate and Environment",
    "Democracy and Governance",
    "Technology and Information",
    "Education",
    "Health and Social Connection",
    "Infrastructure and Public Goods",
    "Justice and Public Safety",
    "Rural-Urban Divide",
    "Labor and Worker Power",
]

ISSUE_AREAS_BY_DOMAIN: dict[str, list[IssueArea]] = {
    domain: [issue for issue in _ISSUE_AREAS.values() if issue.domain == domain]
    for domain in DOMAINS
}

ALL_ISSUE_SLUGS: set[str] = set(_ISSUE_AREAS.keys())

# ---------------------------------------------------------------------------
# Search terms mapped to issue area slugs
# ---------------------------------------------------------------------------

ISSUE_SEARCH_TERMS: dict[str, list[str]] = {
    # Economic Security
    "automation_and_ai_displacement": [
        "automation",
        "AI displacement",
        "job automation",
        "artificial intelligence jobs",
        "worker displacement",
        "technological unemployment",
    ],
    "gig_economy_and_precarious_work": [
        "gig economy",
        "gig workers",
        "contract workers",
        "precarious work",
        "temporary workers",
        "freelance workers",
    ],
    "income_inequality_and_wealth_concentration": [
        "income inequality",
        "wealth gap",
        "wealth concentration",
        "wage gap",
        "economic inequality",
        "inequality",
    ],
    "healthcare_economics_and_medical_debt": [
        "medical debt",
        "healthcare costs",
        "health insurance",
        "healthcare affordability",
        "healthcare access",
        "medical bankruptcy",
    ],
    "student_debt_and_college_affordability": [
        "student debt",
        "student loans",
        "college affordability",
        "higher education costs",
        "student loan forgiveness",
        "education affordability",
    ],
    # Housing and the Built Environment
    "housing_affordability": [
        "affordable housing",
        "housing crisis",
        "rent",
        "housing affordability",
        "community land trust",
        "tenant organizing",
        "rental housing",
    ],
    "suburban_sprawl_and_car_dependency": [
        "suburban sprawl",
        "car dependency",
        "urban sprawl",
        "land use",
        "car culture",
        "sprawl",
    ],
    "homelessness_and_housing_insecurity": [
        "homelessness",
        "housing insecurity",
        "unhoused",
        "housing instability",
        "homeless services",
    ],
    "zoning_and_land_use": [
        "zoning",
        "land use",
        "zoning reform",
        "zoning policy",
        "urban planning",
        "land use planning",
    ],
    # Climate and Environment
    "climate_adaptation_and_resilience": [
        "climate adaptation",
        "climate resilience",
        "climate change",
        "climate preparedness",
        "climate impacts",
    ],
    "environmental_justice_and_pollution": [
        "environmental justice",
        "pollution",
        "environmental racism",
        "toxic pollution",
        "air quality",
        "environmental health",
    ],
    "sustainable_agriculture_and_food_systems": [
        "sustainable agriculture",
        "local food",
        "food security",
        "food systems",
        "agricultural sustainability",
        "urban farming",
    ],
    "water_access_and_infrastructure": [
        "water access",
        "water quality",
        "water infrastructure",
        "drinking water",
        "water systems",
        "clean water",
    ],
    "energy_transition": [
        "renewable energy",
        "energy transition",
        "clean energy",
        "solar",
        "wind energy",
        "just energy transition",
    ],
    # Democracy and Governance
    "voter_suppression_and_electoral_access": [
        "voter suppression",
        "voting rights",
        "electoral access",
        "voter registration",
        "voting access",
    ],
    "local_government_and_civic_engagement": [
        "local government",
        "civic engagement",
        "community organizing",
        "local politics",
        "community participation",
    ],
    "political_polarization_and_democratic_norms": [
        "political polarization",
        "democratic norms",
        "institutional health",
        "polarization",
        "democratic institutions",
    ],
    "money_in_politics": [
        "campaign finance",
        "money in politics",
        "political donations",
        "lobbying",
        "dark money",
    ],
    "electoral_reform": [
        "electoral reform",
        "voting systems",
        "election administration",
        "election reform",
        "representation",
    ],
    # Technology and Information
    "social_media_and_mental_health": [
        "social media",
        "mental health",
        "digital mental health",
        "social media mental health",
        "tech and mental health",
    ],
    "misinformation_and_epistemic_crisis": [
        "misinformation",
        "disinformation",
        "fake news",
        "information ecosystem",
        "epistemic crisis",
    ],
    "digital_privacy_and_surveillance": [
        "digital privacy",
        "surveillance",
        "privacy rights",
        "data privacy",
        "data protection",
    ],
    "broadband_access_and_digital_divide": [
        "broadband access",
        "digital divide",
        "internet access",
        "broadband",
        "digital equity",
    ],
    "platform_monopolies_and_tech_accountability": [
        "platform monopolies",
        "tech monopolies",
        "big tech",
        "tech accountability",
        "platform regulation",
    ],
    # Education
    "k12_education_inequality": [
        "K-12 education",
        "education inequality",
        "school inequality",
        "education equity",
        "school funding",
    ],
    "higher_education_affordability": [
        "higher education",
        "college affordability",
        "university",
        "college access",
        "college completion",
    ],
    "vocational_and_alternative_pathways": [
        "vocational training",
        "apprenticeships",
        "alternative education",
        "skills training",
        "trade school",
    ],
    "education_funding_and_policy": [
        "education policy",
        "education funding",
        "school policy",
        "education reform",
    ],
    # Health and Social Connection
    "mental_health_crisis_and_access": [
        "mental health",
        "mental illness",
        "mental health services",
        "mental health crisis",
        "depression",
    ],
    "loneliness_and_social_isolation": [
        "loneliness",
        "social isolation",
        "social connection",
        "community",
        "belonging",
    ],
    "addiction_and_harm_reduction": [
        "addiction",
        "substance abuse",
        "harm reduction",
        "opioid",
        "drug treatment",
    ],
    "healthcare_access_and_coverage": [
        "healthcare access",
        "health insurance",
        "healthcare coverage",
        "health equity",
        "uninsured",
    ],
    "community_health_infrastructure": [
        "community health",
        "public health",
        "health clinics",
        "health infrastructure",
        "primary care",
    ],
    # Infrastructure and Public Goods
    "transportation_and_mobility": [
        "transportation",
        "transit",
        "public transportation",
        "bus",
        "bike infrastructure",
        "pedestrian",
    ],
    "public_transit": [
        "public transit",
        "transit system",
        "bus rapid transit",
        "light rail",
        "transit equity",
    ],
    "broadband_and_digital_access": [
        "broadband infrastructure",
        "broadband access",
        "internet infrastructure",
        "fiber optic",
    ],
    "water_infrastructure": [
        "water infrastructure",
        "water systems",
        "pipe",
        "water main",
        "water service",
    ],
    "physical_infrastructure_decay": [
        "infrastructure",
        "infrastructure decay",
        "infrastructure maintenance",
        "roads",
        "bridges",
    ],
    # Justice and Public Safety
    "criminal_justice_reform_and_mass_incarceration": [
        "criminal justice reform",
        "mass incarceration",
        "incarceration",
        "justice reform",
        "sentencing reform",
    ],
    "policing_and_community_safety": [
        "policing",
        "police reform",
        "community safety",
        "public safety",
        "police accountability",
    ],
    "immigration_and_belonging": [
        "immigration",
        "immigrant rights",
        "immigration policy",
        "deportation",
        "immigrant communities",
    ],
    "restorative_justice": [
        "restorative justice",
        "conflict resolution",
        "community justice",
        "healing justice",
    ],
    # Rural-Urban Divide
    "rural_economic_decline_and_brain_drain": [
        "rural economy",
        "rural economic decline",
        "brain drain",
        "rural jobs",
        "rural development",
    ],
    "cultural_resentment_and_political_division": [
        "rural urban divide",
        "cultural resentment",
        "political division",
        "rural urban split",
    ],
    "rural_healthcare_and_services": [
        "rural healthcare",
        "rural health",
        "rural services",
        "rural clinics",
    ],
    "urban_rural_coalition_building": [
        "urban rural coalition",
        "cross community organizing",
        "coalition building",
    ],
    # Labor and Worker Power
    "union_organizing": [
        "union organizing",
        "unionization",
        "labor organizing",
        "collective bargaining",
        "labor movement",
    ],
    "worker_cooperatives": [
        "worker cooperative",
        "worker-owned",
        "co-op",
        "cooperative enterprise",
        "employee ownership",
    ],
    "workplace_safety_and_conditions": [
        "workplace safety",
        "workplace conditions",
        "occupational health",
        "worker safety",
        "OSHA",
    ],
    "wage_theft_and_labor_rights": [
        "wage theft",
        "labor rights",
        "worker rights",
        "wage violations",
        "labor standards",
    ],
    "just_transition": [
        "just transition",
        "energy transition",
        "worker transition",
        "transitional support",
    ],
}


def get_issue_area_by_slug(slug: str) -> IssueArea | None:
    """
    Get an issue area by its slug.

    Parameters
    ----------
    slug : str
        The issue area slug (e.g., 'worker_cooperatives').

    Returns
    -------
    IssueArea | None
        The issue area if found, None otherwise.
    """
    return _ISSUE_AREAS.get(slug)


def get_issues_by_domain(domain: str) -> list[IssueArea]:
    """
    Get all issue areas for a domain.

    Parameters
    ----------
    domain : str
        The domain name (must be in DOMAINS).

    Returns
    -------
    list[IssueArea]
        List of issue areas in the domain, or empty list if domain not found.
    """
    return ISSUE_AREAS_BY_DOMAIN.get(domain, [])
