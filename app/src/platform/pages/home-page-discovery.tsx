import { Link } from "@tanstack/react-router";
import { ArrowRight, ExternalLink } from "./home-page-data";
import {
  ISSUE_CHIPS,
  NUMBER_FORMATTER,
  type HomeFacetTile,
  browseUrl,
  formatLocation,
  humanizeIssue,
  profileHref,
  TYPE_LABELS,
} from "./home-page-data";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

interface HomeDiscoverySectionProps {
  entries: Entry[];
  issueTiles: HomeFacetTile[];
  recentEntriesLoading: boolean;
  totalEntries: number | undefined;
}

function RecentEntryRow({ entry }: { entry: Entry }) {
  const issue = humanizeIssue(entry.issue_areas[0]);
  const description = entry.description || formatLocation(entry);

  return (
    <a
      href={profileHref(entry)}
      className="group hover:bg-surface-container -mx-3 grid gap-3 px-3 py-4 no-underline transition-colors duration-150 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center"
    >
      <span className="type-label-small border-border-strong text-ink-soft w-fit border px-2 py-1">
        {TYPE_LABELS[entry.type]}
      </span>
      <span className="min-w-0">
        <span className="text-ink-strong font-serif text-base">{entry.name}</span>
        <span className="type-label-medium text-ink-soft mt-1 block truncate">{description}</span>
      </span>
      <span className="flex flex-wrap items-center gap-3 md:justify-end">
        <span className="type-label-small text-ink-soft">{formatLocation(entry)}</span>
        <span className="type-label-small border-border-strong text-civic border px-2 py-1">
          {issue}
        </span>
        <span className="type-label-small text-ink-soft">{entry.source_count} sources</span>
        <ExternalLink
          className="text-ink-muted h-3.5 w-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-70"
          aria-hidden="true"
        />
      </span>
    </a>
  );
}

export function HomeDiscoverySection({
  entries,
  issueTiles,
  recentEntriesLoading,
  totalEntries,
}: HomeDiscoverySectionProps) {
  const browseCount =
    totalEntries && totalEntries > 0 ? NUMBER_FORMATTER.format(totalEntries) : "actors";

  return (
    <>
      <section className="border-border border-b px-4 py-16 md:px-8">
        <div className="mx-auto max-w-[88rem]">
          <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="font-serif text-2xl">Recently indexed</h2>
            <Link
              to="/browse"
              className="type-label-medium text-accent-deep inline-flex items-center gap-1.5 hover:underline"
            >
              Browse all {browseCount}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          <div className="border-border mb-5 flex flex-wrap gap-2 border-b pb-5">
            {["All", "People", "Organizations", ...ISSUE_CHIPS].map((filter) => (
              <a
                key={filter}
                href={filter === "All" ? "/browse" : browseUrl(filter)}
                className="type-label-small border-border-strong text-ink-soft hover:bg-surface-container border px-3 py-1.5 no-underline transition-colors duration-150"
              >
                {filter}
              </a>
            ))}
            <span className="type-label-small text-ink-soft ml-auto self-center">
              {entries.length} shown
            </span>
          </div>

          {recentEntriesLoading ? null : entries.length > 0 ? (
            <div className="divide-border divide-y">
              {entries.map((entry) => (
                <RecentEntryRow key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <p className="type-body-medium text-ink-soft py-12 text-center">
              No people listed yet.
            </p>
          )}
        </div>
      </section>

      <section className="px-4 py-16 md:px-8">
        <div className="mx-auto max-w-[88rem]">
          <h2 className="font-serif text-2xl">Browse by issue</h2>
          <div className="bg-border mt-10 grid gap-px overflow-hidden md:grid-cols-4">
            {issueTiles.map((issue, index) => {
              const featured = index < 2;
              return (
                <a
                  key={issue.label}
                  href={issue.href}
                  className={
                    featured
                      ? "group bg-ink-strong relative flex min-h-72 flex-col justify-end overflow-hidden p-7 no-underline md:col-span-2"
                      : "group bg-surface-container-lowest hover:bg-surface-container flex min-h-32 flex-col justify-end p-6 no-underline transition-colors duration-150"
                  }
                >
                  <span className="relative">
                    <span
                      className={
                        featured
                          ? "type-label-small text-surface/65"
                          : "type-label-small text-ink-soft"
                      }
                    >
                      {issue.count}
                    </span>
                    <span
                      className={
                        featured
                          ? "text-surface mt-3 block font-serif text-3xl"
                          : "text-ink-strong mt-2 block font-medium"
                      }
                    >
                      {issue.label}
                    </span>
                    <span
                      className={
                        featured
                          ? "type-label-small text-surface/65 mt-5 inline-flex items-center gap-2"
                          : "type-label-small text-accent-deep mt-4 inline-flex items-center gap-2"
                      }
                    >
                      Explore
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p className="type-label-small text-ink-soft">{issueTiles.length} issue areas shown</p>
            <Link
              to="/browse"
              className="type-label-medium text-accent-deep inline-flex items-center gap-1.5 hover:underline"
            >
              View all issues
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
