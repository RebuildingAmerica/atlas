import { ExternalLink, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PLACE_ACCENT_CLASSES,
  PLACE_THUMBNAIL_HEIGHT,
  PLACE_THUMBNAIL_WIDTH,
  coordinateBounds,
  coordinatePoint,
  hasCoordinates,
  relatedCoordinatePlaces,
} from "./place-page-utils";
import type { PlaceGovernmentSummary, PlaceIssueSummary, PlaceRelatedSummary } from "@/types";

interface IssueLineProps {
  label: string;
  values: string[];
}

interface IssueGridProps {
  issues: PlaceIssueSummary[];
}

interface GovernmentListProps {
  governments: PlaceGovernmentSummary[];
}

interface PlaceHighlightsProps {
  places: PlaceRelatedSummary[];
}

interface PlaceCardProps {
  place: PlaceRelatedSummary;
  places: PlaceRelatedSummary[];
}

interface PlaceGridProps {
  places: PlaceRelatedSummary[];
}

function IssueLine({ label, values }: IssueLineProps) {
  return (
    <div className="bg-surface-container-low rounded-lg px-3 py-2">
      <p className="type-label-small text-ink-muted">{label}</p>
      <p className="type-body-small text-ink-strong mt-1">{values.join(", ")}</p>
    </div>
  );
}

export function IssueGrid({ issues }: IssueGridProps) {
  if (issues.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No issues listed.
      </p>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {issues.map((issue) => (
        <article key={issue.id} className="bg-surface-container-lowest rounded-lg p-4">
          <h3 className="type-title-large text-ink-strong">{issue.name}</h3>
          <div className="mt-4 grid gap-2">
            {issue.actors.length ? <IssueLine label="People" values={issue.actors} /> : null}
            {issue.places.length ? <IssueLine label="Places" values={issue.places} /> : null}
            {issue.records.length ? <IssueLine label="Records" values={issue.records} /> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function GovernmentList({ governments }: GovernmentListProps) {
  if (governments.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No government entries listed.
      </p>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {governments.map((government) => (
        <article key={government.name} className="bg-surface-container-lowest rounded-lg p-4">
          <h3 className="type-title-large text-ink-strong">{government.name}</h3>
          <p className="type-body-medium text-ink-soft mt-2">{government.role}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {government.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="type-label-medium bg-surface-container text-ink-soft hover:text-ink-strong inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
              >
                {link.label}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export function PlaceHighlights({ places }: PlaceHighlightsProps) {
  if (places.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No related places listed.
      </p>
    );
  }

  return (
    <div className="bg-surface-container-lowest grid gap-3 rounded-2xl p-4">
      {places.slice(0, 3).map((place) => (
        <a
          key={place.href}
          href={place.href}
          className="bg-surface-container-low hover:bg-surface-container grid gap-2 rounded-lg p-4 transition-colors"
        >
          <span className="type-label-medium text-ink-muted inline-flex items-center gap-2">
            <MapPin className="h-4 w-4" aria-hidden />
            {place.kind}
          </span>
          <span className="type-title-large text-ink-strong">{place.name}</span>
          <span className="type-body-small text-ink-soft">{place.summary}</span>
        </a>
      ))}
    </div>
  );
}

export function PlaceMapThumbnail({ place, places }: PlaceCardProps) {
  const coordinatePlaces = relatedCoordinatePlaces(places);
  if (!hasCoordinates(place) || coordinatePlaces.length === 0) {
    return (
      <div
        data-testid={`place-map-thumb-${place.name}`}
        className={cn(
          "flex h-24 items-center justify-center rounded-lg",
          PLACE_ACCENT_CLASSES[place.accent],
        )}
      >
        <span className="bg-surface-container-lowest/80 text-ink-strong shadow-soft inline-flex items-center gap-2 rounded-full px-3 py-1.5">
          <MapPin className="h-4 w-4" aria-hidden />
          <span className="type-label-medium">{place.kind}</span>
        </span>
      </div>
    );
  }

  const bounds = coordinateBounds(coordinatePlaces);
  return (
    <div
      data-testid={`place-map-thumb-${place.name}`}
      className="bg-surface-container-low relative h-24 overflow-hidden rounded-lg"
    >
      <svg
        role="img"
        aria-label={`${place.name} location`}
        viewBox={`0 0 ${PLACE_THUMBNAIL_WIDTH} ${PLACE_THUMBNAIL_HEIGHT}`}
        className="h-full w-full"
      >
        <rect
          x="0"
          y="0"
          width={PLACE_THUMBNAIL_WIDTH}
          height={PLACE_THUMBNAIL_HEIGHT}
          rx="10"
          className="fill-surface-container-low"
        />
        {coordinatePlaces.map((coordinatePlace) => {
          const point = coordinatePoint(coordinatePlace, bounds);
          const isCurrentPlace = coordinatePlace.href === place.href;
          return (
            <g key={coordinatePlace.href}>
              {isCurrentPlace ? (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="10"
                  className="fill-ink-muted"
                  opacity="0.12"
                />
              ) : null}
              <circle
                cx={point.x}
                cy={point.y}
                r={isCurrentPlace ? 4.5 : 3}
                className={isCurrentPlace ? "fill-ink-strong" : "fill-ink-muted"}
                data-current-place={isCurrentPlace ? "true" : undefined}
                data-place-dot={coordinatePlace.name}
                opacity={isCurrentPlace ? 1 : 0.45}
              />
            </g>
          );
        })}
      </svg>
      <span className="bg-surface-container-lowest/85 text-ink-strong shadow-soft absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1">
        <MapPin className="h-3.5 w-3.5" aria-hidden />
        <span className="type-label-small">{place.kind}</span>
      </span>
    </div>
  );
}

function PlaceCard({ place, places }: PlaceCardProps) {
  return (
    <a
      href={place.href}
      className="group bg-surface-container-lowest hover:bg-surface rounded-lg p-3 transition-colors"
    >
      <PlaceMapThumbnail place={place} places={places} />
      <div className="px-1 pt-3">
        <p className="type-title-large text-ink-strong group-hover:text-accent">{place.name}</p>
        <p className="type-body-small text-ink-soft mt-1">{place.summary}</p>
      </div>
    </a>
  );
}

export function PlaceGrid({ places }: PlaceGridProps) {
  if (places.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No related places listed.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {places.map((place) => (
        <PlaceCard key={place.href} place={place} places={places} />
      ))}
    </div>
  );
}
