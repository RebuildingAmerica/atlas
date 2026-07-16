import {
  blindSpotsForSummary,
  RESEARCH_GOAL_LABELS,
  type DiscoveryRunRecord,
} from "@rebuildingamerica/atlas-catalog/discovery/discovery-run-summary";
import type { CoverageTargetCreateInput } from "@/domains/workspace/server/coverage-targets";

const MAX_WATCHED_LEADS = 3;

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

export function canCreateCoverageTargetFromRun(run: DiscoveryRunRecord): boolean {
  return (
    run.status === "completed" &&
    run.research_summary != null &&
    run.research_summary.ranked_leads.length > 0 &&
    run.issue_areas.length > 0
  );
}

export function topLeadEntryIdsFromRun(run: DiscoveryRunRecord): string[] {
  const summary = run.research_summary;
  if (!summary) {
    return [];
  }

  return uniqueValues(summary.ranked_leads.map((lead) => lead.entry_id)).slice(
    0,
    MAX_WATCHED_LEADS,
  );
}

export function buildCoverageTargetCreateInputFromRun(
  run: DiscoveryRunRecord,
): CoverageTargetCreateInput {
  if (!canCreateCoverageTargetFromRun(run) || !run.research_summary) {
    throw new Error("Completed research with ranked leads and issue areas is required.");
  }

  const summary = run.research_summary;
  const gaps = blindSpotsForSummary(run.research_goal, summary);
  const nextActions =
    gaps.length > 0
      ? gaps.slice(0, 3).map((gap) => `Review ${gap.label}.`)
      : ["Review linked sources."];

  return {
    actor_types: uniqueValues(summary.ranked_leads.map((lead) => lead.type)),
    gaps,
    geography: run.location_query,
    issue_areas: run.issue_areas,
    linked_discovery_run_ids: [run.id],
    linked_entry_ids: topLeadEntryIdsFromRun(run),
    name: `${run.location_query} ${RESEARCH_GOAL_LABELS[run.research_goal]} coverage`,
    next_actions: nextActions,
    review_state: "in_review",
    source_types: ["web"],
  };
}
