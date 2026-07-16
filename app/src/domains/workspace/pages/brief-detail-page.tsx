import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Clipboard,
  Download,
  FileJson,
  Pencil,
  Printer,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  useRecordWorkspaceEvidenceOpen,
  useUpdateWorkspaceBrief,
} from "@/domains/workspace/hooks/use-briefs";
import type { AtlasBriefExport, AtlasBriefUpdateInput } from "@/domains/workspace/server/briefs";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { Select } from "@rebuildingamerica/atlas-ui/ui/select";
import {
  briefExportCsvFilename,
  briefExportFilename,
  briefExportToCsv,
  downloadCsvFile,
  downloadJsonFile,
  editorStateFromBrief,
  exportWithBrief,
  parseGapsText,
} from "./brief-detail-page-utils";
import {
  ActorsPanel,
  BriefScope,
  ConfidencePanel,
  DiscoveryRunsPanel,
  GapsPanel,
  SaveActorsPanel,
  SourcesPanel,
} from "./brief-detail-page-panels";

interface BriefDetailPageProps {
  briefExport: AtlasBriefExport;
}

type BriefEditStatus = "idle" | "saved" | "error";

function DownloadButton({
  children,
  onClick,
  icon: Icon,
}: {
  children: string;
  icon: typeof Download;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
  );
}

export function BriefDetailPage({ briefExport }: BriefDetailPageProps) {
  const [copied, setCopied] = useState(false);
  const [brief, setBrief] = useState(briefExport.brief);
  const [isEditing, setIsEditing] = useState(false);
  const [editStatus, setEditStatus] = useState<BriefEditStatus>("idle");
  const [editError, setEditError] = useState("");
  const [editorState, setEditorState] = useState(() => editorStateFromBrief(briefExport.brief));
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
            <Badge
              variant={
                currentExport.provenance.confidence_state === "corroborated"
                  ? "success"
                  : currentExport.provenance.confidence_state === "partial"
                    ? "warning"
                    : "default"
              }
            >
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
                      confidenceState: value as AtlasBriefExport["provenance"]["confidence_state"],
                    }));
                  }}
                  options={[
                    { label: "corroborated", value: "corroborated" },
                    { label: "partial", value: "partial" },
                    { label: "unverified", value: "unverified" },
                  ]}
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
            <DownloadButton icon={Printer} onClick={printBrief}>
              Print brief
            </DownloadButton>
            <DownloadButton icon={Download} onClick={downloadExportJson}>
              Download JSON
            </DownloadButton>
            <DownloadButton icon={Download} onClick={downloadExportCsv}>
              Download CSV
            </DownloadButton>
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
              recordEvidenceOpen.mutate({
                sourceId: source.id,
                surface: "brief",
              });
            }}
            sources={currentExport.sources}
          />
          <DiscoveryRunsPanel runs={currentExport.discovery_runs} />
        </div>
      </div>
    </div>
  );
}
