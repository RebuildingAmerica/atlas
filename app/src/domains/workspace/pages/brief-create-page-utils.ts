import type {
  AtlasBriefConfidenceState,
  AtlasBriefCreateInput,
  AtlasBriefGap,
} from "@/domains/workspace/server/briefs";

export interface BriefCreateStateFields {
  actorTypes: string;
  confidenceState: AtlasBriefConfidenceState;
  gapsText: string;
  geography: string;
  issueAreas: string;
  linkedDiscoveryRunIds: string;
  linkedEntryIds: string;
  linkedSourceIds: string;
  reviewStatus: string;
  sourceTypes: string;
  summary: string;
  title: string;
}

export interface EvidenceCounts {
  actorCount: number;
  runCount: number;
  sourceCount: number;
}

export const initialFormState: BriefCreateStateFields = {
  actorTypes: "",
  confidenceState: "partial",
  gapsText: "",
  geography: "",
  issueAreas: "",
  linkedDiscoveryRunIds: "",
  linkedEntryIds: "",
  linkedSourceIds: "",
  reviewStatus: "needs review",
  sourceTypes: "",
  summary: "",
  title: "",
};

export const KNOWN_GAP_FORMAT = "Label: detail";

export const CONFIDENCE_STATE_OPTIONS: { label: string; value: AtlasBriefConfidenceState }[] = [
  { label: "corroborated", value: "corroborated" },
  { label: "partial", value: "partial" },
  { label: "unverified", value: "unverified" },
];

export function splitList(value: string): string[] {
  const items = value
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(items));
}

export function parseGapsText(value: string): AtlasBriefGap[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
      throw new Error("Each gap needs a label and detail.");
    }

    return {
      detail: line.slice(separatorIndex + 1).trim(),
      label: line.slice(0, separatorIndex).trim(),
    };
  });
}

export function evidenceCounts(state: BriefCreateStateFields): EvidenceCounts {
  return {
    actorCount: splitList(state.linkedEntryIds).length,
    runCount: splitList(state.linkedDiscoveryRunIds).length,
    sourceCount: splitList(state.linkedSourceIds).length,
  };
}

export function buildBriefCreateInput(state: BriefCreateStateFields): AtlasBriefCreateInput {
  const linkedEntryIds = splitList(state.linkedEntryIds);
  const linkedSourceIds = splitList(state.linkedSourceIds);
  const linkedDiscoveryRunIds = splitList(state.linkedDiscoveryRunIds);

  if (linkedEntryIds.length + linkedSourceIds.length + linkedDiscoveryRunIds.length === 0) {
    throw new Error("Add at least one actor, source, or research run.");
  }

  return {
    confidence_summary: {
      review_status: state.reviewStatus.trim(),
      source_count: linkedSourceIds.length,
      state: state.confidenceState,
    },
    gaps: parseGapsText(state.gapsText),
    linked_discovery_run_ids: linkedDiscoveryRunIds,
    linked_entry_ids: linkedEntryIds,
    linked_source_ids: linkedSourceIds,
    scope: {
      actor_types: splitList(state.actorTypes),
      geography: state.geography.trim(),
      issue_areas: splitList(state.issueAreas),
      source_types: splitList(state.sourceTypes),
    },
    summary: state.summary.trim(),
    title: state.title.trim(),
  };
}

export function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function fieldClassName(): string {
  return "border-outline-variant bg-surface text-ink-strong type-body-medium min-h-10 w-full rounded-lg border px-3";
}

export function textAreaClassName(extraHeight = "min-h-24"): string {
  return `border-outline-variant bg-surface text-ink-strong type-body-medium ${extraHeight} w-full rounded-lg border px-3 py-2`;
}
