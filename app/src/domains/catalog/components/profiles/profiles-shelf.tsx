import type { ReactNode } from "react";
import type { Entry } from "@/types";
import { SectionHeading, ShelfCard } from "./profile-showcase-primitives";

interface ProfilesShelfProps {
  entries: Entry[];
  error?: Error | null;
  icon?: ReactNode;
  isLoading?: boolean;
  issueAreaLabels: Record<string, string>;
  subtitle?: string;
  title: string;
}

/**
 * Horizontal scrolling shelf of ShelfCards.  Used for the "people"
 * and "organizations" curated rows on the profiles surface.  Hides
 * itself entirely when the loaded list is empty so the surrounding
 * page does not render an empty section.
 */
export function ProfilesShelf({
  entries,
  error = null,
  icon,
  isLoading = false,
  issueAreaLabels,
  subtitle,
  title,
}: ProfilesShelfProps) {
  if (error) {
    return (
      <section className="space-y-4 pt-7">
        <SectionHeading icon={icon} subtitle={subtitle} title={title} />
        <p className="type-body-medium text-red-800">{error.message}</p>
      </section>
    );
  }

  if (!isLoading && entries.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5 pt-7">
      <SectionHeading icon={icon} subtitle={subtitle} title={title} />

      <div className="flex gap-4 overflow-x-auto pb-3">
        {isLoading
          ? Array.from({ length: 4 }, (_, index) => (
              <div
                key={`${title}-skeleton-${index}`}
                className="bg-surface-container-lowest h-[22rem] w-[18.5rem] shrink-0 animate-pulse rounded-[1rem]"
              />
            ))
          : entries.map((entry) => (
              <ShelfCard key={entry.id} entry={entry} issueAreaLabels={issueAreaLabels} />
            ))}
      </div>
    </section>
  );
}
