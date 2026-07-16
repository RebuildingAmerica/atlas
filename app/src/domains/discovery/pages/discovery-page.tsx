import { useMemo, useState } from "react";
import { useAtlasSession } from "@/domains/access";
import { hasSerializedCapability } from "@/domains/access/capabilities";
import {
  isAtLimitError,
  resolveStartRunErrorMessage,
} from "@rebuildingamerica/atlas-catalog/discovery/api-errors";
import { buildBriefCreateInputFromRun } from "@/domains/discovery/brief-request";
import {
  buildCoverageTargetCreateInputFromRun,
  topLeadEntryIdsFromRun,
} from "@/domains/discovery/coverage-target-request";
import { useTaxonomy } from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";
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
import { IngestionQualityPanel, ResearchOperationsPanel } from "./discovery-page-panels";
import { prefilledIssueAreas } from "./discovery-page-utils";
import type { DiscoveryResearchGoal } from "@rebuildingamerica/atlas-api-client";
import type { DiscoveryRunRecord } from "@rebuildingamerica/atlas-catalog/discovery/discovery-run-summary";
import type { AtlasBriefCreateInput } from "@/domains/workspace/server/briefs";
import type { CoverageTargetCreateInput } from "@/domains/workspace/server/coverage-targets";

interface CreatedBriefLink {
  id: string;
  title: string;
}

interface CreatedCoverageTargetLink {
  id: string;
  name: string;
}

export interface DiscoveryPrefillRequest {
  issue_areas?: string;
  location?: string;
  research_goal?: DiscoveryResearchGoal;
  state?: string;
}

interface DiscoveryPageProps {
  initialRequest?: DiscoveryPrefillRequest;
  selectedRunId?: string;
}

export function DiscoveryPage({ initialRequest, selectedRunId }: DiscoveryPageProps = {}) {
  const atlasSession = useAtlasSession();
  const runsQuery = useDiscoveryRuns();
  const jobQueueQuery = useDiscoveryJobQueue();
  const startDiscovery = useStartDiscovery();
  const createBrief = useCreateWorkspaceBrief();
  const createCoverageTarget = useCreateCoverageTarget();
  const watchWorkspaceResource = useWatchWorkspaceResource();
  const qualitySummaryQuery = useWorkspaceQualitySummary();
  const taxonomyQuery = useTaxonomy();

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
