import { humanize } from "@/domains/catalog/catalog";
import type {
  BrowseIssueBrief,
  BrowsePlaceBrief,
} from "@/domains/catalog/components/browse/browse-results-aside";
import { sourcePatternBriefLabel } from "./browse-page-derivations-helpers";

interface BrowseBriefSourcePatternFacet {
  count: number;
  value: string;
}

interface BrowseBriefEntries {
  facets: {
    source_patterns?: BrowseBriefSourcePatternFacet[];
  };
  pagination: {
    total: number;
  };
}

interface BrowseBriefFilters {
  issue_areas: string[];
}

interface BuildPlaceBriefInput {
  entries?: BrowseBriefEntries;
  issueAreaLabels: Record<string, string>;
  selectedFilters: BrowseBriefFilters;
  selectedStateName?: string;
}

interface BuildIssueBriefInput {
  entries?: BrowseBriefEntries;
  issueAreaLabels: Record<string, string>;
  selectedFilters: BrowseBriefFilters;
}

export function buildPlaceBrief({
  entries,
  issueAreaLabels,
  selectedFilters,
  selectedStateName,
}: BuildPlaceBriefInput): BrowsePlaceBrief | undefined {
  const selectedIssueArea = selectedFilters.issue_areas[0];
  if (!selectedStateName || !selectedIssueArea || !entries?.pagination) {
    return undefined;
  }

  const issueLabel = issueAreaLabels[selectedIssueArea] ?? humanize(selectedIssueArea);
  const ecosystemLabel = issueLabel.split(/\s+/)[0]?.toLowerCase() ?? "local";
  const strongestSourcePattern = [...(entries.facets.source_patterns ?? [])].sort(
    (left, right) => right.count - left.count,
  )[0];

  return {
    body: `${entries.pagination.total} people or groups with sources.`,
    signal: strongestSourcePattern
      ? `Strongest signal: ${sourcePatternBriefLabel(strongestSourcePattern.value)}`
      : undefined,
    title: `${selectedStateName} ${ecosystemLabel} ecosystem`,
  };
}

export function buildIssueBrief({
  entries,
  issueAreaLabels,
  selectedFilters,
}: BuildIssueBriefInput): BrowseIssueBrief | undefined {
  const selectedIssueArea = selectedFilters.issue_areas[0];
  if (!selectedIssueArea || !entries?.pagination) {
    return undefined;
  }

  const issueLabel = issueAreaLabels[selectedIssueArea] ?? humanize(selectedIssueArea);
  const strongestSourcePattern = [...(entries.facets.source_patterns ?? [])].sort(
    (left, right) => right.count - left.count,
  )[0];
  const multiSourceCount =
    entries.facets.source_patterns?.find((facet) => facet.value === "multi_source")?.count ?? 0;
  const gap =
    entries.pagination.total > 0 && multiSourceCount < entries.pagination.total / 2
      ? "Gap: build more multi-source confirmation."
      : undefined;

  return {
    body: `${entries.pagination.total} people or groups with sources.`,
    gap,
    signal: strongestSourcePattern
      ? `Source signal: ${sourcePatternBriefLabel(strongestSourcePattern.value)}`
      : undefined,
    title: `${issueLabel} landscape`,
  };
}
