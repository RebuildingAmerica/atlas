import { Link, createFileRoute } from "@tanstack/react-router";
import { useFollowingFeed } from "@/domains/catalog/hooks/use-claims";
import { Badge } from "@/platform/ui/badge";

export const Route = createFileRoute("/_workspace/feed")({
  component: FeedRoute,
});

interface FeedItem {
  entry_id: string;
  entry_name: string;
  entry_slug?: string;
  entry_type: string;
  source_id: string;
  source_url: string;
  source_title?: string;
  source_publication?: string;
  ingested_at: string;
}

function FeedRoute() {
  const feed = useFollowingFeed(50);
  const items = (feed.data?.items ?? []) as unknown as FeedItem[];

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
          {items.map((item) => {
            const segment = item.entry_type === "organization" ? "organizations" : "people";
            return (
              <li
                key={`${item.entry_id}-${item.source_id}`}
                className="border-outline-variant bg-surface-container-lowest rounded-[1rem] border p-4"
              >
                <p className="type-label-small text-ink-muted">
                  {new Date(item.ingested_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                {item.entry_slug ? (
                  <Link
                    to={`/profiles/${segment}/$slug` as "/profiles/people/$slug"}
                    params={{ slug: item.entry_slug }}
                    className="type-title-medium text-ink-strong inline hover:underline"
                  >
                    {item.entry_name}
                  </Link>
                ) : (
                  <span className="type-title-medium text-ink-strong">{item.entry_name}</span>
                )}
                <p className="type-body-medium text-ink-soft mt-1">
                  New source:{" "}
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {item.source_title ?? item.source_url}
                  </a>
                  {item.source_publication ? ` · ${item.source_publication}` : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
