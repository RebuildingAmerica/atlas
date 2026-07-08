import { Clipboard } from "lucide-react";
import {
  RESEARCH_GOAL_LABELS,
  type DiscoveryRunRecord,
} from "@/domains/discovery/discovery-run-summary";
import type { CreatedBriefLink, CreatedCoverageTargetLink } from "./discovery-runs-panel-parts";
import { DiscoveryRunsPanelSummary } from "./discovery-runs-panel-parts";

interface DiscoveryRunsPanelProps {
  createdBriefs?: Record<string, CreatedBriefLink>;
  createdCoverageTargets?: Record<string, CreatedCoverageTargetLink>;
  createBriefErrors?: Record<string, string | null>;
  createCoverageTargetErrors?: Record<string, string | null>;
  creatingBriefRunId?: string | null;
  creatingCoverageTargetRunId?: string | null;
  isLoading: boolean;
  onCreateBrief?: (run: DiscoveryRunRecord) => void;
  onCreateCoverageTarget?: (run: DiscoveryRunRecord) => void;
  onWatchTopLeads?: (run: DiscoveryRunRecord) => void;
  runs: DiscoveryRunRecord[];
  selectedRunId?: string;
  watchedLeadCounts?: Record<string, number>;
  watchLeadErrors?: Record<string, string | null>;
  watchingLeadsRunId?: string | null;
}

export function DiscoveryRunsPanel({
  createdBriefs = {},
  createdCoverageTargets = {},
  createBriefErrors = {},
  createCoverageTargetErrors = {},
  creatingBriefRunId = null,
  creatingCoverageTargetRunId = null,
  isLoading,
  onCreateBrief,
  onCreateCoverageTarget,
  onWatchTopLeads,
  runs,
  selectedRunId,
  watchedLeadCounts = {},
  watchLeadErrors = {},
  watchingLeadsRunId = null,
}: DiscoveryRunsPanelProps) {
  return (
    <section className="border-border-strong bg-surface space-y-5 rounded-[1rem] border p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="type-headline-small text-ink-strong">Recent research</h1>
          <p className="type-body-medium text-ink-muted">Briefs, source counts, and gaps.</p>
        </div>
        <span className="border-border type-label-large text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <Clipboard className="h-4 w-4" aria-hidden />
          {runs.length} requests
        </span>
      </div>

      {isLoading ? (
        <p className="type-body-medium text-ink-muted">Loading...</p>
      ) : runs.length > 0 ? (
        <div className="divide-border divide-y">
          {runs.map((run) => {
            const isSelected = selectedRunId === run.id;
            return (
              <article
                key={run.id}
                aria-current={isSelected ? "true" : undefined}
                className={
                  isSelected
                    ? "bg-surface-container-lowest border-outline-variant space-y-3 border-l-4 px-4 py-4 first:pt-4 last:pb-4"
                    : "space-y-3 py-4 first:pt-0 last:pb-0"
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="type-title-small text-ink-strong">{run.location_query}</h2>
                    <p className="type-body-small text-ink-muted mt-1">
                      {new Date(run.started_at).toLocaleString()} · {run.state}
                    </p>
                    <p className="type-label-medium text-ink-soft mt-2">
                      {RESEARCH_GOAL_LABELS[run.research_goal ?? "landscape_scan"]}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {isSelected ? (
                      <span className="type-label-large border-outline-variant text-ink-strong rounded-full border px-3 py-1">
                        Selected run
                      </span>
                    ) : null}
                    <span className="type-label-large border-border text-ink-soft rounded-full border px-3 py-1">
                      {run.status}
                    </span>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-4">
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

                {run.research_summary ? (
                  <DiscoveryRunsPanelSummary
                    createdBrief={createdBriefs[run.id]}
                    createdCoverageTarget={createdCoverageTargets[run.id]}
                    createBriefError={createBriefErrors[run.id]}
                    createCoverageTargetError={createCoverageTargetErrors[run.id]}
                    isCreatingBrief={creatingBriefRunId === run.id}
                    isCreatingCoverageTarget={creatingCoverageTargetRunId === run.id}
                    isWatchingLeads={watchingLeadsRunId === run.id}
                    onCreateBrief={
                      onCreateBrief
                        ? () => {
                            onCreateBrief(run);
                          }
                        : undefined
                    }
                    onCreateCoverageTarget={
                      onCreateCoverageTarget
                        ? () => {
                            onCreateCoverageTarget(run);
                          }
                        : undefined
                    }
                    onWatchTopLeads={
                      onWatchTopLeads
                        ? () => {
                            onWatchTopLeads(run);
                          }
                        : undefined
                    }
                    researchGoal={run.research_goal ?? "landscape_scan"}
                    run={run}
                    summary={run.research_summary}
                    watchedLeadCount={watchedLeadCounts[run.id]}
                    watchLeadError={watchLeadErrors[run.id]}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="type-body-medium text-ink-muted">No research yet.</p>
      )}
    </section>
  );
}
