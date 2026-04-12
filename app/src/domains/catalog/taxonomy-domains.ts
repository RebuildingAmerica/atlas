/**
 * Maps each issue area slug to its taxonomy domain.
 *
 * Source of truth: docs/the-atlas-taxonomy.md
 */

export type TaxonomyDomain =
  | "Economic Security"
  | "Housing & Built Environment"
  | "Climate & Environment"
  | "Democracy & Governance"
  | "Technology & Information"
  | "Education"
  | "Health & Social Connection"
  | "Infrastructure & Public Goods"
  | "Justice & Public Safety"
  | "Rural-Urban Divide"
  | "Labor & Worker Power";

export const ISSUE_AREA_TO_DOMAIN: Record<string, TaxonomyDomain> = {
  // Economic Security
  automation_and_ai_displacement: "Economic Security",
  gig_economy_and_precarious_work: "Economic Security",
  income_inequality_and_wealth_concentration: "Economic Security",
  healthcare_economics_and_medical_debt: "Economic Security",
  student_debt_and_college_affordability: "Economic Security",

  // Housing & Built Environment
  housing_affordability: "Housing & Built Environment",
  suburban_sprawl_and_car_dependency: "Housing & Built Environment",
  homelessness_and_housing_insecurity: "Housing & Built Environment",
  zoning_and_land_use: "Housing & Built Environment",

  // Climate & Environment
  climate_adaptation_and_resilience: "Climate & Environment",
  environmental_justice_and_pollution: "Climate & Environment",
  sustainable_agriculture_and_food_systems: "Climate & Environment",
  water_access_and_infrastructure: "Climate & Environment",
  energy_transition: "Climate & Environment",

  // Democracy & Governance
  voter_suppression_and_electoral_access: "Democracy & Governance",
  local_government_and_civic_engagement: "Democracy & Governance",
  political_polarization_and_democratic_norms: "Democracy & Governance",
  money_in_politics: "Democracy & Governance",
  electoral_reform: "Democracy & Governance",

  // Technology & Information
  social_media_and_mental_health: "Technology & Information",
  misinformation_and_epistemic_crisis: "Technology & Information",
  digital_privacy_and_surveillance: "Technology & Information",
  broadband_access_and_digital_divide: "Technology & Information",
  platform_monopolies_and_tech_accountability: "Technology & Information",

  // Education
  k12_education_inequality: "Education",
  higher_education_affordability: "Education",
  vocational_and_alternative_pathways: "Education",
  education_funding_and_policy: "Education",

  // Health & Social Connection
  mental_health_crisis_and_access: "Health & Social Connection",
  loneliness_and_social_isolation: "Health & Social Connection",
  addiction_and_harm_reduction: "Health & Social Connection",
  healthcare_access_and_coverage: "Health & Social Connection",
  community_health_infrastructure: "Health & Social Connection",

  // Infrastructure & Public Goods
  transportation_and_mobility: "Infrastructure & Public Goods",
  public_transit: "Infrastructure & Public Goods",
  broadband_and_digital_access: "Infrastructure & Public Goods",
  water_infrastructure: "Infrastructure & Public Goods",
  physical_infrastructure_decay: "Infrastructure & Public Goods",

  // Justice & Public Safety
  criminal_justice_reform_and_mass_incarceration: "Justice & Public Safety",
  policing_and_community_safety: "Justice & Public Safety",
  immigration_and_belonging: "Justice & Public Safety",
  restorative_justice: "Justice & Public Safety",

  // Rural-Urban Divide
  rural_economic_decline_and_brain_drain: "Rural-Urban Divide",
  cultural_resentment_and_political_division: "Rural-Urban Divide",
  rural_healthcare_and_services: "Rural-Urban Divide",
  urban_rural_coalition_building: "Rural-Urban Divide",

  // Labor & Worker Power
  union_organizing: "Labor & Worker Power",
  worker_cooperatives: "Labor & Worker Power",
  workplace_safety_and_conditions: "Labor & Worker Power",
  wage_theft_and_labor_rights: "Labor & Worker Power",
  just_transition: "Labor & Worker Power",
};

/**
 * Groups an array of issue area slugs by their taxonomy domain.
 *
 * Returns a Map preserving insertion order so domains appear in the order
 * their first issue area was encountered.
 */
export function groupIssueAreasByDomain(issueAreas: string[]): Map<TaxonomyDomain, string[]> {
  const groups = new Map<TaxonomyDomain, string[]>();

  for (const slug of issueAreas) {
    const domain = ISSUE_AREA_TO_DOMAIN[slug];
    if (!domain) continue;

    const bucket = groups.get(domain);
    if (bucket) {
      bucket.push(slug);
    } else {
      groups.set(domain, [slug]);
    }
  }

  return groups;
}
