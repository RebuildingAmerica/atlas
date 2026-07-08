import type { DiscoveryRunListResponse } from "@/types";
import type { SavedListSummary, WatchlistSummary } from "./research-summary";

function runCountLabel(count: number): string {
  return count === 1 ? "1 recent request" : `${count} recent requests`;
}

function newRunCountLabel(count: number): string {
  return count === 1 ? "1 new research request" : `${count} new research requests`;
}

function issueLabel(issueArea: string): string {
  const label = issueArea.split("_").filter(Boolean).join(" ");
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : issueArea;
}

export function placeWatchlistId(locationQuery: string, state: string): string {
  return `place:${locationQuery.toLowerCase()}:${state.toLowerCase()}`;
}

export function issueWatchlistId(issueArea: string): string {
  return `issue:${issueArea}`;
}

function researchSetWatchlistId(listId: string): string {
  return `research_set:${listId}`;
}

function savedActorLabel(count: number): string {
  return count === 1 ? "1 saved actor" : `${count} saved actors`;
}

function buildPlaceWatchlists(runs: DiscoveryRunListResponse["items"]): WatchlistSummary[] {
  const counts = new Map<string, { label: string; count: number }>();

  runs.forEach((run) => {
    const id = placeWatchlistId(run.location_query, run.state);
    const current = counts.get(id);
    counts.set(id, {
      label: current?.label ?? run.location_query,
      count: (current?.count ?? 0) + 1,
    });
  });

  return Array.from(counts.entries()).map(([id, item]) => ({
    id,
    kind: "place",
    label: item.label,
    detail: runCountLabel(item.count),
    changedSinceLastTime: newRunCountLabel(item.count),
  }));
}

function buildIssueWatchlists(runs: DiscoveryRunListResponse["items"]): WatchlistSummary[] {
  const counts = new Map<string, number>();

  runs.forEach((run) => {
    run.issue_areas.forEach((issueArea) => {
      counts.set(issueArea, (counts.get(issueArea) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries()).map(([issueArea, count]) => ({
    id: issueWatchlistId(issueArea),
    kind: "issue",
    label: issueLabel(issueArea),
    detail: runCountLabel(count),
    changedSinceLastTime: newRunCountLabel(count),
  }));
}

function buildResearchSetWatchlists(lists: SavedListSummary[]): WatchlistSummary[] {
  return lists.map((list) => ({
    id: researchSetWatchlistId(list.id),
    kind: "research_set",
    label: list.name,
    detail: savedActorLabel(list.itemCount),
    changedSinceLastTime: savedActorLabel(list.itemCount),
  }));
}

export function buildWatchlists(
  lists: SavedListSummary[],
  runs: DiscoveryRunListResponse["items"],
): WatchlistSummary[] {
  return [
    ...buildResearchSetWatchlists(lists),
    ...buildPlaceWatchlists(runs),
    ...buildIssueWatchlists(runs),
  ];
}

export { issueLabel, newRunCountLabel, runCountLabel, savedActorLabel };
