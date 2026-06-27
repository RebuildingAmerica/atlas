import type {
  DiscoveryConfidenceState,
  DiscoveryResearchGap,
  DiscoveryResearchGoal,
  DiscoveryResearchLead,
  DiscoveryResearchSummary,
  DiscoveryRun,
} from "@/types";

export interface DiscoveryRunRecord extends DiscoveryRun {
  error_message?: string | null;
}

export interface BlindSpotItem {
  label: string;
  detail: string;
}

interface ActorCategoryBlindSpot {
  label: string;
  detail: string;
  leadTypes: string[];
}

export const RESEARCH_GOAL_LABELS: Record<DiscoveryResearchGoal, string> = {
  ecosystem_map: "Ecosystem map",
  interview_leads: "Interview leads",
  landscape_scan: "Landscape scan",
  partner_scan: "Partner scan",
};

export const CONFIDENCE_LABELS: Record<DiscoveryConfidenceState, string> = {
  corroborated: "Corroborated",
  partial: "Partial",
  unverified: "Unverified",
};

const EXPECTED_ACTOR_CATEGORIES: Record<DiscoveryResearchGoal, ActorCategoryBlindSpot[]> = {
  ecosystem_map: [
    {
      label: "Named people",
      detail: "No named person leads in the ranked set.",
      leadTypes: ["person"],
    },
    {
      label: "Initiatives and campaigns",
      detail: "No initiative or campaign leads in the ranked set.",
      leadTypes: ["initiative", "campaign"],
    },
  ],
  interview_leads: [
    {
      label: "Named people",
      detail: "No named person leads in the ranked set.",
      leadTypes: ["person"],
    },
  ],
  landscape_scan: [
    {
      label: "Named people",
      detail: "No named person leads in the ranked set.",
      leadTypes: ["person"],
    },
    {
      label: "Initiatives and campaigns",
      detail: "No initiative or campaign leads in the ranked set.",
      leadTypes: ["initiative", "campaign"],
    },
  ],
  partner_scan: [
    {
      label: "Initiatives and campaigns",
      detail: "No initiative or campaign leads in the ranked set.",
      leadTypes: ["initiative", "campaign"],
    },
  ],
};

export function confidenceFromLead(lead: DiscoveryResearchLead): DiscoveryConfidenceState {
  if (lead.confidence) {
    return lead.confidence;
  }
  if (lead.source_count >= 2) {
    return "corroborated";
  }
  if (lead.source_count === 1) {
    return "partial";
  }
  return "unverified";
}

function normalizedLeadType(lead: DiscoveryResearchLead): string {
  return lead.type.trim().toLowerCase();
}

function actorCategoryBlindSpots(
  researchGoal: DiscoveryResearchGoal,
  leads: DiscoveryResearchLead[],
): BlindSpotItem[] {
  const presentTypes = new Set(leads.map(normalizedLeadType));

  return EXPECTED_ACTOR_CATEGORIES[researchGoal]
    .filter((category) => !category.leadTypes.some((leadType) => presentTypes.has(leadType)))
    .map((category) => ({
      label: category.label,
      detail: category.detail,
    }));
}

function gapBlindSpots(gaps: DiscoveryResearchGap[]): BlindSpotItem[] {
  return gaps.map((gap) => ({
    label: gap.label,
    detail: gap.detail,
  }));
}

export function blindSpotsForSummary(
  researchGoal: DiscoveryResearchGoal,
  summary: DiscoveryResearchSummary,
): BlindSpotItem[] {
  return [
    ...actorCategoryBlindSpots(researchGoal, summary.ranked_leads),
    ...gapBlindSpots(summary.gaps),
  ].slice(0, 4);
}
