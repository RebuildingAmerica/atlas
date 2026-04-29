import { ArrowUpRight } from "lucide-react";
import type { Entry } from "@/types";
import {
  ProfileEntryLink,
  SectionHeading,
  entryTypeLabel,
  formatFreshness,
  formatLocation,
} from "./profile-showcase-primitives";

interface ProfilesFreshListProps {
  entries: Entry[];
  error?: Error | null;
  isLoading?: boolean;
}

/**
 * "New in Atlas" tail of the profiles surface.  A simple divided list
 * of recent additions, sorted by freshness, with an arrow affordance
 * that hints the row links into the full profile page.
 */
export function ProfilesFreshList({
  entries,
  error = null,
  isLoading = false,
}: ProfilesFreshListProps) {
  if (error) {
    return (
      <section className="space-y-4 pt-7">
        <SectionHeading title="New in Atlas" subtitle="Recent arrivals" />
        <p className="type-body-medium text-red-800">{error.message}</p>
      </section>
    );
  }

  if (!isLoading && entries.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5 pt-7">
      <SectionHeading title="New in Atlas" subtitle="Recent arrivals" />

      <div className="divide-surface-container-high divide-y">
        {isLoading
          ? Array.from({ length: 5 }, (_, index) => (
              <div key={`fresh-skeleton-${index}`} className="py-4">
                <div className="bg-surface-container-lowest h-14 animate-pulse rounded-[0.75rem]" />
              </div>
            ))
          : entries.map((entry) => (
              <ProfileEntryLink
                key={entry.id}
                entry={entry}
                className="group hover:text-accent flex flex-col gap-3 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="type-title-medium text-ink-strong truncate">{entry.name}</p>
                  <p className="type-body-medium text-ink-muted truncate">
                    {entryTypeLabel(entry)} · {formatLocation(entry)}
                  </p>
                </div>
                <div className="type-body-medium text-ink-muted flex shrink-0 items-center gap-3">
                  <span>{entry.source_count} sources</span>
                  {formatFreshness(entry.latest_source_date) ? (
                    <span>{formatFreshness(entry.latest_source_date)}</span>
                  ) : null}
                  <ArrowUpRight className="h-4 w-4" />
                </div>
              </ProfileEntryLink>
            ))}
      </div>
    </section>
  );
}
