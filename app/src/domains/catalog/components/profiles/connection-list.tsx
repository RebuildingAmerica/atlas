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
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { cn } from "@/lib/utils";
import type { ConnectedActor, ConnectionNetwork, ConnectionTier, Entry } from "@/types";

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
          <span className="type-body-small text-ink-strong truncate font-semibold">
            {actor.name}
          </span>
          <StrengthMeter strength={actor.strength} tier={actor.tier} />
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {actor.reasons.map((reason) => (
            <li
              key={`${reason.kind}-${reason.label}`}
              className="type-label-small text-ink-soft bg-surface-container-low rounded-full px-2 py-0.5"
            >
              {reason.label}
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
  if (!actor.slug) {
    return (
      <div className={ROW_CLASS}>
        <ConnectionRowBody actor={actor} />
      </div>
    );
  }

  return (
    <Link
      to={
        actor.type === "organization" ? "/profiles/organizations/$slug" : "/profiles/people/$slug"
      }
      params={{ slug: actor.slug }}
      viewTransition
      className={cn(
        ROW_CLASS,
        "hover:bg-surface-container-low focus-visible:ring-civic transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
      )}
    >
      <ConnectionRowBody actor={actor} />
    </Link>
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

function buildBrowseMoreLinks(entry: Entry): string[] {
  const labels: string[] = [];
  if (entry.state) {
    labels.push(`All profiles in ${entry.state}`);
  }
  if (entry.issue_areas.length > 0) {
    labels.push("Browse by issue area");
  }
  labels.push("All profiles");
  return labels;
}

function BrowseMore({ entry }: { entry: Entry }) {
  const labels = buildBrowseMoreLinks(entry);
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <span className="type-label-small text-ink-muted">Keep exploring:</span>
      {labels.map((label) => (
        <Link
          key={label}
          to="/profiles"
          className="type-label-small text-ink-soft hover:text-ink-strong focus-visible:ring-civic inline-flex items-center gap-1 rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {label}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      ))}
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
