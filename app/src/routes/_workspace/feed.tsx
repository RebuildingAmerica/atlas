import { createFileRoute } from "@tanstack/react-router";
import { useFollowingFeed } from "@/domains/catalog/hooks/use-claims";
import { FeedItemRow, type FeedItemRowData } from "@/domains/catalog/components/feed/feed-item-row";
import { Badge } from "@/platform/ui/badge";

export const Route = createFileRoute("/_workspace/feed")({
  component: FeedRoute,
});

function FeedRoute() {
  const feed = useFollowingFeed(50);
  const items = (feed.data?.items ?? []) as unknown as FeedItemRowData[];

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-12">
      <header className="space-y-2">
        <Badge variant="info">Activity</Badge>
        <h1 className="type-display-small text-ink-strong">Following</h1>
        <p className="type-body-large text-ink-soft">
          New sources Atlas has surfaced for the profiles you follow, newest first.
        </p>
      </header>

      {feed.isLoading ? (
        <p className="type-body-medium text-ink-soft">Loading feed…</p>
      ) : items.length === 0 ? (
        <div className="bg-surface-container space-y-2 rounded-[1rem] p-5">
          <p className="type-body-medium text-ink-strong">Nothing here yet.</p>
          <p className="type-body-small text-ink-soft">
            Click <span className="font-semibold">Follow</span> on any profile to start receiving
            updates here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <FeedItemRow key={`${item.entry_id}-${item.source_id}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
