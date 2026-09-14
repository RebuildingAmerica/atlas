import { Search } from "lucide-react";

const PLACEHOLDER_BLOCK = "bg-surface-container animate-pulse rounded";

/** One key per placeholder in the stats row and the profile list. */
const STAT_PLACEHOLDERS = ["profiles", "sources", "source-backed", "review"] as const;
const ENTRY_PLACEHOLDERS = ["first", "second", "third"] as const;

/**
 * A public directory while its listings are still on the way.
 *
 * It holds the directory's frame, with the search box shown but disabled
 * because there is nothing to search yet, so the listings land in place
 * rather than replacing a blank or an error.
 */
export function PublicDirectorySkeleton() {
  return (
    <div aria-busy="true" className="bg-page-bg">
      <p role="status" className="sr-only">
        Loading this directory
      </p>
      <section className="border-border bg-surface-container-low border-b px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-4">
          <p className="type-label-medium text-ink-muted tracking-wider uppercase">
            Public directory
          </p>
          <div className="space-y-3">
            <div aria-hidden="true" className={`${PLACEHOLDER_BLOCK} h-10 w-2/3`} />
            <p className="type-body-large text-ink-soft max-w-3xl">
              Source-linked actors, profiles, and public evidence.
            </p>
          </div>
          <div aria-hidden="true" className="grid gap-4 pt-2 sm:grid-cols-4">
            {STAT_PLACEHOLDERS.map((key) => (
              <div key={key} className={`${PLACEHOLDER_BLOCK} h-10`} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-8">
        <label className="grid max-w-xl gap-2">
          <span className="type-label-medium text-ink-strong">Search directory</span>
          <span className="relative">
            <Search
              className="text-ink-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden
            />
            <input
              type="search"
              disabled
              className="border-border bg-surface-container-lowest text-ink-strong placeholder:text-ink-muted w-full border py-2 pr-3 pl-9 outline-none disabled:opacity-60"
              placeholder="Name, issue, place, or source"
            />
          </span>
        </label>

        {ENTRY_PLACEHOLDERS.map((key) => (
          <div
            key={key}
            aria-hidden="true"
            className="border-border bg-surface-container-lowest grid gap-3 border p-5"
          >
            <div className={`${PLACEHOLDER_BLOCK} h-6 w-1/2`} />
            <div className={`${PLACEHOLDER_BLOCK} h-4 w-full`} />
            <div className={`${PLACEHOLDER_BLOCK} h-4 w-1/3`} />
          </div>
        ))}
      </section>
    </div>
  );
}
