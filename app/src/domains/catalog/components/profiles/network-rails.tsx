/**
 * NetworkRails — multi-rail "portal" section in the main column of a profile.
 *
 * Surfaces related actors grouped by ConnectionType. Each rail is a horizontal
 * scroll of actor cards; the co_mentioned rail is given distinctive treatment
 * because it surfaces a relationship signal that only Atlas computes.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { cn } from "@/lib/utils";
import type { ConnectedActor, ConnectionGroup, ConnectionType, Entry } from "@/types";

interface NetworkRailsProps {
  entry: Entry;
  connections: ConnectionGroup[];
  isLoading: boolean;
}

interface RailHeaderConfig {
  title: string;
  distinctive?: boolean;
}

function buildRailHeader(type: ConnectionType, entry: Entry): RailHeaderConfig {
  switch (type) {
    case "same_organization":
      return { title: "Same organization" };
    case "same_issue_area":
      return { title: "Same issue area" };
    case "same_geography":
      return {
        title: entry.state ? `Same region · ${entry.state}` : "Same region",
      };
    case "co_mentioned":
      return { title: "Co-mentioned in coverage", distinctive: true };
  }
}

const CONNECTION_ORDER: ConnectionType[] = [
  "same_issue_area",
  "same_geography",
  "same_organization",
  "co_mentioned",
];

interface ActorCardProps {
  actor: ConnectedActor;
  distinctive?: boolean;
}

function ActorCard({ actor, distinctive }: ActorCardProps) {
  const typePrefix = actor.type === "organization" ? "organizations" : "people";
  const widthClass = distinctive ? "w-56" : "w-44";

  if (!actor.slug) {
    return (
      <div
        className={cn("bg-surface-container-lowest shrink-0 rounded-[0.875rem] p-3", widthClass)}
      >
        <ActorCardBody actor={actor} distinctive={distinctive} />
      </div>
    );
  }

  return (
    <Link
      to={
        typePrefix === "organizations" ? "/profiles/organizations/$slug" : "/profiles/people/$slug"
      }
      params={{ slug: actor.slug }}
      viewTransition
      className={cn(
        "bg-surface-container-lowest hover:bg-surface-container-low block shrink-0 rounded-[0.875rem] p-3 transition-colors",
        widthClass,
      )}
    >
      <ActorCardBody actor={actor} distinctive={distinctive} />
    </Link>
  );
}

function ActorCardBody({ actor, distinctive }: ActorCardProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ActorAvatar
          name={actor.name}
          type={actor.type === "organization" ? "organization" : "person"}
          size="sm"
        />
        <span className="type-body-small text-ink-strong truncate font-semibold">{actor.name}</span>
      </div>
      <p
        className={cn(
          "type-label-small text-ink-soft",
          distinctive ? "line-clamp-3" : "line-clamp-2",
        )}
      >
        {actor.evidence}
      </p>
    </div>
  );
}

interface RailProps {
  group: ConnectionGroup;
  entry: Entry;
}

function Rail({ group, entry }: RailProps) {
  const header = buildRailHeader(group.type, entry);
  const containerClass = header.distinctive
    ? "rounded-[1.25rem] border border-amber-200 bg-amber-50/60 p-4 lg:p-5"
    : "space-y-3";

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {header.distinctive ? <Sparkles className="h-4 w-4 text-amber-600" aria-hidden /> : null}
          <h4 className="type-label-large text-ink-strong">{header.title}</h4>
          {header.distinctive ? (
            <span className="type-label-small text-amber-700">↳ only on Atlas</span>
          ) : null}
        </div>
        <span className="type-label-small text-ink-muted">
          {group.actors.length} {group.actors.length === 1 ? "actor" : "actors"}
        </span>
      </div>

      <div className={cn("flex gap-3 overflow-x-auto pb-1", header.distinctive ? "mt-3" : "mt-1")}>
        {group.actors.map((actor) => (
          <ActorCard key={actor.id} actor={actor} distinctive={header.distinctive} />
        ))}
      </div>
    </div>
  );
}

function NetworkRailsSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading network">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3">
          <div className="bg-surface-container-high h-4 w-40 animate-pulse rounded" />
          <div className="flex gap-3">
            {[0, 1, 2].map((j) => (
              <div
                key={j}
                className="bg-surface-container-high h-24 w-44 shrink-0 animate-pulse rounded-[0.875rem]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface BrowseMoreLink {
  label: string;
  to: "/profiles" | "/profiles/people" | "/profiles/organizations";
}

function buildBrowseMoreLinks(entry: Entry): BrowseMoreLink[] {
  const links: BrowseMoreLink[] = [];

  if (entry.state) {
    links.push({
      label: `All profiles in ${entry.state}`,
      to: "/profiles",
    });
  }
  if (entry.issue_areas.length > 0) {
    links.push({
      label: "Browse by issue area",
      to: "/profiles",
    });
  }
  links.push({ label: "All profiles", to: "/profiles" });

  return links;
}

export function NetworkRails({ entry, connections, isLoading }: NetworkRailsProps) {
  if (isLoading) {
    return <NetworkRailsSkeleton />;
  }

  const populatedGroups = connections.filter((group) => group.actors.length > 0);
  const orderedGroups = CONNECTION_ORDER.flatMap((type) =>
    populatedGroups.filter((group) => group.type === type),
  );

  if (orderedGroups.length === 0) {
    return (
      <div className="space-y-3">
        <p className="type-body-medium text-ink-soft">
          No connections surfaced yet for this profile.
        </p>
        <BrowseMore entry={entry} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {orderedGroups.map((group) => (
        <Rail key={group.type} group={group} entry={entry} />
      ))}
      <BrowseMore entry={entry} />
    </div>
  );
}

function BrowseMore({ entry }: { entry: Entry }) {
  const links = buildBrowseMoreLinks(entry);
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <span className="type-label-small text-ink-muted">Keep browsing:</span>
      {links.map((link) => (
        <Link
          key={link.label}
          to={link.to}
          className="type-label-small text-ink-soft hover:text-ink-strong inline-flex items-center gap-1 transition-colors"
        >
          {link.label}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      ))}
    </div>
  );
}
