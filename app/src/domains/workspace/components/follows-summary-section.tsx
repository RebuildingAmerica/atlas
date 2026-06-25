/**
 * "Actors you follow" strip for the research home.
 *
 * Shows how many actors the user tracks and a strip of the most recently active
 * ones — derived from the distinct entries in the activity feed, since the
 * platform exposes follows only through the feed for now. Each actor links to
 * their profile via {@link ActorAvatar}. When nothing is followed, it prompts
 * the user to start tracking actors.
 */
import { Link } from "@tanstack/react-router";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import type { SerializedResolvedCapabilities } from "@/domains/access/capabilities";
import type { ActivitySummary, FeedActivityItem } from "../server/research-summary";
import { ResearchValueNudge } from "./research-value-nudge";

/** A distinct followed actor surfaced in the home follows strip. */
interface FollowedActor {
  entryId: string;
  entryName: string;
  entrySlug: string | null;
  entryType: string;
}

interface FollowsSummarySectionProps {
  /** The derived activity summary from the research loader. */
  activity: ActivitySummary;
  /** The serialized capability/limit set from the session, or null when none. */
  capabilities: SerializedResolvedCapabilities | null;
  /** Whether the deployment is running in local (single-user) mode. */
  isLocal: boolean;
}

interface FollowedActorChipProps {
  /** The followed actor this chip represents. */
  actor: FollowedActor;
}

/**
 * Reduces the recent activity items to the distinct actors behind them,
 * preserving the order they first appear (most recently active first).
 *
 * @param items - The recent activity items from the research summary.
 * @returns The distinct followed actors, in first-seen order.
 */
function distinctActors(items: FeedActivityItem[]): FollowedActor[] {
  const seen = new Set<string>();
  const actors: FollowedActor[] = [];
  for (const item of items) {
    if (seen.has(item.entryId)) {
      continue;
    }
    seen.add(item.entryId);
    actors.push({
      entryId: item.entryId,
      entryName: item.entryName,
      entrySlug: item.entrySlug,
      entryType: item.entryType,
    });
  }
  return actors;
}

/**
 * A single followed-actor chip: an avatar plus the actor name.
 *
 * Links to the actor's profile when a slug exists, and is plain text otherwise
 * so an unpublished actor never produces a dead link.
 */
function FollowedActorChip({ actor }: FollowedActorChipProps) {
  const avatarType = actor.entryType === "organization" ? "organization" : "person";
  const avatar = <ActorAvatar name={actor.entryName} type={avatarType} size="sm" />;

  if (actor.entrySlug) {
    const segment = actor.entryType === "organization" ? "organizations" : "people";
    return (
      <Link
        to={`/profiles/${segment}/$slug` as "/profiles/people/$slug"}
        params={{ slug: actor.entrySlug }}
        className="border-outline-variant bg-surface-container-lowest flex items-center gap-2 rounded-full border py-1 pr-3 pl-1"
      >
        {avatar}
        <span className="type-label-large text-ink-strong">{actor.entryName}</span>
      </Link>
    );
  }

  return (
    <span className="border-outline-variant bg-surface-container-lowest flex items-center gap-2 rounded-full border py-1 pr-3 pl-1">
      {avatar}
      <span className="type-label-large text-ink-strong">{actor.entryName}</span>
    </span>
  );
}

/**
 * The home follows strip, server-default from the loader summary.
 */
export function FollowsSummarySection({
  activity,
  capabilities,
  isLocal,
}: FollowsSummarySectionProps) {
  const actors = distinctActors(activity.recentItems);
  const countLabel = activity.followedActorCount === 1 ? "actor" : "actors";

  return (
    <section className="space-y-4">
      <h2 className="type-headline-small text-ink-strong">Actors you follow</h2>

      {activity.followedActorCount === 0 ? (
        <div className="border-outline-variant bg-surface-container space-y-2 rounded-[1rem] border p-5">
          <p className="type-body-medium text-ink-strong">You&apos;re not following anyone yet.</p>
          <p className="type-body-small text-ink-soft">
            Follow actors to track them over time.{" "}
            <Link to="/profiles" className="text-accent underline">
              Browse profiles
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="type-body-medium text-ink-soft">
            You&apos;re tracking{" "}
            <span className="text-ink-strong font-semibold">
              {activity.followedActorCount} {countLabel}
            </span>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            {actors.map((actor) => (
              <FollowedActorChip key={actor.entryId} actor={actor} />
            ))}
          </div>
        </div>
      )}

      <ResearchValueNudge
        capabilities={capabilities}
        isLocal={isLocal}
        gate={{ kind: "alerts", followedActorCount: activity.followedActorCount }}
      />
    </section>
  );
}
