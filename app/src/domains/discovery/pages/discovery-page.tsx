import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAtlasSession } from "@/domains/access";
import { hasSerializedCapability } from "@/domains/access/capabilities";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { useDiscoveryRuns, useStartDiscovery } from "@/domains/discovery/hooks/use-discovery";
import { Button } from "@/platform/ui/button";
import type { DiscoveryRun } from "@/types";

/**
 * Discovery run shape used by the UI while older responses may still include
 * an optional `error_message`.
 */
interface DiscoveryRunRecord extends DiscoveryRun {
  error_message?: string | null;
}

/**
 * Props for the discovery hero section.
 */
interface DiscoveryHeroProps {
  description: string;
  eyebrow: string;
  title: string;
  workspaceBadge: string | null;
}

/**
 * Props for the discovery setup notice.
 */
interface DiscoverySetupNoticeProps {
  body: string;
  cta: string;
  title: string;
}

/**
 * Props for the discovery run form.
 */
interface DiscoveryRunFormProps {
  canRunResearch: boolean;
  issueAreas: {
    description?: string | null;
    name: string;
    slug: string;
  }[];
  isPending: boolean;
  isTaxonomyLoading: boolean;
  locationQuery: string;
  selectedIssues: string[];
  startError: boolean;
  state: string;
  onLocationChange: (value: string) => void;
  onStateChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToggleIssue: (slug: string) => void;
}

/**
 * Props for the recent-runs panel.
 */
interface DiscoveryRunsPanelProps {
  isLoading: boolean;
  runs: DiscoveryRunRecord[];
}

function DiscoveryHero({ description, eyebrow, title, workspaceBadge }: DiscoveryHeroProps) {
  return (
    <section className="space-y-3">
      <p className="type-label-medium text-ink-muted">{eyebrow}</p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="type-headline-large text-ink-strong">{title}</h1>
        {workspaceBadge ? (
          <span className="type-label-large border-border text-ink-soft rounded-full border px-3 py-1">
            {workspaceBadge}
          </span>
        ) : null}
      </div>
      <p className="type-body-large text-ink-soft max-w-3xl">{description}</p>
    </section>
  );
}

function DiscoverySetupNotice({ body, cta, title }: DiscoverySetupNoticeProps) {
  return (
    <section className="border-border-strong bg-surface rounded-[1.5rem] border p-5">
      <p className="type-title-medium text-ink-strong">{title}</p>
      <p className="type-body-medium text-ink-soft mt-2">{body}</p>
      <div className="mt-4">
        <Link className="type-label-large text-ink-strong underline" to="/organization">
          {cta}
        </Link>
      </div>
    </section>
  );
}

