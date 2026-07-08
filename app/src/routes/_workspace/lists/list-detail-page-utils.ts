export interface ResearchThreadSummary {
  actorCount: number;
  noteCount: number;
  sourceCount: number;
  followUps: string[];
}

export interface ProjectMetadata {
  status: string;
  owner: string;
  lastUpdated: string;
}

export interface SavedListThreadItem {
  list_id?: string | null;
  entry_id: string;
  note?: string | null;
  added_at?: string | null;
  entry?: {
    address?: {
      city?: string | null;
      display?: string | null;
      state?: string | null;
    } | null;
    name?: string | null;
    photo_url?: string | null;
    slug?: string | null;
    source_count?: number | null;
    type?: string | null;
  } | null;
}

export interface CrmLeadPacket {
  entryId: string;
  name: string;
  type: string;
  location: string;
  sourceCount: number;
  note: string;
  syncStatus: "ready_for_sync";
  nextAction: string;
}

export interface CrmHandoffPacket {
  workspace: string;
  list: string;
  leads: CrmLeadPacket[];
}

export function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function fileSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return segment || "atlas-list";
}

export function projectStatusForThread(summary: ResearchThreadSummary): string {
  if (summary.actorCount === 0) {
    return "Draft";
  }
  if (summary.sourceCount === 0) {
    return "Needs sources";
  }
  if (summary.noteCount < summary.actorCount) {
    return "Needs notes";
  }
  return "Ready for outreach";
}

export function formatProjectDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function savedListJsonFilename(listName: string, listId: string): string {
  return `${fileSegment(listName)}-list-${listId}.json`;
}

export function savedListCsvFilename(listName: string, listId: string): string {
  return `${fileSegment(listName)}-list-${listId}.csv`;
}

export function savedListInstitutionalCsvFilename(listName: string, listId: string): string {
  return `${fileSegment(listName)}-institutional-${listId}.csv`;
}

export function savedListCrmFilename(listName: string, listId: string): string {
  return `${fileSegment(listName)}-crm-${listId}.json`;
}

export function downloadTextFile(filename: string, content: string, mediaType: string) {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }

  const blob = new Blob([content], { type: mediaType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function downloadJsonFile(filename: string, content: string) {
  downloadTextFile(filename, content, "application/json;charset=utf-8");
}

export function downloadCsvFile(filename: string, content: string) {
  downloadTextFile(filename, content, "text/csv;charset=utf-8");
}

export function buildProjectMetadata(
  items: SavedListThreadItem[],
  updatedAt: string,
  owner: string,
): ProjectMetadata {
  const summary = buildResearchThreadSummary(items);
  return {
    status: projectStatusForThread(summary),
    owner,
    lastUpdated: formatProjectDate(updatedAt),
  };
}

export function buildResearchThreadSummary(items: SavedListThreadItem[]): ResearchThreadSummary {
  const actorCount = items.length;
  const noteCount = items.filter((item) => Boolean(item.note?.trim())).length;
  const sourceCount = items.reduce((sum, item) => sum + (item.entry?.source_count ?? 0), 0);
  const unsortedCount = actorCount - noteCount;
  const followUps = ["Review latest source trail"];
  if (unsortedCount > 0) {
    followUps.push("Add notes for unsorted leads");
  }
  if (sourceCount === 0 && actorCount > 0) {
    followUps.push("Check source coverage");
  }
  return { actorCount, noteCount, sourceCount, followUps };
}

export function evidenceLocation(item: SavedListThreadItem): string {
  const city = item.entry?.address?.city ?? null;
  const state = item.entry?.address?.state ?? null;
  if (city && state) {
    return `${city}, ${state}`;
  }
  return state ?? "Location not specified";
}

export function buildEvidencePack(
  name: string,
  description: string | null,
  items: SavedListThreadItem[],
): string {
  const lines = [`${name} evidence pack`];
  if (description) {
    lines.push(description);
  }
  lines.push("");
  if (items.length === 0) {
    lines.push("No saved actors yet.");
    return lines.join("\n");
  }

  items.forEach((item) => {
    const actorName = item.entry?.name ?? "Profile unavailable";
    const sourceCount = item.entry?.source_count ?? 0;
    const sourceLabel = sourceCount === 1 ? "source" : "sources";
    lines.push(`${actorName} — ${evidenceLocation(item)} — ${sourceCount} ${sourceLabel}`);
    if (item.note) {
      lines.push(`Note: ${item.note}`);
    }
  });
  return lines.join("\n");
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function buildSpreadsheetExport(items: SavedListThreadItem[]): string {
  const rows = [["name", "type", "location", "source_count", "note"].join(",")];
  items.forEach((item) => {
    const actor = item.entry;
    rows.push(
      [
        csvCell(actor?.name ?? "Profile unavailable"),
        csvCell(actor?.type ?? ""),
        csvCell(evidenceLocation(item)),
        csvCell(actor?.source_count ?? 0),
        csvCell(item.note ?? ""),
      ].join(","),
    );
  });
  return rows.join("\n");
}

export function firstNextAction(followUps: string[]): string {
  return followUps[0] ?? "Review lead";
}

export function buildInstitutionalExport(
  workspaceName: string,
  listName: string,
  items: SavedListThreadItem[],
  followUps: string[],
): string {
  const nextAction = firstNextAction(followUps);
  const rows = [
    [
      "workspace",
      "list",
      "entry_id",
      "name",
      "type",
      "location",
      "source_count",
      "note",
      "crm_status",
      "next_action",
    ].join(","),
  ];
  items.forEach((item) => {
    const actor = item.entry;
    rows.push(
      [
        csvCell(workspaceName),
        csvCell(listName),
        csvCell(item.entry_id),
        csvCell(actor?.name ?? "Profile unavailable"),
        csvCell(actor?.type ?? ""),
        csvCell(evidenceLocation(item)),
        csvCell(actor?.source_count ?? 0),
        csvCell(item.note ?? ""),
        csvCell("ready_for_sync"),
        csvCell(nextAction),
      ].join(","),
    );
  });
  return rows.join("\n");
}

export function buildCrmHandoffPacket(
  workspaceName: string,
  listName: string,
  items: SavedListThreadItem[],
  followUps: string[],
): CrmHandoffPacket {
  const nextAction = firstNextAction(followUps);
  return {
    workspace: workspaceName,
    list: listName,
    leads: items.map((item) => {
      const actor = item.entry;
      return {
        entryId: item.entry_id,
        name: actor?.name ?? "Profile unavailable",
        type: actor?.type ?? "",
        location: evidenceLocation(item),
        sourceCount: actor?.source_count ?? 0,
        note: item.note ?? "",
        syncStatus: "ready_for_sync",
        nextAction,
      };
    }),
  };
}
