import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  FileJson,
  ListPlus,
  MapPinned,
  Pencil,
  Printer,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAddSavedListItem, useSavedLists } from "@/domains/catalog/hooks/use-claims";
import {
  useRecordWorkspaceEvidenceOpen,
  useUpdateWorkspaceBrief,
} from "@/domains/workspace/hooks/use-briefs";
import type {
  AtlasBrief,
  AtlasBriefConfidenceState,
  AtlasBriefExport,
  AtlasBriefExportDiscoveryRun,
  AtlasBriefExportEntry,
  AtlasBriefExportSource,
  AtlasBriefGap,
  AtlasBriefUpdateInput,
} from "@/domains/workspace/server/briefs";
import { Badge } from "@/platform/ui/badge";
import { Select } from "@/platform/ui/select";

interface BriefDetailPageProps {
  briefExport: AtlasBriefExport;
}

interface CountLabelOptions {
  plural?: string;
}

interface SaveActorsPanelProps {
  briefTitle: string;
  entries: AtlasBriefExportEntry[];
}

interface SourcesPanelProps {
  onEvidenceOpen: (source: AtlasBriefExportSource) => void;
  sources: AtlasBriefExportSource[];
}

type SaveActorsStatus = "idle" | "saved" | "error";
type BriefEditStatus = "idle" | "saved" | "error";

const CONFIDENCE_STATE_OPTIONS: { label: string; value: AtlasBriefConfidenceState }[] = [
  { label: "corroborated", value: "corroborated" },
  { label: "partial", value: "partial" },
  { label: "unverified", value: "unverified" },
];

