# The Atlas: Issue Taxonomy

## Purpose

This is the controlled vocabulary that the Atlas tags against. Every entry
is tagged with one or more issue areas from this taxonomy. The autodiscovery
pipeline uses it to classify extracted entries. The search interface uses it
for filtering. Gap analysis uses it to identify missing coverage.

Derived from the Rebuilding America series issues guide. Will evolve as
the initiative evolves.

## Structure

Two levels: **domain** (broad category) and **issue area** (specific topic).
Entries are tagged at the issue area level. Domains exist for grouping and
navigation only.

An entry can be tagged with multiple issue areas across multiple domains.
Cross-cutting work is the norm, not the exception.

---

## Domains and Issue Areas

### Economic Security
- `automation_and_ai_displacement`
- `gig_economy_and_precarious_work`
- `income_inequality_and_wealth_concentration`
- `healthcare_economics_and_medical_debt`
- `student_debt_and_college_affordability`

### Housing and the Built Environment
- `housing_affordability`
- `suburban_sprawl_and_car_dependency`
- `homelessness_and_housing_insecurity`
- `zoning_and_land_use`

### Climate and Environment
- `climate_adaptation_and_resilience`
- `environmental_justice_and_pollution`
- `sustainable_agriculture_and_food_systems`
- `water_access_and_infrastructure`
- `energy_transition`

### Democracy and Governance
- `voter_suppression_and_electoral_access`
- `local_government_and_civic_engagement`
- `political_polarization_and_democratic_norms`
- `money_in_politics`
- `electoral_reform`

### Technology and Information
- `social_media_and_mental_health`
- `misinformation_and_epistemic_crisis`
- `digital_privacy_and_surveillance`
- `broadband_access_and_digital_divide`
- `platform_monopolies_and_tech_accountability`

### Education
- `k12_education_inequality`
- `higher_education_affordability`
- `vocational_and_alternative_pathways`
- `education_funding_and_policy`

### Health and Social Connection
- `mental_health_crisis_and_access`
- `loneliness_and_social_isolation`
- `addiction_and_harm_reduction`
- `healthcare_access_and_coverage`
- `community_health_infrastructure`

### Infrastructure and Public Goods
- `transportation_and_mobility`
- `public_transit`
- `broadband_and_digital_access`
- `water_infrastructure`
- `physical_infrastructure_decay`

### Justice and Public Safety
- `criminal_justice_reform_and_mass_incarceration`
- `policing_and_community_safety`
- `immigration_and_belonging`
- `restorative_justice`

### Rural-Urban Divide
- `rural_economic_decline_and_brain_drain`
- `cultural_resentment_and_political_division`
- `rural_healthcare_and_services`
- `urban_rural_coalition_building`

### Labor and Worker Power
- `union_organizing`
- `worker_cooperatives`
- `workplace_safety_and_conditions`
- `wage_theft_and_labor_rights`
- `just_transition`

---

## Design Principles

**Multi-tagging is expected.** A community land trust fighting displacement
in a flood-prone neighborhood might be tagged `housing_affordability` +
`climate_adaptation_and_resilience` + `environmental_justice_and_pollution`.
That's not over-tagging — it's how the Atlas surfaces the connections between
issues that the series is built to explore.

**Granularity is at the "conversation" level.** Each issue area should be
specific enough that two entries tagged the same way are recognizably working
on related things, but broad enough that the taxonomy doesn't balloon. If
finer distinction is needed, that's what the entry description and free-text
search are for.

**This will change.** The tour will reveal issues and framings not captured
here. New issue areas get added when existing ones can't describe a meaningful
cluster of entries. Issue areas get split when they're too broad to be useful.
The taxonomy serves the Atlas, not the other way around.
