import type { WatchlistSummary } from "../server/research-summary";

interface WatchlistsSummarySectionProps {
  /** Place and issue watchlists inferred from recent research activity. */
  watchlists: WatchlistSummary[];
}

interface WatchlistCardProps {
  /** The watchlist rendered by this card. */
  watchlist: WatchlistSummary;
}

interface WatchlistDigest {
  placeCount: number;
  issueCount: number;
  researchSetCount: number;
}

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function watchlistKindLabel(kind: WatchlistSummary["kind"]) {
  if (kind === "place") {
    return "Place";
  }
  if (kind === "issue") {
    return "Issue";
  }
  return "Research set";
}

function buildWatchlistDigest(watchlists: WatchlistSummary[]): WatchlistDigest {
  return {
    placeCount: watchlists.filter((watchlist) => watchlist.kind === "place").length,
    issueCount: watchlists.filter((watchlist) => watchlist.kind === "issue").length,
    researchSetCount: watchlists.filter((watchlist) => watchlist.kind === "research_set").length,
  };
}

function WatchlistCard({ watchlist }: WatchlistCardProps) {
  return (
    <article className="border-outline-variant bg-surface-container-lowest space-y-2 rounded-[1rem] border p-4">
      <p className="type-label-small text-ink-muted">{watchlistKindLabel(watchlist.kind)}</p>
      <p className="type-title-medium text-ink-strong">{watchlist.label}</p>
      <p className="type-body-small text-ink-soft">{watchlist.detail}</p>
      <p className="type-label-medium text-ink-strong">{watchlist.changedSinceLastTime}</p>
    </article>
  );
}

/** Place and issue watchlists for recurring research beats. */
export function WatchlistsSummarySection({ watchlists }: WatchlistsSummarySectionProps) {
  const digest = buildWatchlistDigest(watchlists);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-headline-small text-ink-strong">Watchlists</h2>
        <a href="/discovery" className="type-label-large text-ink-strong underline">
          Start research
        </a>
      </div>

      {watchlists.length === 0 ? (
        <div className="border-outline-variant bg-surface-container space-y-2 rounded-[1rem] border p-5">
          <p className="type-body-medium text-ink-strong">No watchlists yet.</p>
          <p className="type-body-small text-ink-soft">
            Start place or issue research to create a watchlist.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <section
            aria-label="Watchlist digest"
            className="bg-surface-container grid gap-3 rounded-[1rem] p-4 sm:grid-cols-3"
          >
            <div>
              <p className="type-label-small text-ink-muted">Digest</p>
              <p className="type-title-medium text-ink-strong">
                {countLabel(digest.placeCount, "place")}
              </p>
            </div>
            <div>
              <p className="type-label-small text-ink-muted">Tracked issues</p>
              <p className="type-title-medium text-ink-strong">
                {countLabel(digest.issueCount, "issue")}
              </p>
            </div>
            <div>
              <p className="type-label-small text-ink-muted">Research sets</p>
              <p className="type-title-medium text-ink-strong">
                {countLabel(digest.researchSetCount, "research set")}
              </p>
            </div>
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            {watchlists.slice(0, 4).map((watchlist) => (
              <WatchlistCard key={watchlist.id} watchlist={watchlist} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
