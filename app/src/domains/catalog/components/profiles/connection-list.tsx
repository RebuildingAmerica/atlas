/**
 * ConnectionList — the ranked "civic map" on a profile.
 *
 * Replaces the old per-type rails with one strength-ranked list of connected
 * actors. Each row shows how strongly and *why* an actor is connected, and links
 * through so a reader can traverse the network. The true total is shown honestly,
 * never a silent cap.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { humanize } from "@rebuildingamerica/atlas-catalog/catalog";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { cn } from "@/lib/utils";
import type {
  ConnectedActor,
  ConnectionNetwork,
  ConnectionTier,
  Entry,
} from "@rebuildingamerica/atlas-api-client";

interface ConnectionListProps {
  entry: Entry;
  network: ConnectionNetwork | undefined;
  isLoading: boolean;
}

const TIER_LABEL: Record<ConnectionTier, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Light",
};

const TIER_BAR: Record<ConnectionTier, string> = {
  strong: "bg-civic",
  moderate: "bg-civic/60",
  weak: "bg-civic/30",
};

interface StrengthMeterProps {
  strength: number;
  tier: ConnectionTier;
}

function StrengthMeter({ strength, tier }: StrengthMeterProps) {
  return (
    <div className="flex shrink-0 items-center gap-2" title={`${TIER_LABEL[tier]} connection`}>
      <div className="bg-surface-container-high h-1.5 w-16 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", TIER_BAR[tier])}
          style={{ width: `${strength}%` }}
        />
      </div>
      <span className="type-label-small text-ink-muted w-14">{TIER_LABEL[tier]}</span>
    </div>
  );
}

interface ConnectionRowProps {
  actor: ConnectedActor;
}

interface ReasonChipProps {
  reason: ConnectedActor["reasons"][number];
}

function relationshipTypeLabel(value: string): string {
  return humanize(value);
}

function ReasonChip({ reason }: ReasonChipProps) {
  const className =
    "type-label-small text-ink-soft bg-surface-container-low rounded-full px-2 py-0.5";
  const typeLabel = reason.relationship_type ? (
    <span className="text-ink-strong font-semibold">
      {relationshipTypeLabel(reason.relationship_type)}
    </span>
  ) : null;

  if (reason.source_id) {
    return (
      <span className={cn(className, "inline-flex items-center gap-1.5")}>
        {typeLabel}
        <a href={`#source-${reason.source_id}`} className="hover:text-ink-strong">
          {reason.label}
        </a>
      </span>
    );
  }
  return (
    <span className={cn(className, "inline-flex items-center gap-1.5")}>
      {typeLabel}
      <span>{reason.label}</span>
    </span>
  );
}

function ConnectionRowBody({ actor }: ConnectionRowProps) {
  return (
    <>
      <ActorAvatar
        name={actor.name}
        type={actor.type === "organization" ? "organization" : "person"}
        size="sm"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          {actor.slug ? (
            <Link
              to={
                actor.type === "organization"
                  ? "/profiles/organizations/$slug"
                  : "/profiles/people/$slug"
              }
              params={{ slug: actor.slug }}
              viewTransition
              className="type-body-small text-ink-strong focus-visible:ring-civic truncate rounded-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {actor.name}
            </Link>
          ) : (
            <span className="type-body-small text-ink-strong truncate font-semibold">
              {actor.name}
            </span>
          )}
          <StrengthMeter strength={actor.strength} tier={actor.tier} />
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {actor.reasons.map((reason) => (
            <li key={`${reason.kind}-${reason.label}`}>
              <ReasonChip reason={reason} />
            </li>
          ))}
        </ul>
      </div>
      {actor.slug ? (
        <ArrowUpRight className="text-ink-soft mt-1 h-4 w-4 shrink-0" aria-hidden />
      ) : null}
    </>
  );
}

const ROW_CLASS = "bg-surface-container-lowest flex items-start gap-3 rounded-[0.875rem] p-3";

function ConnectionRow({ actor }: ConnectionRowProps) {
  return (
    <div className={ROW_CLASS}>
      <ConnectionRowBody actor={actor} />
    </div>
  );
}

function ConnectionListSkeleton() {
  return (
    <div className="min-h-[12rem] space-y-2" aria-label="Loading network" aria-busy="true">
      <p className="type-label-small text-ink-muted flex items-center gap-2">
        <span className="bg-civic h-1.5 w-1.5 animate-pulse rounded-full" aria-hidden />
        Loading connections…
      </p>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="bg-surface-container-high h-16 animate-pulse rounded-[0.875rem]"
        />
      ))}
    </div>
  );
}

interface BrowseMoreSearch {
  entry_types?: string;
  issue_areas?: string;
  states?: string;
}

interface BrowseMoreLink {
  label: string;
  search?: BrowseMoreSearch;
  to: "/browse" | "/profiles";
}

function buildBrowseMoreLinks(entry: Entry): BrowseMoreLink[] {
  const links: BrowseMoreLink[] = [];
  if (entry.state) {
    links.push({
      label: `More people in ${entry.state}`,
      search: {
        entry_types: "person",
        states: entry.state,
      },
      to: "/browse",
    });
  }
  const primaryIssueArea = entry.issue_areas[0];
  if (primaryIssueArea) {
    const issueLabel = humanize(primaryIssueArea);
    links.push(
      {
        label: `Organizations working on ${issueLabel}`,
        search: {
          entry_types: "organization",
          issue_areas: primaryIssueArea,
        },
        to: "/browse",
      },
      {
        label: `${issueLabel} in another place`,
        search: {
          issue_areas: primaryIssueArea,
        },
        to: "/browse",
      },
    );
  }
  links.push({ label: "All profiles", to: "/profiles" });
  return links;
}

function BrowseMore({ entry }: { entry: Entry }) {
  const links = buildBrowseMoreLinks(entry);
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <span className="type-label-small text-ink-muted">Keep exploring:</span>
      {links.map((link) =>
        link.to === "/browse" ? (
          <Link
            key={link.label}
            to="/browse"
            search={link.search}
            className="type-label-small text-ink-soft hover:text-ink-strong focus-visible:ring-civic inline-flex items-center gap-1 rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {link.label}
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : (
          <Link
            key={link.label}
            to="/profiles"
            className="type-label-small text-ink-soft hover:text-ink-strong focus-visible:ring-civic inline-flex items-center gap-1 rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {link.label}
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        ),
      )}
    </div>
  );
}

export function ConnectionList({ entry, network, isLoading }: ConnectionListProps) {
  if (isLoading && !network) {
    return <ConnectionListSkeleton />;
  }

  if (!network || network.actors.length === 0) {
    return (
      <div className="space-y-3">
        <p className="type-body-medium text-ink-soft">
          No connections surfaced yet for this profile.
        </p>
        <BrowseMore entry={entry} />
      </div>
    );
  }

  const { actors, total } = network;
  const remaining = total - actors.length;

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {actors.map((actor) => (
          <li key={actor.id}>
            <ConnectionRow actor={actor} />
          </li>
        ))}
      </ol>
      {remaining > 0 ? (
        <p className="type-label-small text-ink-muted">
          Showing the {actors.length} strongest of {total} connections.
        </p>
      ) : null}
      <BrowseMore entry={entry} />
    </div>
  );
}
