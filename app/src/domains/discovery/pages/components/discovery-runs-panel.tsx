import type { DiscoveryRun } from "@/types";

/**
 * Discovery run shape used by the UI while older responses may still
 * include an optional `error_message`.
 */
export interface DiscoveryRunRecord extends DiscoveryRun {
  error_message?: string | null;
}

interface DiscoveryRunsPanelProps {
  isLoading: boolean;
  runs: DiscoveryRunRecord[];
}

/**
 * Right-rail panel listing the most recent discovery runs and the high-
 * level counters (sources fetched, entries extracted, after-dedup) so the
 * operator can spot stalled or failing runs at a glance.
 */
export function DiscoveryRunsPanel({ isLoading, runs }: DiscoveryRunsPanelProps) {
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
