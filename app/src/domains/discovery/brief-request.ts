import {
  blindSpotsForSummary,
  confidenceFromLead,
  RESEARCH_GOAL_LABELS,
  type DiscoveryRunRecord,
} from "@/domains/discovery/discovery-run-summary";
import type {
  AtlasBriefConfidenceState,
  AtlasBriefCreateInput,
} from "@/domains/workspace/server/briefs";
import type { DiscoveryResearchSummary } from "@rebuildingamerica/atlas-api-client";

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function confidenceStateForSummary(summary: DiscoveryResearchSummary): AtlasBriefConfidenceState {
  const leadStates = summary.ranked_leads.map(confidenceFromLead);
  if (
    summary.key_sources.length >= 2 &&
    leadStates.length > 0 &&
    leadStates.every((state) => state === "corroborated")
  ) {
    return "corroborated";
  }

  if (summary.key_sources.length > 0) {
    return "partial";
  }

  return "unverified";
}

export function canCreateBriefFromRun(run: DiscoveryRunRecord): boolean {
  const summary = run.research_summary;
  return (
    run.status === "completed" &&
    summary != null &&
    summary.ranked_leads.length > 0 &&
    summary.key_sources.length > 0
  );
}

export function buildBriefCreateInputFromRun(run: DiscoveryRunRecord): AtlasBriefCreateInput {
  if (!canCreateBriefFromRun(run) || !run.research_summary) {
    throw new Error("Completed research with ranked leads and key sources is required.");
  }

  const summary = run.research_summary;

  return {
    title: `${run.location_query} ${RESEARCH_GOAL_LABELS[run.research_goal]}`,
    scope: {
      actor_types: uniqueValues(summary.ranked_leads.map((lead) => lead.type)),
      geography: run.location_query,
      issue_areas: run.issue_areas,
      // Discovery summaries currently carry URL-backed source receipts but not
      // normalized source classes. Keep the source scope explicit until the
      // summary contract carries source types directly.
      source_types: ["web"],
    },
    summary: summary.brief,
    linked_entry_ids: uniqueValues(summary.ranked_leads.map((lead) => lead.entry_id)),
    linked_source_ids: uniqueValues(summary.key_sources.map((source) => source.source_id)),
    linked_discovery_run_ids: [run.id],
    confidence_summary: {
      review_status: "needs review",
      source_count: summary.key_sources.length,
      state: confidenceStateForSummary(summary),
    },
    gaps: blindSpotsForSummary(run.research_goal, summary),
  };
}
