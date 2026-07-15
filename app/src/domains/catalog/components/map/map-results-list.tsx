import { Link } from "@tanstack/react-router";
import { ArrowRight, MapPin } from "lucide-react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { MapTrustLine } from "./map-trust-line";
import { profileRouteFor } from "@/domains/catalog/map/profile-route";
import type { EntryType, MapPoint } from "@rebuildingamerica/atlas-api-client";

/** Map an actor type to the two avatar shapes Atlas draws (people vs. everything else). */
function avatarType(type: EntryType): "person" | "organization" {
  return type === "person" ? "person" : "organization";
}

interface MapResultsListProps {
  /** The actors currently placed in the viewport. */
  points: MapPoint[];
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
        <MapTrustLine actorType={point.type} trustLevel={point.trust_level} />
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
 * The plain DOM rows for actors currently placed on the map.
 *
 * Layout, skip-link behavior, and loading or empty states live in the panel
 * shell so this component stays focused on turning point data into rows.
 */
export function MapResultsList({ points, onFocusActor }: MapResultsListProps) {
  return (
    <ul className="space-y-2">
      {points.map((point) => (
        <ResultRow key={point.id} point={point} onFocusActor={onFocusActor} />
      ))}
    </ul>
  );
}
