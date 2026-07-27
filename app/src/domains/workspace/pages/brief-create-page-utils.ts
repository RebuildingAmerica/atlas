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

/** A brief the author can submit. */
export interface BriefCreateDraftReady {
  input: AtlasBriefCreateInput;
  problem: null;
}

/** A brief the author still has to fix, with the field-level reason. */
export interface BriefCreateDraftProblem {
  input: null;
  problem: string;
}

export type BriefCreateDraft = BriefCreateDraftReady | BriefCreateDraftProblem;

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

export function parseGapsText(value: string): AtlasBriefGap[] | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const gaps: AtlasBriefGap[] = [];
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
      return null;
    }

    gaps.push({
      detail: line.slice(separatorIndex + 1).trim(),
      label: line.slice(0, separatorIndex).trim(),
    });
  }

  return gaps;
}

export function evidenceCounts(state: BriefCreateStateFields): EvidenceCounts {
  return {
    actorCount: splitList(state.linkedEntryIds).length,
    runCount: splitList(state.linkedDiscoveryRunIds).length,
    sourceCount: splitList(state.linkedSourceIds).length,
  };
}

export function buildBriefCreateInput(state: BriefCreateStateFields): BriefCreateDraft {
  const linkedEntryIds = splitList(state.linkedEntryIds);
  const linkedSourceIds = splitList(state.linkedSourceIds);
  const linkedDiscoveryRunIds = splitList(state.linkedDiscoveryRunIds);

  if (linkedEntryIds.length + linkedSourceIds.length + linkedDiscoveryRunIds.length === 0) {
    return { input: null, problem: "Add at least one actor, source, or research run." };
  }

  const gaps = parseGapsText(state.gapsText);
  if (gaps === null) {
    return { input: null, problem: "Each gap needs a label and detail." };
  }

  const input: AtlasBriefCreateInput = {
    confidence_summary: {
      review_status: state.reviewStatus.trim(),
      source_count: linkedSourceIds.length,
      state: state.confidenceState,
    },
    gaps,
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

  return { input, problem: null };
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
