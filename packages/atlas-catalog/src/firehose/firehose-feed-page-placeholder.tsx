import { buildPublicFirehoseSearchParams } from "./public-feed";
import type { PublicFirehoseQuery } from "./public-feed";
import { DENSITY_OPTIONS } from "./firehose-feed-page-utils";

interface FirehoseFeedPlaceholderProps {
  query: PublicFirehoseQuery;
}

/** One key per placeholder row in the feed. */
const PLACEHOLDER_ROWS = ["first", "second", "third", "fourth"] as const;

/**
 * The Firehose heading, shared by the feed and its placeholder so the two
 * cannot drift apart while a visitor watches one turn into the other.
 */
export function FirehoseFeedTitle() {
  return (
    <div className="space-y-2">
      <h1 className="type-display-small text-ink-strong">Firehose</h1>
      <p className="type-body-large text-ink-soft">
        Latest source-backed public civic updates.
      </p>
    </div>
  );
}

/**
 * The Firehose page while its first snapshot is still on the way.
 *
 * It keeps the header, the RSS link and the density controls in place and
 * holds the feed's space with quiet rows, so the page never reports a failure
 * and the updates land without the layout moving.
 */
export function FirehoseFeedPlaceholder({
  query,
}: FirehoseFeedPlaceholderProps) {
  const rssParams = buildPublicFirehoseSearchParams(query).toString();
  const rssHref = rssParams ? `/firehose.rss?${rssParams}` : "/firehose.rss";

  return (
    <div className="bg-surface min-h-screen">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="border-outline-variant mb-5 border-b pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <FirehoseFeedTitle />
            <span className="type-label-medium bg-surface-container text-ink-strong rounded-md px-3 py-1.5">
              Loading updates
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <a
              className="type-label-medium text-accent underline underline-offset-4"
              href={rssHref}
            >
              RSS feed
            </a>
            <div
              aria-label="Feed density"
              className="bg-surface-container-lowest border-outline-variant inline-flex rounded-lg border p-1"
              role="group"
            >
              {DENSITY_OPTIONS.map((option) => (
                <button
                  aria-pressed={option.value === "standard"}
                  className="type-label-small text-ink-soft rounded-md px-3 py-1.5 disabled:opacity-60"
                  disabled
                  key={option.value}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div
          aria-busy="true"
          aria-label="Firehose events"
          className="border-outline-variant bg-surface-container-lowest grid gap-4 rounded-lg border p-4"
          role="feed"
        >
          {PLACEHOLDER_ROWS.map((row) => (
            <div aria-hidden="true" className="space-y-2" key={row}>
              <div className="bg-surface-container h-4 w-32 animate-pulse rounded" />
              <div className="bg-surface-container h-6 w-3/4 animate-pulse rounded" />
              <div className="bg-surface-container h-4 w-full animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
