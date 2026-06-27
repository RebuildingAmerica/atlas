/**
 * "Pick up where you left off" recent-research strip for the research home.
 *
 * Lists the user's most recent research requests as cards that re-enter the
 * research surface, and shows an honest free-request counter ("1 of 2 free
 * research requests used this month") as context rather than a wall. The
 * counter is only shown when a finite monthly request limit applies; paid and local-mode users see no
 * counter. When the user has run nothing yet, it invites a first search.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { SerializedResolvedCapabilities } from "@/domains/access/capabilities";
import type { RecentRunSummary } from "../server/research-summary";
import { ResearchValueNudge } from "./research-value-nudge";

interface RecentSearchesSectionProps {
  /** The user's most recent research requests from the research loader. */
  runs: RecentRunSummary[];
  /** Research requests the user has started in the current month. */
  runsThisMonth: number;
  /**
   * The finite monthly run allowance to surface, or null when unlimited or
   * when no honest counter should be shown (paid plans, local mode).
   */
  runsPerMonthLimit: number | null;
  /** The serialized capability/limit set from the session, or null when none. */
  capabilities: SerializedResolvedCapabilities | null;
  /** Whether the deployment is running in local (single-user) mode. */
  isLocal: boolean;
  /** Whether the user is on the free tier (no active paid products). */
  isFreeTier: boolean;
  /** Total actors saved across the user's lists. */
  savedActors: number;
  /** How many lists the user has created. */
  listCount: number;
}

interface RecentRunCardProps {
  /** The research request this card represents. */
  run: RecentRunSummary;
}

/**
 * A single recent-research card linking back into the research surface.
 */
function RecentRunCard({ run }: RecentRunCardProps) {
  return (
    <Link
      to="/discovery"
      className="border-outline-variant bg-surface-container-lowest block space-y-1 rounded-[1rem] border p-4"
    >
      <span className="type-title-medium text-ink-strong inline-flex items-center gap-2">
        {run.locationQuery}
        <ArrowUpRight className="text-ink-muted h-4 w-4" aria-hidden />
      </span>
      <span className="type-label-small text-ink-muted block">
        {run.state} · {run.status}
      </span>
    </Link>
  );
}

/**
 * The home recent-research strip, server-default from the loader summary.
 */
export function RecentSearchesSection({
  runs,
  runsThisMonth,
  runsPerMonthLimit,
  capabilities,
  isLocal,
  isFreeTier,
  savedActors,
  listCount,
}: RecentSearchesSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-headline-small text-ink-strong">Recent research</h2>
        <Link to="/discovery" className="type-label-large text-ink-strong underline">
          Start research
        </Link>
      </div>

      {runsPerMonthLimit !== null ? (
        <p className="type-body-small text-ink-soft">
          {runsThisMonth} of {runsPerMonthLimit} free research{" "}
          {runsPerMonthLimit === 1 ? "request" : "requests"} used this month.
        </p>
      ) : null}

      {runs.length === 0 ? (
        <div className="border-outline-variant bg-surface-container space-y-2 rounded-[1rem] border p-5">
          <p className="type-body-medium text-ink-strong">No research yet.</p>
          <p className="type-body-small text-ink-soft">
            Start research to find people and organizations working on an issue.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((run) => (
            <RecentRunCard key={run.id} run={run} />
          ))}
        </div>
      )}

      <ResearchValueNudge
        capabilities={capabilities}
        isLocal={isLocal}
        gate={{ kind: "unlimited", isFreeTier, savedActors, listCount, runsThisMonth }}
      />
    </section>
  );
}
