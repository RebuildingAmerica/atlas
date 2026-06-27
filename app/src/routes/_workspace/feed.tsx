import { createFileRoute } from "@tanstack/react-router";
import { useFollowingFeed } from "@/domains/catalog/hooks/use-claims";
import { FeedItemRow, type FeedItemRowData } from "@/domains/catalog/components/feed/feed-item-row";
import { ChangeClassificationSection } from "@/domains/workspace/components/change-classification-section";
import { Badge } from "@/platform/ui/badge";

export const Route = createFileRoute("/_workspace/feed")({
  component: FeedRoute,
});

interface MonitoringDigest {
  actorCount: number;
  sourceSignalCount: number;
  thisWeekCount: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildMonitoringDigest(items: FeedItemRowData[], now = new Date()): MonitoringDigest {
  const cutoff = now.getTime() - WEEK_MS;
  return {
    actorCount: new Set(items.map((item) => item.entry_id)).size,
    sourceSignalCount: items.length,
    thisWeekCount: items.filter((item) => new Date(item.ingested_at).getTime() >= cutoff).length,
  };
}

function FeedRoute() {
  const feed = useFollowingFeed(50);
  const items = (feed.data?.items ?? []) as unknown as FeedItemRowData[];
  const digest = buildMonitoringDigest(items);

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-12">
      <header className="space-y-2">
        <Badge variant="info">Activity</Badge>
        <h1 className="type-display-small text-ink-strong">Monitoring digest</h1>
        <p className="type-body-large text-ink-soft">
          High-signal source changes for the profiles you follow.
        </p>
      </header>

      {feed.isLoading ? (
        <p className="type-body-medium text-ink-soft">Loading</p>
      ) : items.length === 0 ? (
        <div className="bg-surface-container space-y-2 rounded-[1rem] p-5">
          <p className="type-body-medium text-ink-strong">No followed-profile updates.</p>
          <p className="type-body-small text-ink-soft">
            Follow profiles to track new source signals.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <section
            aria-label="Monitoring summary"
            className="bg-surface-container grid gap-3 rounded-[1rem] p-4 sm:grid-cols-3"
          >
            <div>
              <p className="type-label-small text-ink-muted">Source signals</p>
              <p className="type-title-medium text-ink-strong">
                {pluralize(digest.sourceSignalCount, "source signal")}
              </p>
            </div>
            <div>
              <p className="type-label-small text-ink-muted">Actors</p>
              <p className="type-title-medium text-ink-strong">
                {pluralize(digest.actorCount, "followed actor")}
              </p>
            </div>
            <div>
              <p className="type-label-small text-ink-muted">Recent</p>
              <p className="type-title-medium text-ink-strong">
                {pluralize(digest.thisWeekCount, "this week", "this week")}
              </p>
            </div>
          </section>
          <ChangeClassificationSection items={items} />
          <ul className="space-y-3">
            {items.map((item) => (
              <FeedItemRow key={`${item.entry_id}-${item.source_id}`} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