function DiscoveryRunForm({
  canRunResearch,
  issueAreas,
  isPending,
  isTaxonomyLoading,
  locationQuery,
  onLocationChange,
  onStateChange,
  onSubmit,
  onToggleIssue,
  selectedIssues,
  startError,
  state,
}: DiscoveryRunFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="border-border-strong bg-surface space-y-6 rounded-[1.5rem] border p-6"
    >
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Start a discovery run</h2>
        <p className="type-body-medium text-ink-muted">
          Enter a location, state, and at least one issue area.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem]">
        <label className="space-y-2">
          <span className="type-label-large text-ink-strong">Location</span>
          <input
            value={locationQuery}
            onChange={(event) => {
              onLocationChange(event.target.value);
            }}
            placeholder="Kansas City, MO"
            className="type-body-large border-border text-ink-strong w-full rounded-xl border bg-white px-4 py-3 outline-none"
          />
        </label>

        <label className="space-y-2">
          <span className="type-label-large text-ink-strong">State</span>
          <input
            value={state}
            onChange={(event) => {
              onStateChange(event.target.value);
            }}
            placeholder="MO"
            className="type-body-large border-border text-ink-strong w-full rounded-xl border bg-white px-4 py-3 outline-none"
          />
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="type-label-large text-ink-strong">Issue areas</p>
          <p className="type-body-medium text-ink-muted">{selectedIssues.length} selected</p>
        </div>

        <div className="border-border max-h-72 overflow-y-auto rounded-xl border bg-white p-3">
          {isTaxonomyLoading ? (
            <p className="type-body-medium text-ink-muted">Loading issue areas...</p>
          ) : issueAreas.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {issueAreas.map((issue) => (
                <label
                  key={issue.slug}
                  className="hover:border-border flex items-start gap-3 rounded-lg border border-transparent px-2 py-2"
                >
                  <input
                    type="checkbox"
                    checked={selectedIssues.includes(issue.slug)}
                    onChange={() => {
                      onToggleIssue(issue.slug);
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="type-title-small text-ink-strong block">{issue.name}</span>
                    <span className="type-body-small text-ink-muted mt-1 block">
                      {issue.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="type-body-medium text-ink-muted">
              Issue areas are unavailable right now.
            </p>
          )}
        </div>
      </div>

      {startError ? (
        <p className="type-body-medium text-red-700">
          Could not start the run. Check the fields and try again.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={
            !canRunResearch ||
            isPending ||
            !locationQuery.trim() ||
            state.trim().length !== 2 ||
            selectedIssues.length === 0
          }
        >
          {isPending ? "Starting..." : "Start run"}
        </Button>
        <p className="type-body-medium text-ink-muted">Runs are added to the list below.</p>
      </div>
    </form>
  );
}

function DiscoveryRunsPanel({ isLoading, runs }: DiscoveryRunsPanelProps) {
  return (
    <section className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Recent runs</h2>
        <p className="type-body-medium text-ink-muted">
          The latest discovery runs and their current status.
        </p>
      </div>

      {isLoading ? (
        <p className="type-body-medium text-ink-muted">Loading runs...</p>
      ) : runs.length > 0 ? (
        <div className="space-y-3">
          {runs.map((run) => (
            <article
              key={run.id}
              className="border-border space-y-3 rounded-xl border bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="type-title-small text-ink-strong">{run.location_query}</p>
                  <p className="type-body-small text-ink-muted mt-1">
                    {new Date(run.started_at).toLocaleString()} · {run.state}
                  </p>
                </div>
                <span className="type-label-large border-border text-ink-soft rounded-full border px-3 py-1">
                  {run.status}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <p className="type-body-medium text-ink-soft">
                  {run.issue_areas.length} issue areas
                </p>
                <p className="type-body-medium text-ink-soft">
                  {run.entries_extracted} entries extracted
                </p>
                <p className="type-body-medium text-ink-soft">
                  {run.sources_fetched} sources fetched
                </p>
                <p className="type-body-medium text-ink-soft">
                  {run.entries_after_dedup} entries after dedup
                </p>
              </div>

              {run.error_message ? (
                <p className="type-body-small text-red-700">{run.error_message}</p>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="type-body-medium text-ink-muted">No discovery runs yet.</p>
      )}
    </section>
  );
}

/**
 * Renders the workspace discovery surface.
 */
export function DiscoveryPage() {
  const atlasSession = useAtlasSession();
  const runsQuery = useDiscoveryRuns();
  const startDiscovery = useStartDiscovery();
  const taxonomyQuery = useTaxonomy();

  const [locationQuery, setLocationQuery] = useState("");
  const [state, setState] = useState("");
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);

  const issueAreas = useMemo(() => {
    const taxonomy = taxonomyQuery.data ?? {};
    return Object.entries(taxonomy)
      .flatMap(([, issues]) => issues)
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [taxonomyQuery.data]);

  const activeWorkspace = atlasSession.data?.workspace.activeOrganization ?? null;
  const canUseTeamFeatures = atlasSession.data?.workspace.capabilities.canUseTeamFeatures ?? false;
  const needsWorkspace = atlasSession.data?.workspace.onboarding.needsWorkspace ?? false;
  const canRunResearch = atlasSession.data
    ? hasSerializedCapability(atlasSession.data.workspace.resolvedCapabilities, "research.run")
    : false;
  const hasPendingInvitations =
    atlasSession.data?.workspace.onboarding.hasPendingInvitations ?? false;
  const latestRuns = runsQuery.data?.items ?? [];

  const handleToggleIssue = (slug: string) => {
    setSelectedIssues((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  };

  const handleStateChange = (value: string) => {
    setState(value.toUpperCase().slice(0, 2));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!locationQuery.trim() || state.trim().length !== 2 || selectedIssues.length === 0) {
      return;
    }

    startDiscovery.mutate(
      {
        issue_areas: selectedIssues,
        location_query: locationQuery.trim(),
        state: state.trim().toUpperCase(),
      },
      {
        onSuccess: () => {
          setLocationQuery("");
          setState("");
          setSelectedIssues([]);
        },
      },
    );
  };

  const heroEyebrow = canUseTeamFeatures ? "Team discovery" : "Discovery";
  const heroTitle =
    canUseTeamFeatures && activeWorkspace ? `${activeWorkspace.name} discovery` : "Discovery";
  const heroDescription = needsWorkspace
    ? "Create a workspace to keep your discovery runs organized."
    : canUseTeamFeatures && activeWorkspace
      ? `Start runs for ${activeWorkspace.name} and keep the team aligned on what Atlas is actively researching.`
      : "Start discovery runs and check recent run status in one place.";
  const workspaceBadge = activeWorkspace ? activeWorkspace.name : null;

  return (
    <div className="space-y-10">
      <DiscoveryHero
        description={heroDescription}
        eyebrow={heroEyebrow}
        title={heroTitle}
        workspaceBadge={workspaceBadge}
      />

      {needsWorkspace ? (
        <DiscoverySetupNotice
          title="Create your workspace"
          body="Set up a workspace to organize your discovery runs and research."
          cta="Create a workspace"
        />
      ) : null}

      {hasPendingInvitations ? (
        <DiscoverySetupNotice
          title="You have workspace invitations waiting"
          body="Review your pending workspace invitations."
          cta="Review invitations"
        />
      ) : null}

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <DiscoveryRunForm
          canRunResearch={canRunResearch}
          issueAreas={issueAreas}
          isPending={startDiscovery.isPending}
          isTaxonomyLoading={taxonomyQuery.isLoading}
          locationQuery={locationQuery}
          selectedIssues={selectedIssues}
          startError={Boolean(startDiscovery.error)}
          state={state}
          onLocationChange={setLocationQuery}
          onStateChange={handleStateChange}
          onSubmit={handleSubmit}
          onToggleIssue={handleToggleIssue}
        />
        <DiscoveryRunsPanel isLoading={runsQuery.isLoading} runs={latestRuns} />
      </section>
    </div>
  );
}
