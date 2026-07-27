import { useDateTimeFormatter } from "@rebuildingamerica/atlas-ui/format/date-time";
import { Link } from "@tanstack/react-router";
import { Check, ExternalLink, ListPlus, MapPinned, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAddSavedListItem, useSavedLists } from "@/domains/catalog/hooks/use-claims";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { Select } from "@rebuildingamerica/atlas-ui/ui/select";
import type {
  AtlasBriefExport,
  AtlasBriefExportDiscoveryRun,
  AtlasBriefExportEntry,
  AtlasBriefExportSource,
  AtlasBriefGap,
} from "@/domains/workspace/server/briefs";
import {
  confidenceVariant,
  countLabel,
  entryLocation,
  formatDate,
  humanize,
  joined,
  sourceLabel,
} from "./brief-detail-page-utils";

interface BriefExportPanelProps {
  briefExport: AtlasBriefExport;
}

interface GapsPanelProps {
  gaps: AtlasBriefGap[];
}

interface SaveActorsPanelProps {
  briefTitle: string;
  entries: AtlasBriefExportEntry[];
}

interface SourcesPanelProps {
  onEvidenceOpen: (source: AtlasBriefExportSource) => void;
  sources: AtlasBriefExportSource[];
}

interface DiscoveryRunsPanelProps {
  runs: AtlasBriefExportDiscoveryRun[];
}

type SaveActorsStatus = "idle" | "saved" | "error";

export function BriefScope({ briefExport }: BriefExportPanelProps) {
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

export function ConfidencePanel({ briefExport }: BriefExportPanelProps) {
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

export function GapsPanel({ gaps }: GapsPanelProps) {
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

export function ActorsPanel({ entries }: { entries: AtlasBriefExportEntry[] }) {
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

export function SaveActorsPanel({ briefTitle, entries }: SaveActorsPanelProps) {
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

  // `targetListId` is non-empty wherever this button renders: the panel only
  // shows it once `availableLists` has a first list to fall back to.
  async function saveActors() {
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

export function SourcesPanel({ onEvidenceOpen, sources }: SourcesPanelProps) {
  const formatDateTime = useDateTimeFormatter();

  return (
    <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
      <h2 className="type-title-large text-ink-strong">Evidence Pack</h2>
      {sources.length > 0 ? (
        <ul className="divide-border divide-y">
          {sources.map((source) => {
            const published = formatDate(formatDateTime, source.published_date);
            const ingested = formatDate(formatDateTime, source.ingested_at);
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

export function DiscoveryRunsPanel({ runs }: DiscoveryRunsPanelProps) {
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
