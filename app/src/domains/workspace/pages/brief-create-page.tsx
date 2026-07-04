import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useMemo, useState } from "react";
import { useCreateWorkspaceBrief } from "@/domains/workspace/hooks/use-briefs";
import type {
  AtlasBriefConfidenceState,
  AtlasBriefCreateInput,
  AtlasBriefGap,
} from "@/domains/workspace/server/briefs";
import { Badge } from "@/platform/ui/badge";

interface BriefCreateFormState {
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

interface EvidenceCounts {
  actorCount: number;
  runCount: number;
  sourceCount: number;
}

const initialFormState: BriefCreateFormState = {
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

const KNOWN_GAP_FORMAT = "Label: detail";

function splitList(value: string): string[] {
  const items = value
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(items));
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
      detail: line.slice(separatorIndex + 1).trim(),
      label: line.slice(0, separatorIndex).trim(),
    };
  });
}

function evidenceCounts(state: BriefCreateFormState): EvidenceCounts {
  return {
    actorCount: splitList(state.linkedEntryIds).length,
    runCount: splitList(state.linkedDiscoveryRunIds).length,
    sourceCount: splitList(state.linkedSourceIds).length,
  };
}

function buildBriefCreateInput(state: BriefCreateFormState): AtlasBriefCreateInput {
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

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function fieldClassName(): string {
  return "border-outline-variant bg-surface text-ink-strong type-body-medium min-h-10 w-full rounded-lg border px-3";
}

function textAreaClassName(extraHeight = "min-h-24"): string {
  return `border-outline-variant bg-surface text-ink-strong type-body-medium ${extraHeight} w-full rounded-lg border px-3 py-2`;
}

export function BriefCreatePage() {
  const navigate = useNavigate();
  const createBrief = useCreateWorkspaceBrief();
  const knownGapsId = useId();
  const [formState, setFormState] = useState<BriefCreateFormState>(initialFormState);
  const [error, setError] = useState("");
  const counts = useMemo(() => evidenceCounts(formState), [formState]);

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

    try {
      const input = buildBriefCreateInput(formState);
      const brief = await createBrief.mutateAsync(input);
      void navigate({
        params: { briefId: brief.id },
        to: "/briefs/$briefId",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create brief.");
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
            <Badge>Source-linked</Badge>
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
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Actors</span>
                <input
                  required
                  value={formState.actorTypes}
                  onChange={(event) => {
                    updateField("actorTypes", event.target.value);
                  }}
                  className={fieldClassName()}
                />
              </label>
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Sources</span>
                <input
                  required
                  value={formState.sourceTypes}
                  onChange={(event) => {
                    updateField("sourceTypes", event.target.value);
                  }}
                  className={fieldClassName()}
                />
              </label>
            </div>
          </section>

          <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
            <h2 className="type-title-large text-ink-strong">Linked Evidence</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Linked actor IDs</span>
                <textarea
                  value={formState.linkedEntryIds}
                  onChange={(event) => {
                    updateField("linkedEntryIds", event.target.value);
                  }}
                  className={textAreaClassName()}
                />
              </label>
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Source receipt IDs</span>
                <textarea
                  value={formState.linkedSourceIds}
                  onChange={(event) => {
                    updateField("linkedSourceIds", event.target.value);
                  }}
                  className={textAreaClassName()}
                />
              </label>
              <label className="block space-y-1">
                <span className="type-label-small text-ink-muted">Research run IDs</span>
                <textarea
                  value={formState.linkedDiscoveryRunIds}
                  onChange={(event) => {
                    updateField("linkedDiscoveryRunIds", event.target.value);
                  }}
                  className={textAreaClassName()}
                />
              </label>
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
            <h2 className="type-title-large text-ink-strong">Review</h2>
            <label className="block space-y-1">
              <span className="type-label-small text-ink-muted">Confidence state</span>
              <select
                value={formState.confidenceState}
                onChange={(event) => {
                  updateField("confidenceState", event.target.value as AtlasBriefConfidenceState);
                }}
                className={fieldClassName()}
              >
                <option value="corroborated">corroborated</option>
                <option value="partial">partial</option>
                <option value="unverified">unverified</option>
              </select>
            </label>
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
