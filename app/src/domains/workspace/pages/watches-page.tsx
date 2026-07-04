import { Link } from "@tanstack/react-router";
import { MapPinned, ShieldCheck } from "lucide-react";
import { useAtlasSession } from "@/domains/access";
import type { WorkspaceWatchCollection } from "@/domains/workspace/server/watches";
import { useWorkspaceWatches } from "@/domains/workspace/hooks/use-workspace-watches";
import { Badge } from "@/platform/ui/badge";

interface WorkspaceWatchesPageProps {
  initialWatches: WorkspaceWatchCollection;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function preferenceLabel(preference: string): string {
  if (preference === "immediate") return "Immediate";
  if (preference === "muted") return "Muted";
  return "Digest";
}

export function WorkspaceWatchesPage({ initialWatches }: WorkspaceWatchesPageProps) {
  const session = useAtlasSession();
  const watchesQuery = useWorkspaceWatches(initialWatches);
  const watches = watchesQuery.data ?? initialWatches;
  const items = watches.items;
  const showRenewalProof = session.data?.workspace.activeOrganization?.workspaceType === "team";

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-12">
      <header className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="space-y-2">
          <Badge variant="info">Monitoring</Badge>
          <h1 className="type-display-small text-ink-strong">Watching</h1>
          <p className="type-body-large text-ink-soft">
            Shared actors and coverage targets this workspace follows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Link
            to="/coverage"
            className="type-label-large border-outline-variant text-ink-strong hover:bg-surface-container-low inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 transition-colors"
          >
            <MapPinned className="h-4 w-4" aria-hidden="true" />
            Open coverage
          </Link>
          {showRenewalProof ? (
            <Link
              hash="renewal-proof"
              to="/organization"
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Open proof
            </Link>
          ) : null}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-5">
          <p className="type-body-medium text-ink-strong">No watched resources.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="bg-surface-container grid gap-3 rounded-lg p-4 sm:grid-cols-3">
            <div>
              <p className="type-label-small text-ink-muted">Resources</p>
              <p className="type-title-medium text-ink-strong">
                {pluralize(watches.total, "watched resource")}
              </p>
            </div>
            <div>
              <p className="type-label-small text-ink-muted">Digest</p>
              <p className="type-title-medium text-ink-strong">
                {items.filter((item) => item.watch.notification_preference === "digest").length}
              </p>
            </div>
            <div>
              <p className="type-label-small text-ink-muted">Muted</p>
              <p className="type-title-medium text-ink-strong">
                {items.filter((item) => item.watch.notification_preference === "muted").length}
              </p>
            </div>
          </section>

          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.watch.id}
                className="border-border bg-surface-container flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="type-label-small text-ink-muted">{item.resourceLabel}</p>
                  {item.href ? (
                    <a href={item.href} className="type-title-medium text-ink-strong underline">
                      {item.label}
                    </a>
                  ) : (
                    <p className="type-title-medium text-ink-strong">{item.label}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {item.location ? (
                      <span className="type-body-small text-ink-soft">{item.location}</span>
                    ) : null}
                    {item.status ? <Badge>{item.status}</Badge> : null}
                  </div>
                </div>
                <Badge>{preferenceLabel(item.watch.notification_preference)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
