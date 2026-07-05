import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { ExternalLink, MapPin, Search } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  EntryType,
  PlaceActorList,
  PlaceActorSummary,
  PlaceFact,
  PlaceGovernmentSummary,
  PlaceIssueSummary,
  PlaceLatestItem,
  PlacePageData,
  PlaceRelatedSummary,
  PlaceScopeLink,
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

interface ActorCardProps {
  actor: PlaceActorSummary;
}

interface ActorDirectoryProps {
  initialActors: PlaceActorList;
  placeSlug: string;
}

interface ActorLoadParams {
  cursor?: string;
  nextQuery?: string;
  nextType?: EntryType | null;
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

function formatSourceType(value: string): string {
  const label = value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
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
        No recent public records listed.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <article key={item.id} className="bg-surface-container-lowest rounded-lg p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <p className="type-label-medium text-ink-muted">
                {formatSourceType(item.sourceType)}
              </p>
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

function ActorDirectory({ initialActors, placeSlug }: ActorDirectoryProps) {
  const [actors, setActors] = useState(initialActors);
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState<EntryType | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadActors(params: ActorLoadParams) {
    startTransition(() => {
      void api.places
        .listActors(placeSlug, {
          cursor: params.cursor,
          entity_type: params.nextType ? [params.nextType] : undefined,
          limit: 20,
          text: params.nextQuery || undefined,
        })
        .then((next) => {
          setActors((current) => ({
            items: params.cursor ? [...current.items, ...next.items] : next.items,
            nextCursor: next.nextCursor,
          }));
        });
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadActors({ nextQuery: query, nextType: selectedType });
  }

  function chooseType(value: EntryType | null) {
    setSelectedType(value);
    loadActors({ nextQuery: query, nextType: value });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submitSearch} className="flex flex-col gap-3 lg:flex-row">
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
          placeholder="Search people, organizations, neighborhoods, work"
        />
        <button
          type="submit"
          className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 transition-colors"
        >
          <Search className="h-4 w-4" aria-hidden />
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            chooseType(null);
          }}
          className={cn(
            "type-label-large rounded-full px-3 py-1.5 transition-colors",
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
            onClick={() => {
              chooseType(type.value);
            }}
            className={cn(
              "type-label-large rounded-full px-3 py-1.5 transition-colors",
              selectedType === type.value
                ? "bg-ink-strong text-surface"
                : "bg-surface-container text-ink-soft hover:text-ink-strong",
            )}
          >
            {type.label}
          </button>
        ))}
      </div>

      {actors.items.length > 0 ? (
        <div className="grid gap-3">
          {actors.items.map((actor) => (
            <ActorCard key={actor.id} actor={actor} />
          ))}
        </div>
      ) : (
        <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
          No people or organizations listed.
        </p>
      )}

      {actors.nextCursor ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              loadActors({ cursor: actors.nextCursor, nextQuery: query, nextType: selectedType });
            }}
            className="type-label-large bg-surface-container text-ink-strong hover:bg-surface-container-high rounded-full px-4 py-2 transition-colors disabled:opacity-60"
          >
            {isPending ? "Loading" : "Show more"}
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

function PlaceCard({ place }: PlaceCardProps) {
  return (
    <a
      href={place.href}
      className="group bg-surface-container-lowest hover:bg-surface rounded-lg p-3 transition-colors"
    >
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
        <PlaceCard key={place.href} place={place} />
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
            <LatestList items={data.latest} />
          </PlaceSection>

          <PlaceSection id="people-organizations" title="People & Organizations">
            <ActorDirectory initialActors={data.actors} placeSlug={data.identity.slug} />
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
