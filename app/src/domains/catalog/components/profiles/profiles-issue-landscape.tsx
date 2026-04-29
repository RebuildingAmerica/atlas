import { Building2 } from "lucide-react";
import type { Entry } from "@/types";
import {
  ProfileEntryLink,
  SectionHeading,
  entryTypeLabel,
  formatLocation,
} from "./profile-showcase-primitives";

export interface IssueLandscapeGroup {
  entries: Entry[];
  error?: Error | null;
  issueArea: string;
  title: string;
}

function IssueClusterColumn({
  entries,
  error,
  title,
}: {
  entries: Entry[];
  error?: Error | null;
  title: string;
}) {
  if (error) {
    return (
      <div className="space-y-3">
        <h3 className="type-title-large text-ink-strong">{title}</h3>
        <p className="type-body-medium text-red-800">{error.message}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="type-title-large text-ink-strong">{title}</h3>
      <div className="divide-outline-variant bg-surface-container-lowest divide-y rounded-[1rem] px-5">
        {entries.slice(0, 4).map((entry) => (
          <ProfileEntryLink
            key={entry.id}
            entry={entry}
            className="group hover:text-accent flex items-center justify-between gap-4 py-4 transition-colors"
          >
            <div className="min-w-0 space-y-1">
              <p className="type-title-small text-ink-strong truncate">{entry.name}</p>
              <p className="type-body-medium text-ink-muted truncate">{formatLocation(entry)}</p>
            </div>
            <div className="type-body-medium text-ink-muted shrink-0 text-right">
              <p>{entryTypeLabel(entry)}</p>
              <p>{entry.source_count} sources</p>
            </div>
          </ProfileEntryLink>
        ))}
      </div>
    </div>
  );
}

interface ProfilesIssueLandscapeProps {
  groups: IssueLandscapeGroup[];
  isLoading?: boolean;
}

/**
 * Two-column issue-landscape band, surfacing the top entries per issue
 * cluster Atlas surfaces.  Each column compresses to four rows so the
 * section stays scannable; the whole section hides itself when every
 * group is empty after filtering.
 */
export function ProfilesIssueLandscape({ groups, isLoading = false }: ProfilesIssueLandscapeProps) {
  const visibleGroups = groups.filter((group) => group.entries.length > 0 || group.error);

  if (!isLoading && visibleGroups.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5 pt-7">
      <SectionHeading
        icon={<Building2 className="h-4 w-4" />}
        subtitle="Issue landscapes"
        title="Where the work is clustering"
      />

      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={`issue-skeleton-${index}`} className="space-y-4">
              <div className="bg-surface-container-low h-8 w-48 animate-pulse rounded-full" />
              <div className="bg-surface-container-lowest h-56 animate-pulse rounded-[1rem]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          {visibleGroups.map((group) => (
            <IssueClusterColumn
              key={group.issueArea}
              entries={group.entries}
              error={group.error}
              title={group.title}
            />
          ))}
        </div>
      )}
    </section>
  );
}
