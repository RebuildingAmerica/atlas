/**
 * Orchestrator for the authenticated "Your Research" home.
 *
 * Reads route-seeded React Query data via {@link useResearchSummary} so the
 * page paints fully populated from the server HTML and only revalidates on the
 * client, and reads the operator session for the greeting name and capability
 * context. Each section is server-default:
 * it renders from the summary the loader already computed, never a client-fetch
 * shell, and degrades to honest empty states.
 */
import { useAtlasSession } from "@/domains/access";
import type { AtlasWorkspaceType } from "@/domains/access/organization-metadata";
import { useWorkspaceBriefs } from "../hooks/use-briefs";
import { useWorkspaceCoverageTargets } from "../hooks/use-coverage-targets";
import { useResearchSummary } from "../hooks/use-research-summary";
import { useWorkspaceUsageSummary } from "../hooks/use-workspace-usage-summary";
import { useWorkspaceWatchesSnapshot } from "../hooks/use-workspace-watches";
import { ResearchHomeHero } from "../components/research-home-hero";
import { ActivitySummarySection } from "../components/activity-summary-section";
import { ListsSummarySection } from "../components/lists-summary-section";
import { FollowsSummarySection } from "../components/follows-summary-section";
import { WatchlistsSummarySection } from "../components/watchlists-summary-section";
import { ResearchTrendsSection } from "../components/research-trends-section";
import { RecentSearchesSection } from "../components/recent-searches-section";
import { NextActionsSection } from "../components/next-actions-section";
import { WorkspaceOperatingPictureSection } from "../components/workspace-operating-picture-section";
import type { OperatingPictureResource } from "../components/workspace-operating-picture-section";

/**
 * Derives the operator's first name from their full name.
 *
 * @param name - The operator's full name from the session, or undefined.
 * @returns The first whitespace-delimited token, or null when no name exists.
 */
function firstNameFrom(name: string | undefined): string | null {
  if (!name) {
    return null;
  }
  const [first] = name.trim().split(/\s+/);
  return first ? first : null;
}

interface WorkspaceQuerySnapshot<TData> {
  data: TData | undefined;
  isError: boolean;
}

function operatingPictureResource<TData>(
  query: WorkspaceQuerySnapshot<TData>,
): OperatingPictureResource<TData> {
  if (query.isError) {
    return { data: null, status: "unavailable" };
  }

  if (query.data === undefined) {
    return { data: null, status: "loading" };
  }

  return { data: query.data, status: "ready" };
}

function operatingPictureWorkspaceLabel(workspaceType: AtlasWorkspaceType): string {
  return workspaceType === "team" ? "Team workspace" : "Personal workspace";
}

/**
 * The full "Your Research" home surface, server-default and capability-aware.
 */
export function ResearchHomePage() {
  const summaryQuery = useResearchSummary();
  const summary = summaryQuery.data;
  const session = useAtlasSession();

  const firstName = firstNameFrom(session.data?.user.name);
  const isLocal = session.data?.isLocal ?? false;
  const activeProducts = session.data?.workspace.activeProducts ?? [];
  const isFreeTier = activeProducts.length === 0;
  const capabilities = session.data?.workspace.resolvedCapabilities ?? null;
  const runsPerMonthLimit = capabilities ? capabilities.limits.research_runs_per_month : null;
  const activeWorkspace = session.data?.workspace.activeOrganization ?? null;
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const hasActiveWorkspace = activeWorkspaceId !== null;
  const briefsQuery = useWorkspaceBriefs(hasActiveWorkspace, activeWorkspaceId);
  const coverageTargetsQuery = useWorkspaceCoverageTargets(hasActiveWorkspace, activeWorkspaceId);
  const usageSummaryQuery = useWorkspaceUsageSummary(hasActiveWorkspace, activeWorkspaceId);
  const watchesQuery = useWorkspaceWatchesSnapshot(hasActiveWorkspace, activeWorkspaceId);
  const briefsResource = operatingPictureResource(briefsQuery);
  const coverageTargetsResource = operatingPictureResource(coverageTargetsQuery);
  const usageSummaryResource = operatingPictureResource(usageSummaryQuery);
  const watchesResource = operatingPictureResource(watchesQuery);
  const showRenewalProof = activeWorkspace?.workspaceType === "team";
  const workspaceNextActions = activeWorkspace
    ? {
        briefs: briefsResource,
        coverageTargets: coverageTargetsResource,
        showRenewalProof,
        usageSummary: usageSummaryResource,
        watches: watchesResource,
      }
    : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-12 py-12">
      <ResearchHomeHero firstName={firstName} summary={summary} />
      {activeWorkspace ? (
        <WorkspaceOperatingPictureSection
          briefs={briefsResource}
          coverageTargets={coverageTargetsResource}
          showRenewalProof={showRenewalProof}
          usageSummary={usageSummaryResource}
          watches={watchesResource}
          workspaceLabel={operatingPictureWorkspaceLabel(activeWorkspace.workspaceType)}
        />
      ) : null}
      <ActivitySummarySection activity={summary.activity} />
      <ListsSummarySection lists={summary.lists} capabilities={capabilities} isLocal={isLocal} />
      <FollowsSummarySection
        activity={summary.activity}
        capabilities={capabilities}
        isLocal={isLocal}
      />
      <WatchlistsSummarySection watchlists={summary.watchlists} />
      <ResearchTrendsSection trends={summary.researchTrends ?? []} />
      <RecentSearchesSection
        runs={summary.recentRuns}
        runsThisMonth={summary.totals.runsThisMonth}
        runsPerMonthLimit={!isLocal && isFreeTier ? runsPerMonthLimit : null}
        capabilities={capabilities}
        isLocal={isLocal}
        isFreeTier={isFreeTier}
        savedActors={summary.totals.savedActors}
        listCount={summary.totals.listCount}
      />
      <NextActionsSection summary={summary} workspace={workspaceNextActions} />
    </div>
  );
}
