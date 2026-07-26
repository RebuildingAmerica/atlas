import {
  formatDateTimeOrInput,
  MEDIUM_DATE,
  type DateTimeFormatter,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import type {
  AtlasBrief,
  AtlasBriefExport,
  AtlasBriefExportEntry,
  AtlasBriefExportSource,
  AtlasBriefGap,
} from "@/domains/workspace/server/briefs";

interface CountLabelOptions {
  plural?: string;
}

interface BriefCsvRow {
  confidence_state: string;
  detail: string;
  discovery_run_count: string;
  entry_count: string;
  issue_areas: string;
  location: string;
  name: string;
  publication: string;
  published_date: string;
  record_id: string;
  record_type: string;
  research_goal: string;
  review_status: string;
  row_type: string;
  source_count: string;
  state: string;
  status: string;
  title: string;
  updated_at: string;
  url: string;
}

const BRIEF_CSV_COLUMNS: (keyof BriefCsvRow)[] = [
  "row_type",
  "record_id",
  "title",
  "name",
  "record_type",
  "detail",
  "url",
  "publication",
  "published_date",
  "location",
  "state",
  "issue_areas",
  "research_goal",
  "status",
  "confidence_state",
  "review_status",
  "source_count",
  "entry_count",
  "discovery_run_count",
  "updated_at",
];

export function countLabel(count: number, singular: string, options?: CountLabelOptions): string {
  const plural = options?.plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : plural}`;
}

export function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

export function joined(values: string[]): string {
  return values.map(humanize).join(", ");
}

export function entryLocation(entry: AtlasBriefExportEntry): string {
  return [entry.city, entry.state].filter(Boolean).join(", ");
}

export function sourceLabel(source: AtlasBriefExportSource): string {
  return source.title?.trim() || source.url;
}

/**
 * Renders a source date for the evidence pack.
 *
 * @param format - Formatter from `useDateTimeFormatter`.
 * @param value - Timestamp from the brief export, if the source carries one.
 * @returns The formatted date, the raw value when it will not parse, or `null`
 *   when the source has no date at all.
 */
export function formatDate(
  format: DateTimeFormatter,
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return formatDateTimeOrInput(format, value, MEDIUM_DATE);
}

export function confidenceVariant(state: AtlasBriefExport["provenance"]["confidence_state"]) {
  if (state === "corroborated") {
    return "success";
  }
  if (state === "partial") {
    return "warning";
  }
  return "default";
}

function fileSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return segment || "atlas-brief";
}

export function briefExportFilename(brief: AtlasBriefExport["brief"]): string {
  return `${fileSegment(brief.title)}-${brief.id}.json`;
}

export function briefExportCsvFilename(brief: AtlasBriefExport["brief"]): string {
  return `${fileSegment(brief.title)}-${brief.id}.csv`;
}

function briefCsvRow(rowType: string, values: Partial<BriefCsvRow>): BriefCsvRow {
  return {
    confidence_state: "",
    detail: "",
    discovery_run_count: "",
    entry_count: "",
    issue_areas: "",
    location: "",
    name: "",
    publication: "",
    published_date: "",
    record_id: "",
    record_type: "",
    research_goal: "",
    review_status: "",
    row_type: rowType,
    source_count: "",
    state: "",
    status: "",
    title: "",
    updated_at: "",
    url: "",
    ...values,
  };
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function csvLine(row: BriefCsvRow): string {
  return BRIEF_CSV_COLUMNS.map((column) => csvCell(row[column])).join(",");
}

export function briefExportToCsv(briefExport: AtlasBriefExport): string {
  const { brief, provenance } = briefExport;
  const rows: BriefCsvRow[] = [
    briefCsvRow("brief", {
      confidence_state: provenance.confidence_state,
      detail: brief.summary,
      discovery_run_count: String(provenance.discovery_run_count),
      entry_count: String(provenance.entry_count),
      issue_areas: brief.scope.issue_areas.join("; "),
      location: brief.scope.geography,
      record_id: brief.id,
      review_status: provenance.review_status,
      source_count: String(provenance.source_count),
      title: brief.title,
      updated_at: brief.updated_at,
    }),
    ...briefExport.entries.map((entry) =>
      briefCsvRow("entry", {
        location: entryLocation(entry),
        name: entry.name,
        record_id: entry.id,
        record_type: entry.type,
        state: entry.state ?? "",
      }),
    ),
    ...briefExport.sources.map((source) =>
      briefCsvRow("source", {
        publication: source.publication ?? "",
        published_date: source.published_date ?? "",
        record_id: source.id,
        record_type: source.type,
        title: source.title ?? "",
        updated_at: source.ingested_at,
        url: source.url,
      }),
    ),
    ...briefExport.discovery_runs.map((run) =>
      briefCsvRow("discovery_run", {
        issue_areas: run.issue_areas.join("; "),
        location: run.location_query,
        record_id: run.id,
        research_goal: run.research_goal,
        state: run.state,
        status: run.status,
      }),
    ),
    ...brief.gaps.map((gap) =>
      briefCsvRow("gap", {
        detail: gap.detail,
        title: gap.label,
      }),
    ),
    briefCsvRow("provenance", {
      confidence_state: provenance.confidence_state,
      discovery_run_count: String(provenance.discovery_run_count),
      entry_count: String(provenance.entry_count),
      review_status: provenance.review_status,
      source_count: String(provenance.source_count),
    }),
  ];

  return [BRIEF_CSV_COLUMNS.join(","), ...rows.map(csvLine)].join("\n") + "\n";
}

export function gapsToText(gaps: AtlasBriefGap[]): string {
  return gaps.map((gap) => `${gap.label}: ${gap.detail}`).join("\n");
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
      label: line.slice(0, separatorIndex).trim(),
      detail: line.slice(separatorIndex + 1).trim(),
    };
  });
}

export function editorStateFromBrief(brief: AtlasBrief) {
  return {
    confidenceState: brief.confidence_summary.state,
    gapsText: gapsToText(brief.gaps),
    reviewStatus: brief.confidence_summary.review_status,
    summary: brief.summary,
    title: brief.title,
  };
}

export function exportWithBrief(
  briefExport: AtlasBriefExport,
  brief: AtlasBrief,
): AtlasBriefExport {
  return {
    ...briefExport,
    brief,
    provenance: {
      ...briefExport.provenance,
      confidence_state: brief.confidence_summary.state,
      review_status: brief.confidence_summary.review_status,
    },
  };
}

function downloadTextFile(filename: string, content: string, mediaType: string) {
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
