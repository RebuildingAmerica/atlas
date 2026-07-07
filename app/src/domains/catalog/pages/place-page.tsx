import { cn } from "@/lib/utils";
import { ActorDirectory } from "./place-page-actors";
import { LatestFeed } from "./place-page-latest";
import { GovernmentList, IssueGrid, PlaceGrid, PlaceHighlights } from "./place-page-places";
import { SECTION_NAV_ITEMS } from "./place-page-utils";
import type {
  FactGridProps,
  PlacePageProps,
  PlaceSectionProps,
  ScopeNavProps,
  SummaryFactStripProps,
} from "./place-page.types";

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
