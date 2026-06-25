import { Link } from "@tanstack/react-router";
import { ArrowRight, MapPin } from "lucide-react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { MapTrustLine } from "./map-trust-line";
import { profileRouteFor } from "@/domains/catalog/map/profile-route";
import type { EntryType, MapPoint } from "@/types";

/** Map an actor type to the two avatar shapes Atlas draws (people vs. everything else). */
function avatarType(type: EntryType): "person" | "organization" {
  return type === "person" ? "person" : "organization";
}

interface MapResultsListProps {
  /** The actors currently placed in the viewport. */
  points: MapPoint[];
  /** Whether the viewport's actors are still being fetched. */
  isLoading: boolean;
  /** Bring an actor's dot into focus on the map from its list row. */
  onFocusActor: (point: MapPoint) => void;
}

/** One actor row: identity, trust, a focus-on-map control, and a profile link. */
function ResultRow({
  point,
  onFocusActor,
}: {
  point: MapPoint;
  onFocusActor: (point: MapPoint) => void;
}) {
  const route = profileRouteFor(point.type, point.slug);
  return (
    <li className="bg-surface-container-lowest flex items-center gap-3 rounded-[0.875rem] p-3">
      <ActorAvatar name={point.name} type={avatarType(point.type)} size="sm" />
      <span className="min-w-0 flex-1">
        {route ? (
          <Link
            to={route.to}
            params={route.params}
            className="type-body-small text-ink-strong block truncate font-semibold no-underline"
          >
            {point.name}
          </Link>
        ) : (
          <span className="type-body-small text-ink-strong block truncate font-semibold">
            {point.name}
          </span>
        )}
        <MapTrustLine trustLevel={point.trust_level} />
      </span>
      <button
        type="button"
        onClick={() => {
          onFocusActor(point);
        }}
        aria-label={`Show ${point.name} on the map`}
        className="text-ink-soft hover:text-ink-strong hover:bg-surface-container-high shrink-0 rounded-full p-1.5 transition-colors"
      >
        <MapPin className="h-4 w-4" aria-hidden />
      </button>
      {route ? (
        <Link
          to={route.to}
          params={route.params}
          aria-label={`Open ${point.name}'s profile`}
          className="text-ink-soft hover:text-ink-strong shrink-0 no-underline"
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}

/**
 * The parallel, accessible list of the actors on the map.
 *
 * The map must never be the only path to the data: this list mirrors the dots
 * in plain DOM so a keyboard or screen-reader visitor reaches every actor in the
 * viewport, focuses any one of them on the map, and steps into its profile —
 * the same geography → actor → relationships flow the dots offer, without a
 * canvas. It stays honest about its two quiet states: a loading line while the
 * viewport's actors arrive, and a "no actors in view" line rather than a blank
 * list, so silence always reads as deliberate.
 */
export function MapResultsList({ points, isLoading, onFocusActor }: MapResultsListProps) {
  if (isLoading) {
    return <p className="type-body-small text-ink-muted px-1 py-4">Loading actors in this view…</p>;
  }
  if (points.length === 0) {
    return (
      <p className="type-body-small text-ink-muted px-1 py-4">
        No actors in view — pan, zoom out, or clear a filter to find more.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {points.map((point) => (
        <ResultRow key={point.id} point={point} onFocusActor={onFocusActor} />
      ))}
    </ul>
  );
}
