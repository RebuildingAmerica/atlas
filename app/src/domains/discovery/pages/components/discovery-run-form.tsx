import { Button } from "@/platform/ui/button";

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
 * Form panel that captures location, state, and selected issue areas
 * before kicking off a discovery run.  The submit button stays disabled
 * until the workspace has the research capability and every required
 * field is populated.
 */
export function DiscoveryRunForm({
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
          {isTaxonomyLoading ? null : issueAreas.length > 0 ? (
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
            <p className="type-body-medium text-ink-muted">Could not load issue areas.</p>
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
      </div>
    </form>
  );
}
