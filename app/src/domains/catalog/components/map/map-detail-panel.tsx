import type { Ref } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Network, X } from "lucide-react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { issueColor } from "@rebuildingamerica/atlas-catalog/map/issue-colors";
import { profileRouteFor } from "@rebuildingamerica/atlas-catalog/map/profile-route";
import { MapTrustLine } from "./map-trust-line";
import {
  type ActorSelection,
  type ClusterSelection,
  type MapSelection,
  isActorSelection,
} from "@rebuildingamerica/atlas-catalog/map/map-selection";
import type { EntryType, MapPoint } from "@rebuildingamerica/atlas-api-client";

/** Human-readable type labels for the panel's type badge and avatar shape. */
const TYPE_LABEL: Record<EntryType, string> = {
  person: "Person",
  organization: "Organization",
  initiative: "Initiative",
  campaign: "Campaign",
  event: "Event",
};

const LOCATION_PRECISION_LABEL: Record<NonNullable<MapPoint["geocode_precision"]>, string> = {
  rooftop: "Exact public address",
  city: "City-level location",
  state: "State-level location",
};
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface MapFact {
  label: string;
  value: string;
  detail?: string;
}

/** Map an actor type to the two avatar shapes Atlas draws (people vs. everything else). */
function avatarType(type: EntryType): "person" | "organization" {
  return type === "person" ? "person" : "organization";
}

function sourceCountLabel(count: number): string {
  return count === 1 ? "1 link" : `${count} links`;
}

function locationPrecisionLabel(point: MapPoint): string {
  if (point.geocode_precision) {
    return LOCATION_PRECISION_LABEL[point.geocode_precision];
  }
  return "Mapped location";
}

function formatMapDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function mapFacts(point: MapPoint): MapFact[] {
  const latest = formatMapDate(point.latest_source_date);
  return [
    ...(point.place_label ? [{ label: "Place", value: point.place_label }] : []),
    { label: "Location", value: locationPrecisionLabel(point) },
    {
      label: "Source links",
      value: sourceCountLabel(point.source_count),
      detail: latest ? `Newest ${latest}` : undefined,
    },
  ];
}

