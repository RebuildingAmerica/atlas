import { useMemo, useState } from "react";
import { useAtlasSession } from "@/domains/access";
import { hasSerializedCapability } from "@/domains/access/capabilities";
import { isAtLimitError, resolveStartRunErrorMessage } from "@/domains/discovery/api-errors";
import { buildBriefCreateInputFromRun } from "@/domains/discovery/brief-request";
import {
  buildCoverageTargetCreateInputFromRun,
  topLeadEntryIdsFromRun,
} from "@/domains/discovery/coverage-target-request";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import {
  useDiscoveryJobQueue,
  useDiscoveryRuns,
  useStartDiscovery,
} from "@/domains/discovery/hooks/use-discovery";
import { useCreateWorkspaceBrief } from "@/domains/workspace/hooks/use-briefs";
import { useCreateCoverageTarget } from "@/domains/workspace/hooks/use-coverage-targets";
import { useWatchWorkspaceResource } from "@/domains/workspace/hooks/use-workspace-watches";
import { useWorkspaceQualitySummary } from "@/domains/workspace/hooks/use-workspace-quality-summary";
import { DiscoverySetupNotice, DiscoveryUpgradePrompt } from "./components/discovery-hero";
import { DiscoveryRunForm } from "./components/discovery-run-form";
import { DiscoveryRunsPanel } from "./components/discovery-runs-panel";
import type {
  DiscoveryJobQueueItem,
  DiscoveryJobQueueResponse,
  DiscoveryResearchGoal,
  DiscoveryRunListResponse,
  TaxonomyResponse,
} from "@/types";
import type { DiscoveryRunRecord } from "@/domains/discovery/discovery-run-summary";
import type { AtlasBriefCreateInput } from "@/domains/workspace/server/briefs";
import type { CoverageTargetCreateInput } from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceQualitySummary } from "@/domains/workspace/server/quality-summary";

interface CreatedBriefLink {
  id: string;
  title: string;
}

interface CreatedCoverageTargetLink {
  id: string;
  name: string;
}

interface DiscoveryPageProps {
  initialRuns?: DiscoveryRunListResponse;
  initialRequest?: DiscoveryPrefillRequest;
  initialTaxonomy?: TaxonomyResponse;
  selectedRunId?: string;
}

export interface DiscoveryPrefillRequest {
  issue_areas?: string;
  location?: string;
  research_goal?: DiscoveryResearchGoal;
  state?: string;
}

function prefilledIssueAreas(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((issueArea) => issueArea.trim())
    .filter(Boolean);
}

function formatQueueStatus(status: string): string {
  if (status === "claimed") {
    return "running";
  }

  return status;
}

function formatProgressStep(progress: Record<string, unknown> | null | undefined): string | null {
  const rawStep = progress?.step;
  if (typeof rawStep !== "string" || rawStep.length === 0) {
    return null;
  }

  return rawStep.replaceAll("_", " ");
}

