import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useWorkspaceWatchDigest } from "@/domains/workspace/hooks/use-workspace-watch-digest";
import type { WorkspaceWatchDigestItem } from "@/domains/workspace/server/watch-digest";
import { pluralize } from "@/lib/pluralize";
import { Badge } from "@/platform/ui/badge";

export const Route = createFileRoute("/_workspace/feed")({
  component: FeedRoute,
});

const DIGEST_LIMIT = 50;

function eventTypeLabel(item: WorkspaceWatchDigestItem): string {
  if (item.event_type === "new_source") {
    return "Source signal";
  }
  if (item.event_type === "coverage_status_changed") {
    return "Coverage change";
  }
  if (item.event_type === "relationship_added") {
    return "New connection";
  }
  if (item.event_type === "correction") {
    return "Correction";
  }
  return "Profile update";
}

function DigestItemRow({ item }: { item: WorkspaceWatchDigestItem }) {
  const sourceTitle = item.source?.title ?? item.source?.url ?? null;

  return (
    <li className="border-border bg-surface-container space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="type-label-small text-ink-muted">{eventTypeLabel(item)}</p>
          <h2 className="type-title-medium text-ink-strong">{item.title}</h2>
        </div>
        <time className="type-label-small text-ink-muted" dateTime={item.created_at}>
          {new Date(item.created_at).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </time>
      </div>

      <p className="type-body-medium text-ink-soft">{item.summary}</p>

      <div className="flex flex-wrap items-center gap-2">
        {item.entry ? <Badge>{item.entry.name}</Badge> : <Badge>{item.resource_type}</Badge>}
        {sourceTitle ? <span className="type-body-small text-ink-muted">{sourceTitle}</span> : null}
        {item.source?.publication ? (
          <span className="type-body-small text-ink-muted">{item.source.publication}</span>
        ) : null}
      </div>

      {item.source ? (
        <a
          href={item.source.url}
          target="_blank"
          rel="noreferrer"
          className="type-label-medium text-ink-strong inline-flex items-center gap-2 underline"
        >
          Open source
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
    </li>
  );
}

function FeedRoute() {
  const digestQuery = useWorkspaceWatchDigest(DIGEST_LIMIT);
  const digest = digestQuery.data;
  const items = digest?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-12">
      <header className="space-y-2">
        <Badge variant="info">Activity</Badge>
        <h1 className="type-display-small text-ink-strong">Monitoring digest</h1>
        <p className="type-body-large text-ink-soft">
          Source-backed changes for watched actors and coverage targets.
        </p>
      </header>

      {digestQuery.isLoading ? (
        <p className="type-body-medium text-ink-soft">Loading</p>
      ) : items.length === 0 ? (
        <div className="bg-surface-container space-y-2 rounded-lg p-5">
          <p className="type-body-medium text-ink-strong">No watch updates.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <section
            aria-label="Monitoring summary"
            className="bg-surface-container grid gap-3 rounded-lg p-4 sm:grid-cols-3"
          >
            <div>
              <p className="type-label-small text-ink-muted">Updates</p>
              <p className="type-title-medium text-ink-strong">
                {pluralize(digest?.total ?? items.length, "watch update")}
              </p>
            </div>
            <div>
              <p className="type-label-small text-ink-muted">Sources</p>
              <p className="type-title-medium text-ink-strong">
                {pluralize(digest?.source_signal_count ?? 0, "source signal")}
              </p>
            </div>
            <div>
              <p className="type-label-small text-ink-muted">Coverage</p>
              <p className="type-title-medium text-ink-strong">
                {pluralize(digest?.coverage_signal_count ?? 0, "coverage change")}
              </p>
            </div>
          </section>

          <ul className="space-y-3">
            {items.map((item) => (
              <DigestItemRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
