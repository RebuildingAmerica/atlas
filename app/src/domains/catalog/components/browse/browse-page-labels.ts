/** Wording and href shapes the browse page puts on screen. */

import {
  formatDateTimeOrInput,
  formatStableDateTime,
  MEDIUM_DATE,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import type { BrowseEditorialFacet } from "@/domains/catalog/components/browse/browse-editorial-sections";
import {
  ENTITY_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
  humanize,
} from "@rebuildingamerica/atlas-catalog/catalog";
import type { buildBrowseSearch } from "@rebuildingamerica/atlas-catalog/search-state";
import { type BrowseFilterKey } from "@rebuildingamerica/atlas-catalog/search-state";
import { STATE_NAME_BY_CODE } from "@rebuildingamerica/atlas-catalog/us-state-grid";
import type { Entry, EntryType, SourceType } from "@rebuildingamerica/atlas-api-client";
export const INITIAL_ENTRIES_ERROR = new Error("Results could not load.");

export const PROFILE_PATH_BY_TYPE: Record<EntryType, string> = {
  campaign: "/profiles/campaigns",
  event: "/profiles/events",
  initiative: "/profiles/initiatives",
  organization: "/profiles/organizations",
  person: "/profiles/people",
};

export const PRIMARY_ENTRY_TYPE_SECTION_ORDER: EntryType[] = ["organization", "person"];
export const SECONDARY_ENTRY_TYPE_SECTION_ORDER: EntryType[] = ["initiative", "campaign", "event"];
export const ENTRY_TYPE_SECTION_ORDER: EntryType[] = [
  ...PRIMARY_ENTRY_TYPE_SECTION_ORDER,
  ...SECONDARY_ENTRY_TYPE_SECTION_ORDER,
];

export function resultLabel(count: number): string {
  return count === 1 ? "1 record" : `${count} records`;
}

export function sourceLabel(count: number): string {
  return count === 1 ? "1 linked source" : `${count} linked sources`;
}

export function actorCountLabel(count: number): string {
  return count === 1 ? "1 person or group" : `${count} people and groups`;
}

/** Only ever shown for an issue spread across more than one place. */
export function placeCountLabel(count: number): string {
  return `${count} places`;
}

export function facetAriaLabel(item: BrowseEditorialFacet, variant: "issue" | "standard"): string {
  if (variant === "standard") {
    return `${item.label} ${resultLabel(item.count)}`;
  }

  return [
    item.label,
    item.actorCount ? actorCountLabel(item.actorCount) : undefined,
    item.placeCount ? placeCountLabel(item.placeCount) : undefined,
    item.evidenceCount ? sourceLabel(item.evidenceCount) : undefined,
    item.latestSourceDate ? `Latest source ${dateLabel(item.latestSourceDate)}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export function dateLabel(value: string): string {
  // A source date is a calendar day, so it stays pinned rather than shifting
  // into the reader's zone.
  return formatDateTimeOrInput(formatStableDateTime, value, MEDIUM_DATE);
}

export function entryLocation(entry: Entry): string {
  return [entry.city, entry.state, entry.region].filter(Boolean).join(", ");
}

export function entryProfileHref(entry: Entry): string {
  return `${PROFILE_PATH_BY_TYPE[entry.type]}/${entry.slug}`;
}

export function filterLabel(
  key: BrowseFilterKey,
  value: string,
  issueAreaLabels: Record<string, string>,
) {
  if (key === "states") {
    return STATE_NAME_BY_CODE[value] ?? value;
  }
  if (key === "issue_areas") {
    return issueAreaLabels[value] ?? humanize(value);
  }
  if (key === "entry_types") {
    return ENTITY_TYPE_LABELS[value as EntryType] ?? humanize(value);
  }
  if (key === "source_types") {
    return SOURCE_TYPE_LABELS[value as SourceType] ?? humanize(value);
  }
  return humanize(value);
}

export function browseContextLabel(
  filters: ReturnType<typeof buildBrowseSearch>,
  issueAreaLabels: Record<string, string>,
): string | undefined {
  const labels = [
    ...filters.cities,
    ...filters.states.map((state) => STATE_NAME_BY_CODE[state] ?? state),
    ...filters.regions,
    ...filters.issue_areas.map((issue) => issueAreaLabels[issue] ?? humanize(issue)),
  ];
  const [lead, ...rest] = labels.filter(Boolean);

  if (!lead) {
    return undefined;
  }

  return rest.length > 0 ? `${lead} + ${rest.length} more` : lead;
}

export function removeValue(values: string[], value: string): string[] {
  return values.filter((item) => item !== value);
}
