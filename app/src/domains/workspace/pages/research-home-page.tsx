/**
 * Orchestrator for the authenticated "Your Research" home.
 *
 * Accepts the SSR loader payload, seeds React Query from it via
 * {@link useResearchSummary} so the page paints fully populated from the server
 * HTML and only revalidates on the client, and reads the operator session for
 * the greeting name and capability context. Each section is server-default:
 * it renders from the summary the loader already computed, never a client-fetch
 * shell, and degrades to honest empty states.
 */
import { useAtlasSession } from "@/domains/access";
import { useResearchSummary } from "../hooks/use-research-summary";
import type { ResearchSummary } from "../server/research-summary";
import { ResearchHomeHero } from "../components/research-home-hero";
import { ActivitySummarySection } from "../components/activity-summary-section";
import { ListsSummarySection } from "../components/lists-summary-section";
import { FollowsSummarySection } from "../components/follows-summary-section";
import { RecentSearchesSection } from "../components/recent-searches-section";
import { NextActionsSection } from "../components/next-actions-section";

interface ResearchHomePageProps {
  /** The SSR loader payload used to seed the summary query. */
  initialSummary: ResearchSummary;
}

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

/**
 * The full "Your Research" home surface, server-default and capability-aware.
 */
export function ResearchHomePage({ initialSummary }: ResearchHomePageProps) {
  const summaryQuery = useResearchSummary(initialSummary);
  const summary = summaryQuery.data;
  const session = useAtlasSession();

  const firstName = firstNameFrom(session.data?.user.name);
  const isLocal = session.data?.isLocal ?? false;
  const activeProducts = session.data?.workspace.activeProducts ?? [];
  const isFreeTier = activeProducts.length === 0;
  const runsPerMonthLimit = session.data
    ? session.data.workspace.resolvedCapabilities.limits.research_runs_per_month
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-12 py-12">
      <ResearchHomeHero firstName={firstName} summary={summary} />
      <ActivitySummarySection activity={summary.activity} />
      <ListsSummarySection lists={summary.lists} />
      <FollowsSummarySection activity={summary.activity} />
      <RecentSearchesSection
        runs={summary.recentRuns}
        runsThisMonth={summary.totals.runsThisMonth}
        runsPerMonthLimit={!isLocal && isFreeTier ? runsPerMonthLimit : null}
      />
      <NextActionsSection summary={summary} />
    </div>
  );
}
