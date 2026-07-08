"""Raw issue-area rows for the Atlas taxonomy."""

from __future__ import annotations

ISSUE_AREAS_BY_DOMAIN_ROWS: dict[str, list[tuple[str, str, str]]] = {
    "Economic Security": [
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
    "Housing and the Built Environment": [
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
    "Climate and Environment": [
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
    "Democracy and Governance": [
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
    "Technology and Information": [
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
    "Education": [
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
    "Health and Social Connection": [
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
    "Infrastructure and Public Goods": [
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
    "Justice and Public Safety": [
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
    "Rural-Urban Divide": [
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
    "Labor and Worker Power": [
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
}
