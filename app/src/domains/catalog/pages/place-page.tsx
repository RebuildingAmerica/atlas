import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, MapPin, Search } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  EntryType,
  PlaceActorList,
  PlaceActorParams,
  PlaceActorSort,
  PlaceActorSummary,
  PlaceFact,
  PlaceGovernmentSummary,
  PlaceIssueSummary,
  PlaceKind,
  PlaceLatestItem,
  PlaceLatestList,
  PlacePageData,
  PlaceRelatedSummary,
  PlaceScopeLink,
  SourceType,
} from "@/types";

interface PlacePageProps {
  data: PlacePageData;
}

interface PlaceSectionProps {
  children: ReactNode;
  id: string;
  title: string;
}

interface ScopeNavProps {
  name: string;
  scopes: PlaceScopeLink[];
}

interface SummaryFactStripProps {
  facts: PlaceFact[];
}

interface FactGridProps {
  facts: PlaceFact[];
}

interface LatestListProps {
  items: PlaceLatestItem[];
}

interface LatestFeedProps {
  initialLatest: PlaceLatestList;
  placeKind: PlaceKind;
  placeSlug: string;
}

interface LatestLoadParams {
  cursor?: string;
  nextQuery?: string;
  nextSourceType?: SourceType | null;
}

interface ActorCardProps {
  actor: PlaceActorSummary;
}

interface ActorDirectoryProps {
  initialActors: PlaceActorList;
  placeKind: PlaceKind;
  placeSlug: string;
}

interface ActorLoadParams {
  cursor?: string;
  nextQuery?: string;
  nextSort?: PlaceActorSort;
  nextType?: EntryType | null;
}

interface ActorListProps {
  actors: PlaceActorSummary[];
  sort: PlaceActorSort;
}

interface ActorGroup {
  actors: PlaceActorSummary[];
  label: string;
}

interface IssueGridProps {
  issues: PlaceIssueSummary[];
}

interface IssueLineProps {
  label: string;
  values: string[];
}

interface GovernmentListProps {
  governments: PlaceGovernmentSummary[];
}

interface PlaceCardProps {
  place: PlaceRelatedSummary;
  places: PlaceRelatedSummary[];
}

interface PlaceGridProps {
  places: PlaceRelatedSummary[];
}

interface PlaceHighlightsProps {
  places: PlaceRelatedSummary[];
}

interface SectionNavItem {
  id: string;
  label: string;
}

const ACTOR_TYPES: { label: string; value: EntryType }[] = [
  { label: "Organizations", value: "organization" },
  { label: "People", value: "person" },
  { label: "Initiatives", value: "initiative" },
];

const ACTOR_SORTS: { label: string; value: PlaceActorSort }[] = [
  { label: "Best match", value: "relevance" },
  { label: "Most documented", value: "source_count" },
  { label: "Recent", value: "recent" },
  { label: "Name", value: "name" },
];

const LATEST_SOURCE_TYPES: { label: string; value: SourceType }[] = [
  { label: "Government records", value: "government_record" },
  { label: "News", value: "news_article" },
  { label: "Reports", value: "report" },
  { label: "Org websites", value: "org_website" },
];

const SECTION_NAV_ITEMS: SectionNavItem[] = [
  { id: "latest", label: "Latest" },
  { id: "people-organizations", label: "People & Organizations" },
  { id: "issues", label: "Issues" },
  { id: "facts", label: "Facts" },
  { id: "government", label: "Government" },
  { id: "places", label: "Places" },
];

const PLACE_ACCENT_CLASSES: Record<PlaceRelatedSummary["accent"], string> = {
  climate: "bg-surface-container",
  democracy: "bg-paper-deep",
  education: "bg-surface-container-high",
  health: "bg-paper-faded",
  housing: "bg-surface-container-low",
  labor: "bg-surface-container",
  neutral: "bg-surface-container-low",
};

const PLACE_THUMBNAIL_WIDTH = 160;
const PLACE_THUMBNAIL_HEIGHT = 96;
const PLACE_THUMBNAIL_PADDING = 14;
const MIN_PLACE_THUMBNAIL_SPAN_DEGREES = 0.08;

type CoordinatePlace = PlaceRelatedSummary & {
  latitude: number;
  longitude: number;
};

interface CoordinateBounds {
  maxLat: number;
  maxLng: number;
  minLat: number;
  minLng: number;
}

interface SvgPoint {
  x: number;
  y: number;
}

