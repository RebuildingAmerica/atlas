import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useCreateWorkspaceBrief } from "@/domains/workspace/hooks/use-briefs";
import { useSavedLists } from "@/domains/catalog/hooks/use-claims";
import { useDiscoveryRuns } from "@/domains/discovery/hooks/use-discovery";
import type { AtlasBriefConfidenceState } from "@/domains/workspace/server/briefs";
import { exportSavedList } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import type {
  SavedListExportItemResponse,
  SavedListExportSource,
} from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { Select } from "@rebuildingamerica/atlas-ui/ui/select";
import type { BriefCreateStateFields } from "./brief-create-page-utils";
import {
  buildBriefCreateInput,
  countLabel,
  CONFIDENCE_STATE_OPTIONS,
  evidenceCounts,
  fieldClassName,
  initialFormState,
  KNOWN_GAP_FORMAT,
  textAreaClassName,
} from "./brief-create-page-utils";

type BriefCreateFormState = BriefCreateStateFields;

interface BriefCreatePageProps {
  initialListId?: string;
}

export function BriefCreatePage({ initialListId = "" }: BriefCreatePageProps) {
  const navigate = useNavigate();
  const createBrief = useCreateWorkspaceBrief();
  const savedLists = useSavedLists();
  const discoveryRuns = useDiscoveryRuns();
  const knownGapsId = useId();
  const [formState, setFormState] = useState<BriefCreateFormState>(initialFormState);
  const [error, setError] = useState("");
  const [selectedListId, setSelectedListId] = useState(initialListId);
  const [chosenActorIds, setChosenActorIds] = useState<string[] | null>(null);
  const [chosenSourceIds, setChosenSourceIds] = useState<string[]>([]);
  const [chosenRunIds, setChosenRunIds] = useState<string[]>([]);
  const listExport = useQuery({
    enabled: Boolean(selectedListId),
    queryKey: ["brief", "list-evidence", selectedListId],
    queryFn: () => exportSavedList(selectedListId),
  });
  const listItems = listExport.data?.items ?? [];
  const availableItems = listItems.filter((item) => item.entry);
  const selectedActorIds = chosenActorIds ?? availableItems.map((item) => item.entry_id);
  const selectedItems = availableItems.filter((item) => selectedActorIds.includes(item.entry_id));
  const sourceCandidates = uniqueSources(selectedItems);
  const selectedSources = sourceCandidates.filter((source) => chosenSourceIds.includes(source.id));
  const draftState = {
    ...formState,
    actorTypes: uniqueValues(selectedItems.map((item) => item.entry?.type)).join(", "),
    linkedDiscoveryRunIds: chosenRunIds.join(", "),
    linkedEntryIds: selectedActorIds.join(", "),
    linkedSourceIds: selectedSources.map((source) => source.id).join(", "),
    sourceTypes: uniqueValues(selectedSources.map((source) => source.type)).join(", "),
  };
  const counts = evidenceCounts(draftState);

  function updateField<Key extends keyof BriefCreateFormState>(
    key: Key,
    value: BriefCreateFormState[Key],
  ) {
    setFormState((current) => ({ ...current, [key]: value }));
    setError("");
  }

  async function createManualBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!selectedListId || !listExport.data) {
      setError("Choose a saved list with people or groups to include.");
      return;
    }
    if (selectedActorIds.length === 0) {
      setError("Choose at least one person or group.");
      return;
    }
    if (selectedSources.length === 0) {
      setError("Choose at least one source receipt from your saved profiles.");
      return;
    }
    if (selectedSources.some((source) => !source.type)) {
      setError("A selected source is missing its type. Choose another receipt.");
      return;
    }

    // Only the form validator's own message is safe to show: it names the
    // field the author still has to fill in.
    const draft = buildBriefCreateInput(draftState);
    if (draft.input === null) {
      setError(draft.problem);
      return;
    }

    try {
      const brief = await createBrief.mutateAsync(draft.input);
      void navigate({
        params: { briefId: brief.id },
        to: "/briefs/$briefId",
      });
    } catch {
      // The rejection carries an internal Atlas API code, never reader copy.
      setError("Could not create brief. Try again in a moment.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6">
      <Link
        to="/briefs"
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Atlas Briefs
      </Link>

      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">Briefing Room</Badge>
          </div>
          <div className="space-y-2">
            <h1 className="type-display-small text-ink-strong">New Atlas Brief</h1>
            <p className="type-body-large text-ink-soft max-w-3xl">
              A memo, meeting packet, or field note with receipts attached.
            </p>
          </div>
        </div>

        <section className="border-outline-variant bg-surface-container-lowest space-y-3 rounded-lg border p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-civic h-5 w-5" aria-hidden="true" />
            <h2 className="type-title-medium text-ink-strong">Evidence</h2>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="type-label-small text-ink-muted">Actors</dt>
              <dd className="type-title-small text-ink-strong">{counts.actorCount}</dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Sources</dt>
              <dd className="type-title-small text-ink-strong">{counts.sourceCount}</dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Runs</dt>
              <dd className="type-title-small text-ink-strong">{counts.runCount}</dd>
            </div>
          </dl>
        </section>
      </header>

      <form
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
        onSubmit={(event) => void createManualBrief(event)}
      >
        <div className="space-y-5">
          <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
            <div className="flex items-center gap-2">
              <FileText className="text-civic h-5 w-5" aria-hidden="true" />
              <h2 className="type-title-large text-ink-strong">Brief</h2>
            </div>
            <label className="block space-y-1">
              <span className="type-label-small text-ink-muted">Brief title</span>
              <input
                required
                value={formState.title}
                onChange={(event) => {
                  updateField("title", event.target.value);
                }}
                className={fieldClassName()}
              />
            </label>
            <label className="block space-y-1">
              <span className="type-label-small text-ink-muted">Brief summary</span>
              <textarea
                required
                value={formState.summary}
                onChange={(event) => {
                  updateField("summary", event.target.value);
                }}
                className={textAreaClassName("min-h-32")}
              />
            </label>
          </section>

          <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
            <h2 className="type-title-large text-ink-strong">Scope</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Place</span>
                <input
                  required
                  value={formState.geography}
                  onChange={(event) => {
                    updateField("geography", event.target.value);
                  }}
                  className={fieldClassName()}
                />
              </label>
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Issues</span>
                <input
                  required
                  value={formState.issueAreas}
                  onChange={(event) => {
                    updateField("issueAreas", event.target.value);
                  }}
                  className={fieldClassName()}
                />
              </label>
            </div>
          </section>

          <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
            <h2 className="type-title-large text-ink-strong">People and sources</h2>
            <label className="block space-y-1">
              <span className="type-label-small text-ink-muted">Saved list</span>
              <select
                value={selectedListId}
                onChange={(event) => {
                  setSelectedListId(event.target.value);
                  setChosenActorIds(null);
                  setChosenSourceIds([]);
                  setError("");
                }}
                className={fieldClassName()}
              >
                <option value="">Choose a list</option>
                {(savedLists.data ?? []).map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.item_count ?? 0})
                  </option>
                ))}
              </select>
            </label>
            {savedLists.isError ? (
              <p className="type-body-small text-ink-soft">Saved lists could not load.</p>
            ) : savedLists.data?.length === 0 ? (
              <p className="type-body-small text-ink-soft">
                No saved lists yet.{" "}
                <Link to="/browse" className="underline">
                  Explore people and groups
                </Link>
                .
              </p>
            ) : null}
            {listExport.isError ? (
              <div className="space-y-1">
                <p className="type-body-small text-ink-soft">This list could not load.</p>
                <button
                  type="button"
                  onClick={() => void listExport.refetch()}
                  className="type-label-medium text-accent hover:underline"
                >
                  Try loading this list again
                </button>
              </div>
            ) : listExport.isPending && selectedListId ? (
              <p className="type-body-small text-ink-soft">Loading saved profiles…</p>
            ) : null}
            {listExport.data && listItems.length === 0 ? (
              <p className="type-body-small text-ink-soft">This list has no saved profiles.</p>
            ) : null}
            {listItems.length > 0 && availableItems.length === 0 ? (
              <p className="type-body-small text-ink-soft">
                Saved profiles in this list are unavailable.
              </p>
            ) : null}
            {availableItems.length > 0 ? (
              <fieldset className="space-y-2">
                <legend className="type-label-medium text-ink-strong">
                  Include people and groups
                </legend>
                {availableItems.map((item) => (
                  <label
                    key={item.entry_id}
                    className="type-body-medium text-ink-strong flex items-start gap-2"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedActorIds.includes(item.entry_id)}
                      onChange={() => {
                        setChosenActorIds(toggleSelection(selectedActorIds, item.entry_id));
                        setError("");
                      }}
                    />
                    {item.entry?.name ?? "Unavailable profile"}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {selectedItems.length > 0 ? (
              <fieldset className="space-y-2">
                <legend className="type-label-medium text-ink-strong">
                  Attach source receipts
                </legend>
                {sourceCandidates.length > 0 ? (
                  sourceCandidates.map((source) => (
                    <div
                      key={source.id}
                      className="border-border flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
                    >
                      <label className="type-body-small text-ink-strong flex min-w-0 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={chosenSourceIds.includes(source.id)}
                          onChange={() => {
                            setChosenSourceIds((current) => toggleSelection(current, source.id));
                            setError("");
                          }}
                        />
                        <span className="break-words">
                          {source.title || source.publication || source.url}
                        </span>
                      </label>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="type-label-small text-accent break-all"
                      >
                        Open source
                      </a>
                    </div>
                  ))
                ) : (
                  <p className="type-body-small text-ink-soft">
                    No source receipts are linked to these profiles.
                  </p>
                )}
              </fieldset>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="type-label-medium text-ink-strong">Earlier research</legend>
              {(discoveryRuns.data?.items ?? [])
                .filter((run) => run.status === "completed")
                .map((run) => (
                  <label
                    key={run.id}
                    className="type-body-small text-ink-strong flex items-start gap-2"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={chosenRunIds.includes(run.id)}
                      onChange={() => {
                        setChosenRunIds((current) => toggleSelection(current, run.id));
                        setError("");
                      }}
                    />
                    {run.location_query} · {run.issue_areas.join(", ")}
                  </label>
                ))}
              {discoveryRuns.isError ? (
                <p className="type-body-small text-ink-soft">Earlier research could not load.</p>
              ) : null}
            </fieldset>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
            <h2 className="type-title-large text-ink-strong">Review</h2>
            <Select
              label="Confidence state"
              icon={ShieldCheck}
              size="compact"
              value={formState.confidenceState}
              onChange={(value) => {
                updateField("confidenceState", value as AtlasBriefConfidenceState);
              }}
              options={CONFIDENCE_STATE_OPTIONS}
            />
            <label className="block space-y-1">
              <span className="type-label-small text-ink-muted">Review status</span>
              <input
                required
                value={formState.reviewStatus}
                onChange={(event) => {
                  updateField("reviewStatus", event.target.value);
                }}
                className={fieldClassName()}
              />
            </label>
            <div className="block space-y-1">
              <label htmlFor={knownGapsId} className="type-label-small text-ink-muted">
                Known gaps
              </label>
              <span className="bg-surface-container-low flex items-center justify-between gap-3 rounded-lg px-3 py-2">
                <span className="type-label-small text-ink-muted">Gap format</span>
                <code className="type-body-small text-ink-strong font-mono">
                  {KNOWN_GAP_FORMAT}
                </code>
              </span>
              <textarea
                id={knownGapsId}
                value={formState.gapsText}
                onChange={(event) => {
                  updateField("gapsText", event.target.value);
                }}
                className={textAreaClassName("min-h-32")}
              />
            </div>
          </section>

          <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
            <h2 className="type-title-large text-ink-strong">Receipt Count</h2>
            <dl className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="type-label-small text-ink-muted">Linked actors</dt>
                <dd className="type-title-small text-ink-strong">
                  {countLabel(counts.actorCount, "actor")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="type-label-small text-ink-muted">Source receipts</dt>
                <dd className="type-title-small text-ink-strong">
                  {countLabel(counts.sourceCount, "source")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="type-label-small text-ink-muted">Research runs</dt>
                <dd className="type-title-small text-ink-strong">
                  {countLabel(counts.runCount, "run")}
                </dd>
              </div>
            </dl>
            <button
              type="submit"
              disabled={createBrief.isPending}
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-4 transition-colors disabled:opacity-60"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Create brief
            </button>
            {error ? (
              <p className="type-body-small text-rose-700" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        </aside>
      </form>
    </div>
  );
}

function toggleSelection(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function uniqueValues(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function uniqueSources(items: SavedListExportItemResponse[]): SavedListExportSource[] {
  const sources = new Map<string, SavedListExportSource>();
  for (const item of items) {
    for (const source of item.sources ?? []) {
      if (safeSourceUrl(source.url)) {
        sources.set(source.id, source);
      }
    }
  }
  return [...sources.values()];
}

function safeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
