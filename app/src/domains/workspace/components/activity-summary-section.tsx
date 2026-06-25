/**
 * "What changed" activity band for the research home.
 *
 * Answers "why come back": the count of new sources Atlas surfaced for the
 * actors the user tracks this week, plus the newest few rows inline (reusing
 * the shared {@link FeedItemRow}), with a link to the full feed. When nothing
 * is tracked yet, it prompts the user to start following actors instead of
 * showing an empty shell.
 */
import { Link } from "@tanstack/react-router";
import { FeedItemRow, type FeedItemRowData } from "@/domains/catalog/components/feed/feed-item-row";
import type { ActivitySummary, FeedActivityItem } from "../server/research-summary";

interface ActivitySummarySectionProps {
  /** The derived activity summary from the research loader. */
  activity: ActivitySummary;
}

/**
 * Maps a loader activity item onto the shared feed-row data shape.
 *
 * @param item - The activity item from the research summary.
 * @returns The feed-row data the shared {@link FeedItemRow} renders.
 */
function toFeedRowData(item: FeedActivityItem): FeedItemRowData {
  return {
    entry_id: item.entryId,
    entry_name: item.entryName,
    entry_slug: item.entrySlug ?? undefined,
    entry_type: item.entryType,
    source_id: item.sourceId,
    source_url: item.sourceUrl,
    source_title: item.sourceTitle ?? undefined,
    source_publication: item.sourcePublication ?? undefined,
    ingested_at: item.ingestedAt,
  };
}

/**
 * The home activity band, server-default from the loader summary.
 */
export function ActivitySummarySection({ activity }: ActivitySummarySectionProps) {
  const { newSourcesThisWeek, recentItems } = activity;
  const sourceLabel = newSourcesThisWeek === 1 ? "new source" : "new sources";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-headline-small text-ink-strong">What changed</h2>
        {recentItems.length > 0 ? (
          <Link to="/feed" className="type-label-large text-ink-strong underline">
            See all activity
          </Link>
        ) : null}
      </div>

      {recentItems.length === 0 ? (
        <div className="border-outline-variant bg-surface-container space-y-2 rounded-[1rem] border p-5">
          <p className="type-body-medium text-ink-strong">Your activity feed is quiet.</p>
          <p className="type-body-small text-ink-soft">
            Follow actors to see when they appear in new sources.{" "}
            <Link to="/profiles" className="text-accent underline">
              Browse profiles
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="type-body-large text-ink-soft">
            Your tracked actors appeared in{" "}
            <span className="text-ink-strong font-semibold">
              {newSourcesThisWeek} {sourceLabel}
            </span>{" "}
            this week.
          </p>
          <ul className="space-y-3">
            {recentItems.map((item) => (
              <FeedItemRow key={`${item.entryId}-${item.sourceId}`} item={toFeedRowData(item)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