function formatSourceType(value: string): string {
  const label = value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function hasCoordinates(place: PlaceRelatedSummary): place is CoordinatePlace {
  return (
    typeof place.latitude === "number" &&
    Number.isFinite(place.latitude) &&
    typeof place.longitude === "number" &&
    Number.isFinite(place.longitude)
  );
}

function relatedCoordinatePlaces(places: PlaceRelatedSummary[]): CoordinatePlace[] {
  return places.filter(hasCoordinates);
}

function coordinateBounds(places: CoordinatePlace[]): CoordinateBounds {
  const latitudes = places.map((place) => place.latitude);
  const longitudes = places.map((place) => place.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latCenter = (minLat + maxLat) / 2;
  const lngCenter = (minLng + maxLng) / 2;
  const latSpan = Math.max(maxLat - minLat, MIN_PLACE_THUMBNAIL_SPAN_DEGREES);
  const lngSpan = Math.max(maxLng - minLng, MIN_PLACE_THUMBNAIL_SPAN_DEGREES);

  return {
    maxLat: latCenter + latSpan / 2,
    maxLng: lngCenter + lngSpan / 2,
    minLat: latCenter - latSpan / 2,
    minLng: lngCenter - lngSpan / 2,
  };
}

function coordinatePoint(place: CoordinatePlace, bounds: CoordinateBounds): SvgPoint {
  const drawableWidth = PLACE_THUMBNAIL_WIDTH - PLACE_THUMBNAIL_PADDING * 2;
  const drawableHeight = PLACE_THUMBNAIL_HEIGHT - PLACE_THUMBNAIL_PADDING * 2;
  const lngRange = bounds.maxLng - bounds.minLng;
  const latRange = bounds.maxLat - bounds.minLat;

  return {
    x: PLACE_THUMBNAIL_PADDING + ((place.longitude - bounds.minLng) / lngRange) * drawableWidth,
    y: PLACE_THUMBNAIL_PADDING + ((bounds.maxLat - place.latitude) / latRange) * drawableHeight,
  };
}

function PlaceSection({ children, id, title }: PlaceSectionProps) {
  return (
    <section id={id} className="bg-surface-container-low scroll-mt-32 rounded-2xl p-4 sm:p-6">
      <h2 className="type-headline-medium text-ink-strong mb-5 tracking-normal">{title}</h2>
      {children}
    </section>
  );
}

function ScopeNav({ name, scopes }: ScopeNavProps) {
  if (scopes.length === 0) {
    return null;
  }

  return (
    <nav aria-label={`${name} places`} className="mt-5 flex flex-wrap gap-2">
      {scopes.map((scope) => (
        <a
          key={scope.href}
          href={scope.href}
          className={cn(
            "type-label-large rounded-full px-3 py-1.5 transition-colors",
            scope.active
              ? "bg-ink-strong text-surface"
              : "bg-surface-container text-ink-soft hover:text-ink-strong",
          )}
        >
          {scope.label}
        </a>
      ))}
    </nav>
  );
}

function SummaryFactStrip({ facts }: SummaryFactStripProps) {
  if (facts.length === 0) {
    return null;
  }

  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {facts.map((fact) => (
        <div
          key={`${fact.label}-${fact.value}`}
          className="bg-surface-container-lowest rounded-lg p-3"
        >
          <dt className="type-label-medium text-ink-muted">{fact.label}</dt>
          <dd className="type-title-medium text-ink-strong mt-1">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FactGrid({ facts }: FactGridProps) {
  if (facts.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No facts listed.
      </p>
    );
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {facts.map((fact) => (
        <div
          key={`${fact.label}-${fact.value}`}
          className="bg-surface-container-lowest rounded-lg p-4"
        >
          <dt className="type-label-medium text-ink-muted">{fact.label}</dt>
          <dd className="text-ink-strong mt-1 text-2xl leading-tight font-semibold tracking-normal">
            {fact.value}
          </dd>
          {fact.attribution ? (
            <p className="type-body-small text-ink-soft mt-3">{fact.attribution}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function LatestList({ items }: LatestListProps) {
  if (items.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No recent activity listed.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <article key={item.id} className="bg-surface-container-lowest rounded-lg p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="type-label-medium text-ink-muted">
                  {formatSourceType(item.sourceType)}
                </span>
                {item.dateLabel ? (
                  <span className="type-label-medium text-ink-muted">{item.dateLabel}</span>
                ) : null}
              </div>
              <a
                href={item.href}
                className="type-title-large text-ink-strong hover:text-accent inline-flex items-start gap-2 transition-colors"
              >
                <span>{item.title}</span>
                <ExternalLink className="mt-1 h-4 w-4 shrink-0" aria-hidden />
              </a>
              <p className="type-body-small text-ink-muted font-medium">{item.attribution}</p>
              {item.excerpt ? (
                <p className="type-body-medium text-ink-soft max-w-3xl">{item.excerpt}</p>
              ) : null}
              {item.linkedActors.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {item.linkedActors.map((actor) => (
                    <a
                      key={actor.id}
                      href={actor.href}
                      className="type-label-medium bg-surface-container text-ink-soft hover:text-ink-strong rounded-full px-3 py-1"
                    >
                      {actor.name}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            {item.topics.length > 0 ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                {item.topics.map((topic) => (
                  <span
                    key={topic}
                    className="type-label-medium bg-surface-container text-ink-soft rounded-full px-3 py-1"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function LatestFeed({ initialLatest, placeKind, placeSlug }: LatestFeedProps) {
  const [latest, setLatest] = useState(initialLatest);
  const [query, setQuery] = useState("");
  const [selectedSourceType, setSelectedSourceType] = useState<SourceType | null>(null);
  const [isLatestLoading, setIsLatestLoading] = useState(false);
  const [latestError, setLatestError] = useState<string | null>(null);
  const latestRequestId = useRef(0);

  async function loadLatest(params: LatestLoadParams) {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLatestLoading(true);
    setLatestError(null);

    try {
      const next = await api.places.listLatest(placeSlug, {
        cursor: params.cursor,
        kind: placeKind,
        limit: 10,
        query: params.nextQuery?.trim() || undefined,
        sourceTypes: params.nextSourceType ? [params.nextSourceType] : undefined,
      });
      if (latestRequestId.current !== requestId) {
        return;
      }
      setLatest((current) => ({
        items: params.cursor ? [...current.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
      }));
    } catch {
      if (latestRequestId.current === requestId) {
        setLatestError("Latest activity could not load.");
      }
    } finally {
      if (latestRequestId.current === requestId) {
        setIsLatestLoading(false);
      }
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadLatest({ nextQuery: query, nextSourceType: selectedSourceType });
  }

  function chooseSourceType(value: SourceType | null) {
    setSelectedSourceType(value);
    void loadLatest({ nextQuery: query, nextSourceType: value });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submitSearch} className="flex flex-col gap-3 lg:flex-row">
        <label className="sr-only" htmlFor="place-latest-search">
          Search latest activity
        </label>
        <input
          id="place-latest-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="type-body-medium bg-surface-container-lowest text-ink-strong placeholder:text-ink-muted focus:ring-civic rounded-lg px-4 py-3 outline-none focus:ring-2 lg:flex-1"
          placeholder="Search latest activity"
        />
        <button
          type="submit"
          disabled={isLatestLoading}
          className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 transition-colors disabled:opacity-60"
        >
          <Search className="h-4 w-4" aria-hidden />
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isLatestLoading}
          onClick={() => {
            chooseSourceType(null);
          }}
          className={cn(
            "type-label-large rounded-full px-3 py-1.5 transition-colors disabled:opacity-60",
            selectedSourceType === null
              ? "bg-ink-strong text-surface"
              : "bg-surface-container text-ink-soft hover:text-ink-strong",
          )}
        >
          All
        </button>
        {LATEST_SOURCE_TYPES.map((sourceType) => (
          <button
            key={sourceType.value}
            type="button"
            disabled={isLatestLoading}
            onClick={() => {
              chooseSourceType(sourceType.value);
            }}
            className={cn(
              "type-label-large rounded-full px-3 py-1.5 transition-colors disabled:opacity-60",
              selectedSourceType === sourceType.value
                ? "bg-ink-strong text-surface"
                : "bg-surface-container text-ink-soft hover:text-ink-strong",
            )}
          >
            {sourceType.label}
          </button>
        ))}
      </div>

      {latestError ? (
        <p
          role="alert"
          className="type-body-medium border-error bg-error-container text-on-error-container rounded-lg border p-4"
        >
          {latestError}
        </p>
      ) : null}

      <LatestList items={latest.items} />

      {latest.nextCursor ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={isLatestLoading}
            onClick={() => {
              void loadLatest({
                cursor: latest.nextCursor,
                nextQuery: query,
                nextSourceType: selectedSourceType,
              });
            }}
            className="type-label-large bg-surface-container text-ink-strong hover:bg-surface-container-high rounded-full px-4 py-2 transition-colors disabled:opacity-60"
          >
            {isLatestLoading ? "Loading" : "Show more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ActorCard({ actor }: ActorCardProps) {
  return (
    <article className="bg-surface-container-lowest rounded-lg p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <a href={actor.href} className="type-title-medium text-ink-strong hover:text-accent">
            {actor.name}
          </a>
          <p className="type-body-small text-ink-muted mt-1 font-medium">{actor.description}</p>
        </div>
        <span className="type-label-medium bg-surface-container text-ink-soft rounded-full px-3 py-1">
          {actor.type}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="bg-surface-container-low rounded-lg px-3 py-2">
          <p className="type-label-small text-ink-muted">Work</p>
          <p className="type-body-small text-ink-strong mt-1">{actor.work}</p>
        </div>
        {actor.latest ? (
          <div className="bg-surface-container-low rounded-lg px-3 py-2">
            <p className="type-label-small text-ink-muted">Latest</p>
            <p className="type-body-small text-ink-strong mt-1">{actor.latest}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function actorInitial(name: string) {
  const initial = name.trim().charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(initial) ? initial : "#";
}

function groupActorsByInitial(actors: PlaceActorSummary[]): ActorGroup[] {
  const groups = new Map<string, PlaceActorSummary[]>();
  actors.forEach((actor) => {
    const label = actorInitial(actor.name);
    const group = groups.get(label) ?? [];
    group.push(actor);
    groups.set(label, group);
  });
  return [...groups.entries()].map(([label, groupActors]) => ({
    actors: groupActors,
    label,
  }));
}

function ActorList({ actors, sort }: ActorListProps) {
  if (actors.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No people or organizations listed.
      </p>
    );
  }

  if (sort === "name") {
    return (
      <div className="space-y-5">
        {groupActorsByInitial(actors).map((group) => (
          <div key={group.label}>
            <h3 className="type-label-large text-ink-muted mb-2">{group.label}</h3>
            <div className="grid gap-3">
              {group.actors.map((actor) => (
                <ActorCard key={actor.id} actor={actor} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {actors.map((actor) => (
        <ActorCard key={actor.id} actor={actor} />
      ))}
    </div>
  );
}

function ActorDirectory({ initialActors, placeKind, placeSlug }: ActorDirectoryProps) {
  const [actors, setActors] = useState(initialActors);
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState<EntryType | null>(null);
  const [selectedSort, setSelectedSort] = useState<PlaceActorSort>("relevance");
  const [isActorLoading, setIsActorLoading] = useState(false);
  const [actorError, setActorError] = useState<string | null>(null);
  const actorRequestId = useRef(0);

  async function loadActors(params: ActorLoadParams) {
    const requestId = actorRequestId.current + 1;
    actorRequestId.current = requestId;
    setIsActorLoading(true);
    setActorError(null);

    try {
      const loadParams: PlaceActorParams = { limit: 20 };
      loadParams.kind = placeKind;
      const nextQuery = params.nextQuery?.trim();
      if (params.cursor) {
        loadParams.cursor = params.cursor;
      }
      if (nextQuery) {
        loadParams.query = nextQuery;
      }
      if (params.nextSort) {
        loadParams.sort = params.nextSort;
      }
      if (params.nextType) {
        loadParams.type = params.nextType;
      }

      const next = await api.places.listActors(placeSlug, loadParams);
      if (actorRequestId.current !== requestId) {
        return;
      }
      setActors((current) => ({
        items: params.cursor ? [...current.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
      }));
    } catch {
      if (actorRequestId.current === requestId) {
        setActorError("People and organizations could not load.");
      }
    } finally {
      if (actorRequestId.current === requestId) {
        setIsActorLoading(false);
      }
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadActors({ nextQuery: query, nextSort: selectedSort, nextType: selectedType });
  }

  function chooseType(value: EntryType | null) {
    setSelectedType(value);
    void loadActors({ nextQuery: query, nextSort: selectedSort, nextType: value });
  }

  function chooseSort(value: PlaceActorSort) {
    setSelectedSort(value);
    void loadActors({ nextQuery: query, nextSort: value, nextType: selectedType });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submitSearch} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <label className="sr-only" htmlFor="place-actor-search">
          Search people and organizations
        </label>
        <input
          id="place-actor-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="type-body-medium bg-surface-container-lowest text-ink-strong placeholder:text-ink-muted focus:ring-civic rounded-lg px-4 py-3 outline-none focus:ring-2 lg:flex-1"
          placeholder="Search people, organizations, work"
        />
        <label className="sr-only" htmlFor="place-actor-sort">
          Sort people and organizations
        </label>
        <select
          id="place-actor-sort"
          value={selectedSort}
          onChange={(event) => {
            chooseSort(event.target.value as PlaceActorSort);
          }}
          className="type-body-medium bg-surface-container-lowest text-ink-strong focus:ring-civic rounded-lg px-4 py-3 outline-none focus:ring-2"
          disabled={isActorLoading}
        >
          {ACTOR_SORTS.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isActorLoading}
          className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 transition-colors disabled:opacity-60"
        >
          <Search className="h-4 w-4" aria-hidden />
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isActorLoading}
          onClick={() => {
            chooseType(null);
          }}
          className={cn(
            "type-label-large rounded-full px-3 py-1.5 transition-colors disabled:opacity-60",
            selectedType === null
              ? "bg-ink-strong text-surface"
              : "bg-surface-container text-ink-soft hover:text-ink-strong",
          )}
        >
          All
        </button>
        {ACTOR_TYPES.map((type) => (
          <button
            key={type.value}
            type="button"
            disabled={isActorLoading}
            onClick={() => {
              chooseType(type.value);
            }}
            className={cn(
              "type-label-large rounded-full px-3 py-1.5 transition-colors disabled:opacity-60",
              selectedType === type.value
                ? "bg-ink-strong text-surface"
                : "bg-surface-container text-ink-soft hover:text-ink-strong",
            )}
          >
            {type.label}
          </button>
        ))}
      </div>

      {actorError ? (
        <p
          role="alert"
          className="type-body-medium border-error bg-error-container text-on-error-container rounded-lg border p-4"
        >
          {actorError}
        </p>
      ) : null}

      <ActorList actors={actors.items} sort={selectedSort} />

      {actors.nextCursor ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={isActorLoading}
            onClick={() => {
              void loadActors({
                cursor: actors.nextCursor,
                nextQuery: query,
                nextSort: selectedSort,
                nextType: selectedType,
              });
            }}
            className="type-label-large bg-surface-container text-ink-strong hover:bg-surface-container-high rounded-full px-4 py-2 transition-colors disabled:opacity-60"
          >
            {isActorLoading ? "Loading" : "Show more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function IssueGrid({ issues }: IssueGridProps) {
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

function IssueLine({ label, values }: IssueLineProps) {
  return (
    <div className="bg-surface-container-low rounded-lg px-3 py-2">
      <p className="type-label-small text-ink-muted">{label}</p>
      <p className="type-body-small text-ink-strong mt-1">{values.join(", ")}</p>
    </div>
  );
}

function GovernmentList({ governments }: GovernmentListProps) {
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

function PlaceHighlights({ places }: PlaceHighlightsProps) {
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

function PlaceMapThumbnail({ place, places }: PlaceCardProps) {
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

function PlaceGrid({ places }: PlaceGridProps) {
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

export function PlacePage({ data }: PlacePageProps) {
  return (
    <main className="bg-page-bg text-ink-strong">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="grid gap-5 lg:grid-cols-2">
          <div className="bg-surface-container-low rounded-2xl p-5 sm:p-7 lg:p-8">
            <p className="type-label-large text-ink-soft">{data.identity.display}</p>
            <h1 className="text-ink-strong mt-3 text-4xl leading-none font-semibold tracking-normal sm:text-5xl lg:text-6xl">
              {data.identity.name}
            </h1>
            <ScopeNav name={data.identity.name} scopes={data.identity.scopes} />
          </div>

          <PlaceHighlights places={data.places} />
        </header>

        <div className="bg-surface-container mt-3 rounded-2xl p-3 sm:p-4">
          <SummaryFactStrip facts={data.summaryFacts} />
        </div>

        <nav
          aria-label={`${data.identity.name} sections`}
          className="bg-surface-container-high/95 sticky top-16 z-10 mt-4 flex gap-2 overflow-x-auto rounded-2xl p-2 backdrop-blur"
        >
          {SECTION_NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="type-label-large text-ink-soft hover:bg-surface-container-lowest hover:text-ink-strong shrink-0 rounded-full px-3 py-1.5"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="mt-4 grid gap-5">
          <PlaceSection id="latest" title="Latest">
            <LatestFeed
              initialLatest={data.latest}
              placeKind={data.identity.kind}
              placeSlug={data.identity.slug}
            />
          </PlaceSection>

          <PlaceSection id="people-organizations" title="People & Organizations">
            <ActorDirectory
              initialActors={data.actors}
              placeKind={data.identity.kind}
              placeSlug={data.identity.slug}
            />
          </PlaceSection>

          <PlaceSection id="issues" title="Issues">
            <IssueGrid issues={data.issues} />
          </PlaceSection>

          <PlaceSection id="facts" title="Facts">
            <FactGrid facts={data.facts} />
          </PlaceSection>

          <PlaceSection id="government" title="Government">
            <GovernmentList governments={data.governments} />
          </PlaceSection>

          <PlaceSection id="places" title="Places">
            <PlaceGrid places={data.places} />
          </PlaceSection>
        </div>
      </div>
    </main>
  );
}
