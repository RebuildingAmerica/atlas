/**
 * "Pick up where you left off" recent-searches strip for the research home.
 *
 * Lists the user's most recent discovery runs as cards that re-enter the
 * discovery surface, and shows an honest free-run counter ("1 of 2 free runs
 * used this month") as context rather than a wall. The counter is only shown
 * when a finite monthly run limit applies; paid and local-mode users see no
 * counter. When the user has run nothing yet, it invites a first search.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { RecentRunSummary } from "../server/research-summary";

interface RecentSearchesSectionProps {
  /** The user's most recent discovery runs from the research loader. */
  runs: RecentRunSummary[];
  /** Discovery runs the user has started in the current month. */
  runsThisMonth: number;
  /**
   * The finite monthly run allowance to surface, or null when unlimited or
   * when no honest counter should be shown (paid plans, local mode).
   */
  runsPerMonthLimit: number | null;
}

interface RecentRunCardProps {
  /** The discovery run this card represents. */
  run: RecentRunSummary;
}

/**
 * A single recent-run card linking back into the discovery surface.
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
 * The home recent-searches strip, server-default from the loader summary.
 */
export function RecentSearchesSection({
  runs,
  runsThisMonth,
  runsPerMonthLimit,
}: RecentSearchesSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-headline-small text-ink-strong">Recent searches</h2>
        <Link to="/discovery" className="type-label-large text-ink-strong underline">
          New search
        </Link>
      </div>

      {runsPerMonthLimit !== null ? (
        <p className="type-body-small text-ink-soft">
          {runsThisMonth} of {runsPerMonthLimit} free {runsPerMonthLimit === 1 ? "run" : "runs"}{" "}
          used this month.
        </p>
      ) : null}

      {runs.length === 0 ? (
        <div className="border-outline-variant bg-surface-container space-y-2 rounded-[1rem] border p-5">
          <p className="type-body-medium text-ink-strong">No searches yet.</p>
          <p className="type-body-small text-ink-soft">
            Run a discovery search to find people and organizations working on an issue.{" "}
            <Link to="/discovery" className="text-accent underline">
              Start a search
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((run) => (
            <RecentRunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </section>
  );
}