function MapFacts({ point }: { point: MapPoint }) {
  return (
    <dl
      aria-label="Map facts"
      className="bg-surface-container-low grid gap-2 rounded-[0.875rem] p-3"
    >
      {mapFacts(point).map((fact) => (
        <div key={fact.label} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
          <dt className="type-label-small text-ink-muted">{fact.label}</dt>
          <dd className="type-body-small text-ink-strong min-w-0">
            <span>{fact.value}</span>
            {fact.detail ? <span className="text-ink-soft block">{fact.detail}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface MapDetailPanelProps {
  /** Imperative focus target used when the panel opens. */
  panelRef?: Ref<HTMLDivElement>;
  /** What the panel is currently showing — one actor or a cluster's crowd. */
  selection: MapSelection;
  /** Dismiss the panel and return focus to the map. */
  onClose: () => void;
  /** Open one member's own detail from a cluster list. */
  onSelectMember: (point: MapPoint) => void;
  /** Drop the slide-in for visitors who prefer reduced motion. */
  reducedMotion?: boolean;
}

/** A small swatch tinted with an issue area's shared civic-dot hue. */
function IssueBadge({ issueAreaId }: { issueAreaId: string }) {
  const color = issueColor(issueAreaId);
  return (
    <span
      className="type-label-small inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold"
      style={{ backgroundColor: `${color}22`, color }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {issueAreaId}
    </span>
  );
}

/** The single-actor view: identity, trust, issues, and the deep-link CTAs. */
function ActorView({ headingId, selection }: { headingId: string; selection: ActorSelection }) {
  const { point } = selection;
  const route = profileRouteFor(point.type, point.slug);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <ActorAvatar name={point.name} type={avatarType(point.type)} size="md" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2
            id={headingId}
            className="type-body-large text-ink-strong font-semibold"
            style={{ viewTransitionName: `entry-name-${point.id}` }}
          >
            {point.name}
          </h2>
          <Badge variant="default">{TYPE_LABEL[point.type]}</Badge>
        </div>
      </div>

      <MapFacts point={point} />

      <MapTrustRow actorType={point.type} trustLevel={point.trust_level} />

      {point.issue_areas.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Issue areas">
          {point.issue_areas.map((issueAreaId) => (
            <li key={issueAreaId}>
              <IssueBadge issueAreaId={issueAreaId} />
            </li>
          ))}
        </ul>
      ) : null}

      {route ? (
        <div className="space-y-2">
          <Link to={route.to} params={route.params} viewTransition className="block">
            <Button variant="primary" size="md" className="w-full">
              <span className="inline-flex items-center justify-center gap-1.5">
                View full profile
                <ArrowRight className="h-4 w-4" aria-hidden />
              </span>
            </Button>
          </Link>
          <Link
            to={route.to}
            params={route.params}
            hash="connections"
            viewTransition
            className="block"
          >
            <Button variant="secondary" size="md" className="w-full">
              <span className="inline-flex items-center justify-center gap-1.5">
                <Network className="h-4 w-4" aria-hidden />
                See their connections
              </span>
            </Button>
          </Link>
        </div>
      ) : (
        <p className="type-body-small text-ink-soft">
          No profile page is available for this actor.
        </p>
      )}
    </div>
  );
}

/** The single trust line, importing the profile's verification language. */
function MapTrustRow({
  actorType,
  trustLevel,
}: {
  actorType: MapPoint["type"];
  trustLevel: MapPoint["trust_level"];
}) {
  return (
    <div className="space-y-1">
      <p className="type-label-small text-ink-muted">Verification</p>
      <MapTrustLine actorType={actorType} trustLevel={trustLevel} />
    </div>
  );
}

/** A compact, focusable row standing in for one actor inside a cluster list. */
function ClusterMemberRow({
  point,
  onSelect,
}: {
  point: MapPoint;
  onSelect: (point: MapPoint) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(point);
      }}
      className="bg-surface-container-lowest hover:bg-surface-container-low flex w-full items-center gap-3 rounded-[0.875rem] p-3 text-left transition-colors"
    >
      <ActorAvatar name={point.name} type={avatarType(point.type)} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="type-body-small text-ink-strong block truncate font-semibold">
          {point.name}
        </span>
        <MapTrustLine actorType={point.type} trustLevel={point.trust_level} />
      </span>
      <ArrowRight className="text-ink-soft h-4 w-4 shrink-0" aria-hidden />
    </button>
  );
}

/** The cluster's "who's working here" list — the panel's crowd view. */
function ClusterView({
  headingId,
  selection,
  onSelectMember,
}: {
  headingId: string;
  selection: ClusterSelection;
  onSelectMember: (point: MapPoint) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 id={headingId} className="type-body-large text-ink-strong font-semibold">
        {selection.members.length === 1
          ? "1 person or group here"
          : `${selection.members.length} people and groups here`}
      </h2>
      <ul className="space-y-2" aria-label="Who's working here">
        {selection.members.map((point) => (
          <li key={point.id}>
            <ClusterMemberRow point={point} onSelect={onSelectMember} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The map's detail panel — a non-modal dialog that slides in from the right on
 * desktop, reusing the profile's visual language (avatar, name, trust line,
 * issue badges) so the path geography → actor → relationships feels continuous.
 *
 * Clicking a single dot shows that actor with a primary "View full profile"
 * deep link (sharing the hero's view-transition name so the avatar and name
 * morph across the navigation) and a secondary jump straight to their
 * connection network. Clicking a cluster turns the panel into a compact "who's
 * working here" list whose rows open each actor's own detail.
 *
 * The slide-in is the panel's only motion and it animates `transform:
 * translateX` — never a scale on the chrome — and is dropped entirely for
 * reduced-motion visitors, who get the resting panel immediately.
 */
export function MapDetailPanel({
  panelRef,
  selection,
  onClose,
  onSelectMember,
  reducedMotion = false,
}: MapDetailPanelProps) {
  const headingId = "map-detail-panel-heading";
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={false}
      aria-labelledby={headingId}
      tabIndex={-1}
      data-motion={reducedMotion ? "none" : "slide"}
      className={
        reducedMotion
          ? "focus:ring-accent focus:ring-2 focus:outline-none"
          : "focus:ring-accent focus:ring-2 focus:outline-none motion-safe:animate-[map-panel-in_240ms_ease-out]"
      }
    >
      <div className="flex items-center justify-end p-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="text-ink-soft hover:text-ink-strong hover:bg-surface-container-high rounded-full p-1.5 transition-colors"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="px-5 pb-6">
        {isActorSelection(selection) ? (
          <ActorView headingId={headingId} selection={selection} />
        ) : (
          <ClusterView
            headingId={headingId}
            selection={selection}
            onSelectMember={onSelectMember}
          />
        )}
      </div>
    </div>
  );
}
