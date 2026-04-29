import { Badge } from "@/platform/ui/badge";
import type { Entry } from "@/types";
import {
  EntryHeroMedia,
  ProfileEntryLink,
  ProfileMeta,
  entryTypeLabel,
  formatFreshness,
  formatLocation,
} from "./profile-showcase-primitives";

interface SpotlightCardProps {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
}

/**
 * Hero spotlight card used at the top of the profiles marquee.  Shows
 * a wide hero image (or initials gradient), the entry's name and
 * description, the location / source / freshness summary, and the
 * issue-area badge row with three slots so the spotlight communicates
 * the entry's coverage at a glance.
 */
export function SpotlightCard({ entry, issueAreaLabels }: SpotlightCardProps) {
  const freshness = formatFreshness(entry.latest_source_date);
  return (
    <ProfileEntryLink
      entry={entry}
      className="group bg-surface-container-lowest border-border hover:border-border-strong flex h-full flex-col overflow-hidden rounded-[1.25rem] border transition-colors duration-200"
    >
      <EntryHeroMedia
        entry={entry}
        className="aspect-[16/9]"
        initialsClassName="type-display-large"
      />
      <article className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-surface-container-high text-ink-strong">Featured</Badge>
          <p className="type-label-small text-ink-muted tracking-[0.2em] uppercase">
            {entryTypeLabel(entry)}
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="type-headline-small text-ink-strong max-w-xl leading-tight font-medium">
            {entry.name}
          </h2>
          <p className="type-body-medium text-ink-soft max-w-xl leading-relaxed">
            {entry.description}
          </p>
        </div>
        <div className="type-body-small text-ink-soft mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{formatLocation(entry)}</span>
          <span aria-hidden>·</span>
          <span>{entry.source_count} sources</span>
          {freshness ? (
            <>
              <span aria-hidden>·</span>
              <span>Updated {freshness}</span>
            </>
          ) : null}
        </div>
        <ProfileMeta entry={entry} issueAreaLabels={issueAreaLabels} maxIssues={3} />
      </article>
    </ProfileEntryLink>
  );
}
