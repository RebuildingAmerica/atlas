import { useMemo, useState } from "react";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { useDiscoveryRuns, useStartDiscovery } from "@/domains/discovery/hooks/use-discovery";
import { Button } from "@/platform/ui/button";

/**
 * Renders the operator-facing discovery workspace.
 */
export function DiscoveryPage() {
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

  const latestRuns = runsQuery.data?.items ?? [];

  const handleToggleIssue = (slug: string) => {
    setSelectedIssues((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!locationQuery.trim() || state.trim().length !== 2 || selectedIssues.length === 0) {
      return;
    }

    startDiscovery.mutate(
      {
        location_query: locationQuery.trim(),
        state: state.trim().toUpperCase(),
        issue_areas: selectedIssues,
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

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="type-headline-large text-[var(--ink-strong)]">Admin</h1>
        <p className="type-body-large max-w-3xl text-[var(--ink-soft)]">
          Start discovery runs and check recent run status in one place.
        </p>
      </section>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-[1.5rem] border border-[var(--border-strong)] bg-[var(--surface)] p-6"
        >
          <div className="space-y-2">
            <h2 className="type-title-large text-[var(--ink-strong)]">Start a discovery run</h2>
            <p className="type-body-medium text-[var(--ink-muted)]">
              Enter a location, state, and at least one issue area.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem]">
            <label className="space-y-2">
              <span className="type-label-large text-[var(--ink-strong)]">Location</span>
              <input
                value={locationQuery}
                onChange={(event) => {
                  setLocationQuery(event.target.value);
                }}
                placeholder="Kansas City, MO"
                className="type-body-large w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-[var(--ink-strong)] outline-none"
              />
            </label>

            <label className="space-y-2">
              <span className="type-label-large text-[var(--ink-strong)]">State</span>
              <input
                value={state}
                onChange={(event) => {
                  setState(event.target.value.toUpperCase().slice(0, 2));
                }}
                placeholder="MO"
                className="type-body-large w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-[var(--ink-strong)] outline-none"
              />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="type-label-large text-[var(--ink-strong)]">Issue areas</p>
              <p className="type-body-medium text-[var(--ink-muted)]">
                {selectedIssues.length} selected
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-white p-3">
              {taxonomyQuery.isLoading ? (
                <p className="type-body-medium text-[var(--ink-muted)]">Loading issue areas...</p>
              ) : issueAreas.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {issueAreas.map((issue) => (
                    <label
                      key={issue.slug}
                      className="flex items-start gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-[var(--border)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIssues.includes(issue.slug)}
                        onChange={() => {
                          handleToggleIssue(issue.slug);
                        }}
                        className="mt-1"
                      />
                      <span>
                        <span className="type-title-small block text-[var(--ink-strong)]">
                          {issue.name}
                        </span>
                        <span className="type-body-small mt-1 block text-[var(--ink-muted)]">
                          {issue.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="type-body-medium text-[var(--ink-muted)]">
                  Issue areas are unavailable right now.
                </p>
              )}
            </div>
          </div>

          {startDiscovery.error ? (
            <p className="type-body-medium text-red-700">
              Could not start the run. Check the fields and try again.
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={
                startDiscovery.isPending ||
                !locationQuery.trim() ||
                state.trim().length !== 2 ||
                selectedIssues.length === 0
              }
            >
              {startDiscovery.isPending ? "Starting..." : "Start run"}
            </Button>
            <p className="type-body-medium text-[var(--ink-muted)]">
              Runs are added to the list below.
            </p>
          </div>
        </form>

        <section className="space-y-4 rounded-[1.5rem] border border-[var(--border-strong)] bg-[var(--surface)] p-6">
          <div className="space-y-2">
            <h2 className="type-title-large text-[var(--ink-strong)]">Recent runs</h2>
            <p className="type-body-medium text-[var(--ink-muted)]">
              The latest discovery runs and their current status.
            </p>
          </div>

          {runsQuery.isLoading ? (
            <p className="type-body-medium text-[var(--ink-muted)]">Loading runs...</p>
          ) : latestRuns.length > 0 ? (
            <div className="space-y-3">
              {latestRuns.map((run) => (
                <article
                  key={run.id}
                  className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="type-title-small text-[var(--ink-strong)]">
                        {run.location_query}
                      </p>
                      <p className="type-body-small mt-1 text-[var(--ink-muted)]">
                        {new Date(run.started_at).toLocaleString()} · {run.state}
                      </p>
                    </div>
                    <span className="type-label-large rounded-full border border-[var(--border)] px-3 py-1 text-[var(--ink-soft)]">
                      {run.status}
                    </span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <p className="type-body-medium text-[var(--ink-soft)]">
                      {run.issue_areas.length} issue areas
                    </p>
                    <p className="type-body-medium text-[var(--ink-soft)]">
                      {run.entries_extracted} entries extracted
                    </p>
                    <p className="type-body-medium text-[var(--ink-soft)]">
                      {run.sources_fetched} sources fetched
                    </p>
                    <p className="type-body-medium text-[var(--ink-soft)]">
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
            <p className="type-body-medium text-[var(--ink-muted)]">No discovery runs yet.</p>
          )}
        </section>
      </section>
    </div>
  );
}
