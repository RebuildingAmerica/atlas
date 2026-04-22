/**
 * Profile sidebar section displaying related actors.
 *
 * Groups connections by relationship type (same organization, co-mentioned,
 * same issue area, same geography) with evidence snippets explaining each
 * link. Each card navigates to the connected actor's profile.
 */
import { Link } from "@tanstack/react-router";
import { ActorAvatar } from "./actor-avatar";
import type { ConnectionGroup, ConnectionType } from "@/types";

interface ConnectionsSectionProps {
  /** Connection groups returned by the connections API. */
  connections: ConnectionGroup[];
  /** Whether the connections data is still loading. */
  isLoading: boolean;
}

const CONNECTION_LABELS: Record<ConnectionType, string> = {
  same_organization: "Same Organization",
  same_issue_area: "Same Issue Area",
  same_geography: "Same Geography",
  co_mentioned: "Co-mentioned",
};

/** Sidebar section showing related actors grouped by relationship type. */
export function ConnectionsSection({ connections, isLoading }: ConnectionsSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <h3 className="type-label-large text-ink-muted tracking-wider uppercase">Connections</h3>
        <p className="type-body-small text-ink-soft">Loading connections...</p>
      </div>
    );
  }

  const hasConnections = connections.some((g) => g.actors.length > 0);

  if (!hasConnections) {
    return (
      <div className="space-y-3">
        <h3 className="type-label-large text-ink-muted tracking-wider uppercase">Connections</h3>
        <p className="type-body-small text-ink-soft">No connections found yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="type-label-large text-ink-muted tracking-wider uppercase">Connections</h3>
      {connections
        .filter((group) => group.actors.length > 0)
        .map((group) => (
          <div key={group.type} className="space-y-3">
            <h4 className="type-label-medium text-ink-soft">{CONNECTION_LABELS[group.type]}</h4>
            <div className="space-y-2">
              {group.actors.map((actor) => {
                const typePrefix = actor.type === "person" ? "people" : "organizations";
                return (
                  <Link
                    key={actor.id}
                    to={`/profiles/${typePrefix}/$slug`}
                    params={{ slug: actor.slug ?? "" }}
                    viewTransition
                    className="border-border bg-surface-container-low hover:border-border-strong block rounded-lg border p-3 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <ActorAvatar
                        name={actor.name}
                        type={actor.type === "organization" ? "organization" : "person"}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="type-body-medium text-ink-strong truncate font-semibold">
                          {actor.name}
                        </div>
                        <div className="type-body-small text-ink-soft">{actor.evidence}</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