interface BriefEditorState {
  confidenceState: AtlasBriefConfidenceState;
  gapsText: string;
  reviewStatus: string;
  summary: string;
  title: string;
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

function countLabel(count: number, singular: string, options?: CountLabelOptions): string {
  const plural = options?.plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

function joined(values: string[]): string {
  return values.map(humanize).join(", ");
}

function entryLocation(entry: AtlasBriefExportEntry): string {
  return [entry.city, entry.state].filter(Boolean).join(", ");
}

function sourceLabel(source: AtlasBriefExportSource): string {
  return source.title?.trim() || source.url;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function confidenceVariant(state: AtlasBriefExport["provenance"]["confidence_state"]) {
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

function briefExportFilename(brief: AtlasBriefExport["brief"]): string {
  return `${fileSegment(brief.title)}-${brief.id}.json`;
}

function briefExportCsvFilename(brief: AtlasBriefExport["brief"]): string {
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

function briefExportToCsv(briefExport: AtlasBriefExport): string {
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

function gapsToText(gaps: AtlasBriefGap[]): string {
  return gaps.map((gap) => `${gap.label}: ${gap.detail}`).join("\n");
}

function parseGapsText(value: string): AtlasBriefGap[] {
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

function editorStateFromBrief(brief: AtlasBrief): BriefEditorState {
  return {
    confidenceState: brief.confidence_summary.state,
    gapsText: gapsToText(brief.gaps),
    reviewStatus: brief.confidence_summary.review_status,
    summary: brief.summary,
    title: brief.title,
  };
}

function exportWithBrief(briefExport: AtlasBriefExport, brief: AtlasBrief): AtlasBriefExport {
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

function downloadJsonFile(filename: string, content: string) {
  downloadTextFile(filename, content, "application/json;charset=utf-8");
}

function downloadCsvFile(filename: string, content: string) {
  downloadTextFile(filename, content, "text/csv;charset=utf-8");
}

function BriefScope({ briefExport }: BriefDetailPageProps) {
  const { scope } = briefExport.brief;

  return (
    <section className="border-outline-variant bg-surface-container-lowest grid gap-4 rounded-lg border p-5 md:grid-cols-4">
      <div className="space-y-1">
        <p className="type-label-small text-ink-muted">Place</p>
        <p className="type-title-small text-ink-strong">{scope.geography}</p>
      </div>
      <div className="space-y-1">
        <p className="type-label-small text-ink-muted">Issues</p>
        <p className="type-title-small text-ink-strong">{joined(scope.issue_areas)}</p>
      </div>
      <div className="space-y-1">
        <p className="type-label-small text-ink-muted">Actors</p>
        <p className="type-title-small text-ink-strong">{joined(scope.actor_types)}</p>
      </div>
      <div className="space-y-1">
        <p className="type-label-small text-ink-muted">Sources</p>
        <p className="type-title-small text-ink-strong">{joined(scope.source_types)}</p>
      </div>
    </section>
  );
}

function ConfidencePanel({ briefExport }: BriefDetailPageProps) {
  const { confidence_summary: confidence } = briefExport.brief;
  const { provenance } = briefExport;

  return (
    <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5 print:hidden">
      <div className="flex items-start gap-3">
        <ShieldCheck className="text-civic mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="space-y-2">
          <p className="type-label-small text-ink-muted">Confidence</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant={confidenceVariant(provenance.confidence_state)}>
              {provenance.confidence_state}
            </Badge>
            <Badge>{countLabel(confidence.source_count, "source")}</Badge>
            <Badge>{confidence.review_status}</Badge>
          </div>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="type-label-small text-ink-muted">Linked actors</dt>
          <dd className="type-title-small text-ink-strong">
            {countLabel(provenance.entry_count, "actor")}
          </dd>
        </div>
        <div>
          <dt className="type-label-small text-ink-muted">Source receipts</dt>
          <dd className="type-title-small text-ink-strong">
            {countLabel(provenance.source_count, "source receipt")}
          </dd>
        </div>
        <div>
          <dt className="type-label-small text-ink-muted">Research runs</dt>
          <dd className="type-title-small text-ink-strong">
            {countLabel(provenance.discovery_run_count, "run")}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function GapsPanel({ gaps }: { gaps: AtlasBriefGap[] }) {
  if (gaps.length === 0) {
    return null;
  }

  return (
    <section className="border-outline-variant bg-surface-container-lowest space-y-3 rounded-lg border p-5">
      <h2 className="type-title-large text-ink-strong">Known gaps</h2>
      <ul className="space-y-3">
        {gaps.map((gap) => (
          <li key={`${gap.label}-${gap.detail}`} className="border-border border-l-2 pl-3">
            <p className="type-title-small text-ink-strong">{gap.label}</p>
            <p className="type-body-medium text-ink-soft">{gap.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActorsPanel({ entries }: { entries: AtlasBriefExportEntry[] }) {
  return (
    <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
      <div className="flex items-center gap-2">
        <MapPinned className="text-civic h-5 w-5" aria-hidden="true" />
        <h2 className="type-title-large text-ink-strong">Linked actors</h2>
      </div>
      {entries.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {entries.map((entry) => (
            <li key={entry.id} className="border-border rounded-lg border p-3">
              <p className="type-title-small text-ink-strong">{entry.name}</p>
              <p className="type-body-small text-ink-soft">
                {humanize(entry.type)}
                {entryLocation(entry) ? ` - ${entryLocation(entry)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-body-medium text-ink-soft">No people or groups linked.</p>
      )}
    </section>
  );
}

function SaveActorsPanel({ briefTitle, entries }: SaveActorsPanelProps) {
  const lists = useSavedLists();
  const addSavedListItem = useAddSavedListItem();
  const [selectedListId, setSelectedListId] = useState("");
  const [status, setStatus] = useState<SaveActorsStatus>("idle");

  const availableLists = lists.data ?? [];
  const targetListId = selectedListId || availableLists[0]?.id || "";
  const targetList = availableLists.find((list) => list.id === targetListId);

  if (entries.length === 0) {
    return null;
  }

  async function saveActors() {
    if (!targetListId) {
      return;
    }

    setStatus("idle");
    try {
      for (const entry of entries) {
        await addSavedListItem.mutateAsync({
          listId: targetListId,
          body: {
            entry_id: entry.id,
            note: `From Atlas Brief: ${briefTitle}`,
          },
        });
      }
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
      <div className="flex items-center gap-2">
        <ListPlus className="text-civic h-5 w-5" aria-hidden="true" />
        <h2 className="type-title-large text-ink-strong">Save linked actors</h2>
      </div>

      {availableLists.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select
            label="Target list"
            icon={ListPlus}
            size="compact"
            value={targetListId}
            onChange={(value) => {
              setSelectedListId(value);
              setStatus("idle");
            }}
            options={availableLists.map((list) => ({
              label: list.name,
              value: list.id,
            }))}
          />
          <button
            type="button"
            disabled={!targetListId || addSavedListItem.isPending}
            onClick={() => {
              void saveActors();
            }}
            className="type-label-large bg-ink-strong text-surface hover:bg-ink disabled:bg-surface-container-high disabled:text-ink-muted inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-lg px-4 transition-colors"
          >
            {status === "saved" ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ListPlus className="h-4 w-4" aria-hidden="true" />
            )}
            Save {countLabel(entries.length, "actor")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="type-body-medium text-ink-soft">No lists yet.</p>
          <Link
            to="/lists"
            className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center rounded-lg px-4 transition-colors"
          >
            New list
          </Link>
        </div>
      )}

      {status === "saved" && targetList ? (
        <p className="type-body-small text-green-700">
          Saved {countLabel(entries.length, "actor")} to {targetList.name}.
        </p>
      ) : null}
      {status === "error" ? (
        <p className="type-body-small text-rose-700" role="alert">
          Could not save actors to list.
        </p>
      ) : null}
    </section>
  );
}

function SourcesPanel({ onEvidenceOpen, sources }: SourcesPanelProps) {
  return (
    <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
      <h2 className="type-title-large text-ink-strong">Evidence Pack</h2>
      {sources.length > 0 ? (
        <ul className="divide-border divide-y">
          {sources.map((source) => {
            const published = formatDate(source.published_date);
            const ingested = formatDate(source.ingested_at);
            return (
              <li key={source.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    onEvidenceOpen(source);
                  }}
                  className="type-title-small text-civic hover:text-civic-deep inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                >
                  {sourceLabel(source)}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <div className="type-body-small text-ink-soft flex flex-wrap gap-x-3 gap-y-1">
                  <span>{source.publication ?? "Unknown publication"}</span>
                  <span>{humanize(source.type)}</span>
                  {published ? <span>{published}</span> : null}
                  {ingested ? <span>Ingested {ingested}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="type-body-medium text-ink-soft">No source receipts.</p>
      )}
    </section>
  );
}

function DiscoveryRunsPanel({ runs }: { runs: AtlasBriefExportDiscoveryRun[] }) {
  if (runs.length === 0) {
    return null;
  }

  return (
    <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
      <h2 className="type-title-large text-ink-strong">Context</h2>
      <ul className="space-y-3">
        {runs.map((run) => (
          <li key={run.id} className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="type-title-small text-ink-strong">{run.location_query}</p>
              <p className="type-body-small text-ink-soft">{joined(run.issue_areas)}</p>
            </div>
            <div className="flex flex-wrap items-start gap-2 sm:justify-end">
              <Badge>{humanize(run.research_goal)}</Badge>
              <Badge variant={run.status === "completed" ? "success" : "default"}>
                {humanize(run.status)}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BriefDetailPage({ briefExport }: BriefDetailPageProps) {
  const [copied, setCopied] = useState(false);
  const [brief, setBrief] = useState(briefExport.brief);
  const [isEditing, setIsEditing] = useState(false);
  const [editStatus, setEditStatus] = useState<BriefEditStatus>("idle");
  const [editError, setEditError] = useState("");
  const [editorState, setEditorState] = useState<BriefEditorState>(() =>
    editorStateFromBrief(briefExport.brief),
  );
  const updateBrief = useUpdateWorkspaceBrief();
  const recordEvidenceOpen = useRecordWorkspaceEvidenceOpen();
  const currentExport = useMemo(() => exportWithBrief(briefExport, brief), [briefExport, brief]);
  const exportJson = useMemo(() => JSON.stringify(currentExport, null, 2), [currentExport]);
  const exportCsv = useMemo(() => briefExportToCsv(currentExport), [currentExport]);
  const exportFilename = useMemo(() => briefExportFilename(brief), [brief]);
  const exportCsvFilename = useMemo(() => briefExportCsvFilename(brief), [brief]);

  useEffect(() => {
    setBrief(briefExport.brief);
    setEditorState(editorStateFromBrief(briefExport.brief));
  }, [briefExport.brief]);

  async function copyExportJson() {
    if (typeof navigator === "undefined") {
      return;
    }
    await navigator.clipboard?.writeText(exportJson);
    setCopied(true);
  }

  function downloadExportJson() {
    downloadJsonFile(exportFilename, exportJson);
  }

  function downloadExportCsv() {
    downloadCsvFile(exportCsvFilename, exportCsv);
  }

  function printBrief() {
    if (typeof window === "undefined" || typeof window.print !== "function") {
      return;
    }
    window.print();
  }

  function recordSourceEvidenceOpen(source: AtlasBriefExportSource) {
    recordEvidenceOpen.mutate({
      sourceId: source.id,
      surface: "brief",
    });
  }

  function beginEditing() {
    setEditorState(editorStateFromBrief(brief));
    setEditError("");
    setEditStatus("idle");
    setIsEditing(true);
  }

  async function saveBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditError("");
    setEditStatus("idle");

    try {
      const input: AtlasBriefUpdateInput = {
        confidence_summary: {
          ...brief.confidence_summary,
          review_status: editorState.reviewStatus.trim(),
          state: editorState.confidenceState,
        },
        gaps: parseGapsText(editorState.gapsText),
        summary: editorState.summary.trim(),
        title: editorState.title.trim(),
      };
      const updated = await updateBrief.mutateAsync({ briefId: brief.id, ...input });
      setBrief(updated);
      setEditorState(editorStateFromBrief(updated));
      setEditStatus("saved");
      setIsEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not update brief.");
      setEditStatus("error");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6 print:max-w-none print:space-y-5 print:bg-white print:py-0 print:text-black">
      <Link
        to="/discovery"
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors print:hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Research
      </Link>

      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] print:grid-cols-1">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">Atlas Brief</Badge>
            <Badge variant={confidenceVariant(currentExport.provenance.confidence_state)}>
              {currentExport.provenance.confidence_state}
            </Badge>
          </div>
          {isEditing ? (
            <form className="space-y-4" onSubmit={(event) => void saveBrief(event)}>
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Brief title</span>
                <input
                  required
                  value={editorState.title}
                  onChange={(event) => {
                    setEditorState((current) => ({ ...current, title: event.target.value }));
                  }}
                  className="border-outline-variant bg-surface text-ink-strong type-title-large min-h-11 w-full rounded-lg border px-3"
                />
              </label>
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Brief summary</span>
                <textarea
                  required
                  value={editorState.summary}
                  onChange={(event) => {
                    setEditorState((current) => ({ ...current, summary: event.target.value }));
                  }}
                  className="border-outline-variant bg-surface text-ink-strong type-body-medium min-h-28 w-full rounded-lg border px-3 py-2"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Confidence state"
                  icon={ShieldCheck}
                  size="compact"
                  value={editorState.confidenceState}
                  onChange={(value) => {
                    setEditorState((current) => ({
                      ...current,
                      confidenceState: value as AtlasBriefConfidenceState,
                    }));
                  }}
                  options={CONFIDENCE_STATE_OPTIONS}
                />
                <label className="block space-y-1">
                  <span className="type-label-small text-ink-muted">Review status</span>
                  <input
                    required
                    value={editorState.reviewStatus}
                    onChange={(event) => {
                      setEditorState((current) => ({
                        ...current,
                        reviewStatus: event.target.value,
                      }));
                    }}
                    className="border-outline-variant bg-surface text-ink-strong type-body-medium min-h-10 w-full rounded-lg border px-3"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Known gaps</span>
                <textarea
                  value={editorState.gapsText}
                  onChange={(event) => {
                    setEditorState((current) => ({ ...current, gapsText: event.target.value }));
                  }}
                  className="border-outline-variant bg-surface text-ink-strong type-body-medium min-h-24 w-full rounded-lg border px-3 py-2"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={updateBrief.isPending}
                  className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors disabled:opacity-60"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  Save brief
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setEditorState(editorStateFromBrief(brief));
                    setEditError("");
                  }}
                  className="type-label-large border-outline-variant text-ink-strong hover:bg-surface-container inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 transition-colors"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Cancel
                </button>
              </div>
              {editStatus === "error" ? (
                <p className="type-body-small text-rose-700" role="alert">
                  {editError || "Could not update brief."}
                </p>
              ) : null}
            </form>
          ) : (
            <div className="space-y-3">
              <h1 className="type-display-small text-ink-strong">{brief.title}</h1>
              <p className="type-body-large text-ink-soft max-w-3xl">{brief.summary}</p>
              <button
                type="button"
                onClick={beginEditing}
                className="type-label-large border-outline-variant text-ink-strong hover:bg-surface-container inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 transition-colors print:hidden"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit brief
              </button>
              {editStatus === "saved" ? (
                <p className="type-body-small text-green-700">Brief updated.</p>
              ) : null}
            </div>
          )}
        </div>

        <div className="border-outline-variant bg-surface-container-lowest flex flex-col justify-between gap-5 rounded-lg border p-5 print:hidden">
          <div className="space-y-1">
            <p className="type-label-small text-ink-muted">Export</p>
            <p className="type-body-medium text-ink-soft">
              JSON and CSV with actors, source receipts, research context, and confidence.
            </p>
          </div>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                printBrief();
              }}
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print brief
            </button>
            <button
              type="button"
              onClick={() => {
                downloadExportJson();
              }}
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download JSON
            </button>
            <button
              type="button"
              onClick={() => {
                downloadExportCsv();
              }}
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => {
                void copyExportJson();
              }}
              className="type-label-large border-outline-variant text-ink-strong hover:bg-surface-container inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 transition-colors"
            >
              {copied ? (
                <Clipboard className="h-4 w-4" aria-hidden="true" />
              ) : (
                <FileJson className="h-4 w-4" aria-hidden="true" />
              )}
              Copy JSON
            </button>
          </div>
        </div>
      </header>

      <BriefScope briefExport={currentExport} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <ConfidencePanel briefExport={currentExport} />
          <GapsPanel gaps={brief.gaps} />
          <SaveActorsPanel briefTitle={brief.title} entries={currentExport.entries} />
          <ActorsPanel entries={currentExport.entries} />
        </div>
        <div className="space-y-5">
          <SourcesPanel
            onEvidenceOpen={(source) => {
              recordSourceEvidenceOpen(source);
            }}
            sources={currentExport.sources}
          />
          <DiscoveryRunsPanel runs={currentExport.discovery_runs} />
        </div>
      </div>
    </div>
  );
}