function ResearchOperationsPanel({
  isLoading,
  queue,
}: {
  isLoading: boolean;
  queue: DiscoveryJobQueueResponse | undefined;
}) {
  const counts = queue?.status_counts;
  const queued = counts?.queued ?? 0;
  const running = (counts?.running ?? 0) + (counts?.claimed ?? 0);
  const failed = counts?.failed ?? 0;
  const items = queue?.items ?? [];

  function renderJob(job: DiscoveryJobQueueItem) {
    const progressStep = formatProgressStep(job.progress);

    return (
      <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]" key={job.id}>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-title-small text-ink-strong">{job.location_query}</p>
            <span className="type-label-small border-border text-ink-muted rounded-full border px-2 py-0.5">
              {formatQueueStatus(job.status)}
            </span>
          </div>
          <p className="type-body-small text-ink-soft">
            {job.state} · {job.issue_areas.length} issue areas
          </p>
          {progressStep ? <p className="type-label-small text-ink-muted">{progressStep}</p> : null}
          {job.error_message ? (
            <p className="type-label-small text-red-700">{job.error_message}</p>
          ) : null}
        </div>
        <div className="space-y-1 sm:text-right">
          <p className="type-label-small text-ink-muted">Retry {job.retry_count}</p>
          {job.claimed_by ? (
            <p className="type-label-small text-ink-strong">{job.claimed_by}</p>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <section className="border-border-strong bg-surface space-y-4 rounded-[1rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Research operations</h2>
          <p className="type-body-medium text-ink-muted">Queue, workers, and retries.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="type-label-medium border-border text-ink-soft rounded-full border px-3 py-1">
            {queued} queued
          </span>
          <span className="type-label-medium border-border text-ink-soft rounded-full border px-3 py-1">
            {running} running
          </span>
          <span className="type-label-medium border-border text-ink-soft rounded-full border px-3 py-1">
            {failed} failed
          </span>
        </div>
      </div>

      {isLoading ? (
        <p className="type-body-medium text-ink-muted">Loading...</p>
      ) : items.length > 0 ? (
        <ol className="divide-border divide-y">{items.map(renderJob)}</ol>
      ) : (
        <p className="type-body-medium text-ink-muted">No research operations queued.</p>
      )}
    </section>
  );
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function confidenceCount(summary: WorkspaceQualitySummary, state: string): number {
  return (
    summary.confidence_distribution.find((bucket) => bucket.state === state)?.record_count ?? 0
  );
}

function IngestionQualityPanel({
  isLoading,
  summary,
}: {
  isLoading: boolean;
  summary: WorkspaceQualitySummary | undefined;
}) {
  const sourceCoverage = summary?.source_coverage;
  const duplicateRisk = summary?.duplicate_risk;
  const staleRecords = summary?.stale_records;
  const stalePreview = staleRecords?.records.slice(0, 3) ?? [];

  return (
    <section className="border-border-strong bg-surface space-y-4 rounded-[1rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Ingestion quality</h2>
          <p className="type-body-medium text-ink-muted">
            Source coverage, duplicates, confidence, stale records.
          </p>
        </div>
        {sourceCoverage ? (
          <span className="type-label-medium border-border text-ink-soft rounded-full border px-3 py-1">
            {sourceCoverage.total_records} records
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="type-body-medium text-ink-muted">Loading...</p>
      ) : summary && sourceCoverage && duplicateRisk && staleRecords ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="border-border rounded-xl border p-3">
              <p className="type-title-small text-ink-strong">
                {formatPercent(sourceCoverage.coverage_percent)}% source-backed
              </p>
              <p className="type-label-small text-ink-muted">
                {sourceCoverage.unsourced_records} unsourced
              </p>
            </div>
            <div className="border-border rounded-xl border p-3">
              <p className="type-title-small text-ink-strong">
                {duplicateRisk.cluster_count} duplicate{" "}
                {duplicateRisk.cluster_count === 1 ? "cluster" : "clusters"}
              </p>
              <p className="type-label-small text-ink-muted">
                {duplicateRisk.record_count} records
              </p>
            </div>
            <div className="border-border rounded-xl border p-3">
              <p className="type-title-small text-ink-strong">{staleRecords.record_count} stale</p>
              <p className="type-label-small text-ink-muted">
                {staleRecords.threshold_days} day threshold
              </p>
            </div>
            <div className="border-border rounded-xl border p-3">
              <p className="type-title-small text-ink-strong">
                {confidenceCount(summary, "corroborated")} corroborated
              </p>
              <p className="type-label-small text-ink-muted">
                {confidenceCount(summary, "partial")} partial ·{" "}
                {confidenceCount(summary, "unverified")} unverified
              </p>
            </div>
          </div>

          {stalePreview.length > 0 ? (
            <div className="space-y-2">
              <p className="type-label-large text-ink-strong">Stale records</p>
              <ul className="divide-border divide-y">
                {stalePreview.map((record) => (
                  <li className="flex flex-wrap justify-between gap-2 py-2" key={record.id}>
                    <span className="type-body-small text-ink-strong">{record.name}</span>
                    <span className="type-label-small text-ink-muted">
                      {record.latest_source_date} · {record.source_count} source
                      {record.source_count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="type-label-small text-ink-muted">{summary.data_boundary.statement}</p>
        </div>
      ) : (
        <p className="type-body-medium text-ink-muted">No quality signals.</p>
      )}
    </section>
  );
}

/**
 * Renders the workspace research surface around recent requests first, with
 * creation controls available below the request history.
 */
export function DiscoveryPage({
  initialRequest,
  initialRuns,
  initialTaxonomy,
  selectedRunId,
}: DiscoveryPageProps = {}) {
  const atlasSession = useAtlasSession();
  const runsQuery = useDiscoveryRuns({ initialData: initialRuns });
  const jobQueueQuery = useDiscoveryJobQueue();
  const startDiscovery = useStartDiscovery();
  const createBrief = useCreateWorkspaceBrief();
  const createCoverageTarget = useCreateCoverageTarget();
  const watchWorkspaceResource = useWatchWorkspaceResource();
  const qualitySummaryQuery = useWorkspaceQualitySummary();
  const taxonomyQuery = useTaxonomy({ initialData: initialTaxonomy });

  const [locationQuery, setLocationQuery] = useState(initialRequest?.location ?? "");
  const [researchGoal, setResearchGoal] = useState<DiscoveryResearchGoal>(
    initialRequest?.research_goal ?? "landscape_scan",
  );
  const [state, setState] = useState((initialRequest?.state ?? "").toUpperCase().slice(0, 2));
  const [selectedIssues, setSelectedIssues] = useState<string[]>(
    prefilledIssueAreas(initialRequest?.issue_areas),
  );
  const [creatingBriefRunId, setCreatingBriefRunId] = useState<string | null>(null);
  const [creatingCoverageTargetRunId, setCreatingCoverageTargetRunId] = useState<string | null>(
    null,
  );
  const [watchingLeadsRunId, setWatchingLeadsRunId] = useState<string | null>(null);
  const [createdBriefs, setCreatedBriefs] = useState<Record<string, CreatedBriefLink>>({});
  const [createdCoverageTargets, setCreatedCoverageTargets] = useState<
    Record<string, CreatedCoverageTargetLink>
  >({});
  const [createBriefErrors, setCreateBriefErrors] = useState<Record<string, string | null>>({});
  const [createCoverageTargetErrors, setCreateCoverageTargetErrors] = useState<
    Record<string, string | null>
  >({});
  const [watchedLeadCounts, setWatchedLeadCounts] = useState<Record<string, number>>({});
  const [watchLeadErrors, setWatchLeadErrors] = useState<Record<string, string | null>>({});

  const issueAreas = useMemo(() => {
    const taxonomy = taxonomyQuery.data ?? {};
    return Object.entries(taxonomy)
      .flatMap(([, issues]) => issues)
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [taxonomyQuery.data]);

  const isLocal = atlasSession.data?.isLocal ?? false;
  const needsWorkspace = atlasSession.data?.workspace.onboarding.needsWorkspace ?? false;
  const canRunResearch = atlasSession.data
    ? hasSerializedCapability(atlasSession.data.workspace.resolvedCapabilities, "research.run")
    : false;
  const hasPendingInvitations =
    atlasSession.data?.workspace.onboarding.hasPendingInvitations ?? false;
  const activeProducts = atlasSession.data?.workspace.activeProducts ?? [];
  const isFreeTier = activeProducts.length === 0;
  const latestRuns = runsQuery.data?.items ?? [];

  const startError = startDiscovery.error ?? null;
  const isAtLimit = isAtLimitError(startError);
  const startErrorMessage = startError ? resolveStartRunErrorMessage(startError) : null;

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
        research_goal: researchGoal,
        state: state.trim().toUpperCase(),
      },
      {
        onSuccess: () => {
          setLocationQuery("");
          setResearchGoal("landscape_scan");
          setState("");
          setSelectedIssues([]);
        },
      },
    );
  };

  const handleCreateBrief = (run: DiscoveryRunRecord) => {
    let input: AtlasBriefCreateInput;
    try {
      input = buildBriefCreateInputFromRun(run);
    } catch {
      setCreateBriefErrors((current) => ({
        ...current,
        [run.id]: "Could not save Atlas Brief.",
      }));
      return;
    }

    setCreatingBriefRunId(run.id);
    setCreateBriefErrors((current) => ({
      ...current,
      [run.id]: null,
    }));

    createBrief.mutate(input, {
      onError: () => {
        setCreateBriefErrors((current) => ({
          ...current,
          [run.id]: "Could not save Atlas Brief.",
        }));
      },
      onSettled: () => {
        setCreatingBriefRunId((current) => (current === run.id ? null : current));
      },
      onSuccess: (brief) => {
        setCreatedBriefs((current) => ({
          ...current,
          [run.id]: {
            id: brief.id,
            title: brief.title,
          },
        }));
      },
    });
  };

  const handleCreateCoverageTarget = (run: DiscoveryRunRecord) => {
    let input: CoverageTargetCreateInput;
    try {
      input = buildCoverageTargetCreateInputFromRun(run);
    } catch {
      setCreateCoverageTargetErrors((current) => ({
        ...current,
        [run.id]: "Could not create coverage target.",
      }));
      return;
    }

    setCreatingCoverageTargetRunId(run.id);
    setCreateCoverageTargetErrors((current) => ({
      ...current,
      [run.id]: null,
    }));

    createCoverageTarget.mutate(input, {
      onError: () => {
        setCreateCoverageTargetErrors((current) => ({
          ...current,
          [run.id]: "Could not create coverage target.",
        }));
      },
      onSettled: () => {
        setCreatingCoverageTargetRunId((current) => (current === run.id ? null : current));
      },
      onSuccess: (target) => {
        setCreatedCoverageTargets((current) => ({
          ...current,
          [run.id]: {
            id: target.id,
            name: target.name,
          },
        }));
      },
    });
  };

  const handleWatchTopLeads = (run: DiscoveryRunRecord) => {
    const leadIds = topLeadEntryIdsFromRun(run);
    if (leadIds.length === 0) {
      setWatchLeadErrors((current) => ({
        ...current,
        [run.id]: "Could not watch top leads.",
      }));
      return;
    }

    setWatchingLeadsRunId(run.id);
    setWatchLeadErrors((current) => ({
      ...current,
      [run.id]: null,
    }));

    void Promise.all(
      leadIds.map((resourceId) =>
        watchWorkspaceResource.mutateAsync({
          notificationPreference: "digest",
          resourceId,
          resourceType: "entry",
        }),
      ),
    )
      .then(() => {
        setWatchedLeadCounts((current) => ({
          ...current,
          [run.id]: leadIds.length,
        }));
      })
      .catch(() => {
        setWatchLeadErrors((current) => ({
          ...current,
          [run.id]: "Could not watch top leads.",
        }));
      })
      .finally(() => {
        setWatchingLeadsRunId((current) => (current === run.id ? null : current));
      });
  };

  return (
    <div className="space-y-8">
      <DiscoveryRunsPanel
        createdBriefs={createdBriefs}
        createdCoverageTargets={createdCoverageTargets}
        createBriefErrors={createBriefErrors}
        createCoverageTargetErrors={createCoverageTargetErrors}
        creatingBriefRunId={creatingBriefRunId}
        creatingCoverageTargetRunId={creatingCoverageTargetRunId}
        isLoading={runsQuery.isLoading}
        onCreateBrief={handleCreateBrief}
        onCreateCoverageTarget={handleCreateCoverageTarget}
        onWatchTopLeads={handleWatchTopLeads}
        runs={latestRuns}
        selectedRunId={selectedRunId}
        watchedLeadCounts={watchedLeadCounts}
        watchLeadErrors={watchLeadErrors}
        watchingLeadsRunId={watchingLeadsRunId}
      />

      <ResearchOperationsPanel isLoading={jobQueueQuery.isLoading} queue={jobQueueQuery.data} />

      <IngestionQualityPanel
        isLoading={qualitySummaryQuery.isLoading}
        summary={qualitySummaryQuery.data}
      />

      {needsWorkspace ? (
        <DiscoverySetupNotice
          title="Create your workspace"
          body="Set up a workspace to organize research and briefs."
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

      {!isLocal && !needsWorkspace && atlasSession.data && !canRunResearch ? (
        <DiscoveryUpgradePrompt reason="capability-missing" />
      ) : !isLocal && !needsWorkspace && atlasSession.data && isFreeTier ? (
        <DiscoveryUpgradePrompt reason="free-tier" />
      ) : null}

      {isAtLimit ? <DiscoveryUpgradePrompt reason="at-limit" /> : null}

      <DiscoveryRunForm
        canRunResearch={canRunResearch}
        issueAreas={issueAreas}
        isPending={startDiscovery.isPending}
        isTaxonomyLoading={taxonomyQuery.isLoading}
        locationQuery={locationQuery}
        researchGoal={researchGoal}
        selectedIssues={selectedIssues}
        startErrorMessage={isAtLimit ? null : startErrorMessage}
        state={state}
        onLocationChange={setLocationQuery}
        onResearchGoalChange={setResearchGoal}
        onStateChange={handleStateChange}
        onSubmit={handleSubmit}
        onToggleIssue={handleToggleIssue}
      />
    </div>
  );
}
