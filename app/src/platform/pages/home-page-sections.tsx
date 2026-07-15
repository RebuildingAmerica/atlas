import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import {
  ISSUE_CHIPS,
  type HomeFacetTile,
  ArrowRight,
  MapPinned,
  buildHomeIssueTiles,
  buildHomePlaceTiles,
  buildHomeSourceTiles,
  buildHomeTypeTiles,
  browseUrl,
  formatLocation,
  formatStatCount,
  profileHref,
} from "./home-page-data";
import type { Entry, EntrySearchFacets } from "@rebuildingamerica/atlas-api-client";
import { HomeDiscoverySection } from "./home-page-discovery";

interface HomeHeroActionsProps {
  query: string;
  onQueryChange: (value: string) => void;
}

interface HomePageShellProps {
  entries: Entry[];
  isSignedIn: boolean;
  localMode: boolean;
  onQueryChange: (value: string) => void;
  query: string;
  recentEntriesLoading: boolean;
  stateCount: number | undefined;
  totalEntries: number | undefined;
  organizationCount: number | undefined;
  facets: EntrySearchFacets | undefined;
}

function HomeHeroActions({ onQueryChange, query }: HomeHeroActionsProps) {
  return (
    <>
      <form action="/browse" className="mx-auto mt-10 max-w-3xl" method="get">
        <div className="border-border-strong bg-surface-container-lowest shadow-soft flex flex-col border sm:flex-row">
          <input type="hidden" name="offset" value="0" />
          <label className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 sm:px-5">
            <span className="sr-only">Search Atlas by name, place, issue, or organization</span>
            <Search className="text-ink-soft h-4 w-4 shrink-0" aria-hidden="true" />
            <input
              name="query"
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value);
              }}
              placeholder="Search by name, place, issue, or organization..."
              className="type-body-large text-ink-strong placeholder:text-ink-muted w-full bg-transparent outline-none"
            />
          </label>
          <button
            type="submit"
            className="type-label-large bg-ink-strong text-surface hover:bg-ink border-border-strong inline-flex min-h-12 items-center justify-center gap-2 border-t px-6 transition-colors duration-150 sm:border-t-0 sm:border-l"
          >
            Search
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {ISSUE_CHIPS.map((issue) => (
          <a
            key={issue}
            href={browseUrl(issue)}
            className="type-label-medium border-border-strong text-ink hover:bg-surface-container inline-flex min-h-8 items-center border px-3 py-1.5 no-underline transition-colors duration-150"
          >
            {issue}
          </a>
        ))}
      </div>
    </>
  );
}
export function HomePageShell({
  entries,
  facets,
  isSignedIn,
  localMode,
  onQueryChange,
  query,
  recentEntriesLoading,
  stateCount,
  totalEntries,
  organizationCount,
}: HomePageShellProps) {
  const issueTiles = buildHomeIssueTiles(facets);
  const placeTiles = buildHomePlaceTiles(facets);
  const sourceTiles = buildHomeSourceTiles(facets);
  const typeTiles = buildHomeTypeTiles(facets);
  const featuredEntries = entries.slice(0, 6);
  const homeStats = [
    {
      stat: formatStatCount(totalEntries),
      label: "civic actors indexed",
      loading: totalEntries === undefined,
    },
    {
      stat: formatStatCount(organizationCount),
      label: "organizations",
      loading: organizationCount === undefined,
    },
    {
      stat: stateCount && stateCount >= 50 ? "All 50" : formatStatCount(stateCount),
      label: stateCount && stateCount >= 50 ? "states covered" : "states represented",
      loading: stateCount === undefined,
    },
  ];

  return (
    <div className="text-ink-strong">
      <section className="border-border flex min-h-[calc(88svh-5rem)] items-center overflow-hidden border-b px-4 py-16 md:px-8 md:py-20">
        <div className="mx-auto w-full max-w-4xl text-center">
          <h1
            aria-label="Find the people rebuilding America."
            className="text-ink-strong text-5xl leading-tight text-balance md:text-7xl"
          >
            Find the people
            <br />
            <em className="font-serif italic">rebuilding America.</em>
          </h1>

          <p className="type-body-large text-ink-soft mx-auto mt-6 max-w-2xl text-balance">
            Atlas indexes civic actors: individuals, organizations, and initiatives working on
            public problems in every corner of the country.
          </p>

          <HomeHeroActions onQueryChange={onQueryChange} query={query} />

          {isSignedIn ? (
            <div className="mt-7 flex justify-center">
              <Link
                to="/home"
                className="type-label-large bg-accent text-accent-ink hover:bg-accent-deep inline-flex items-center justify-center px-6 py-3 no-underline transition-colors duration-150"
              >
                Go to your research &rarr;
              </Link>
            </div>
          ) : !localMode ? (
            <p className="type-body-medium text-ink-soft mt-7 text-center">
              Want to save your work?{" "}
              <Link to="/sign-up" className="text-accent-deep type-label-medium hover:underline">
                Create a free account &rarr;
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-border flex min-h-[100svh] items-center border-b px-4 py-20 md:px-8">
        <div className="mx-auto grid w-full max-w-[88rem] gap-16 md:grid-cols-[minmax(0,40rem)_minmax(0,44rem)] md:items-center">
          <div>
            <h2 className="max-w-4xl text-3xl leading-tight text-balance md:text-5xl">
              Good people are doing good work everywhere.{" "}
              <em className="font-serif italic">Atlas helps you find them.</em>
            </h2>
            <p className="type-body-large text-ink-soft mt-8 max-w-3xl">
              In every state, in cities and small towns, there are organizers, advocates, attorneys,
              researchers, and community leaders working on the problems that matter most. Most of
              them are invisible to anyone outside their immediate circles.
            </p>
            <p className="type-body-large text-ink-soft mt-5 max-w-3xl">
              Atlas makes them findable by place, by issue, by name, or by the organizations they
              belong to. Search, save people you find, and look at who else is active in the same
              place or on the same problem.
            </p>
          </div>

          <div className="border-border bg-surface-container-lowest border">
            <div className="border-border border-b px-8 py-6">
              <div className="border-border-strong bg-surface flex items-center gap-3 border px-4 py-3">
                <Search className="text-ink-muted h-4 w-4" aria-hidden="true" />
                <span className="type-body-medium text-ink-soft">
                  Search by name, place, issue, or organization
                </span>
              </div>
            </div>
            <FacetTileGrid tiles={issueTiles.slice(0, 4)} />
            <div className="border-border flex flex-wrap items-center justify-between gap-4 border-t px-8 py-4">
              <span className="type-label-small text-ink-soft">
                People · organizations · initiatives · campaigns
              </span>
              <span className="type-label-small text-accent-deep">All 50 states</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-border bg-surface-container border-y">
        <div className="divide-border mx-auto grid max-w-[88rem] divide-y md:grid-cols-[repeat(3,minmax(0,28rem))] md:justify-between md:divide-x md:divide-y-0">
          {homeStats.map(({ label, loading, stat }) => (
            <div key={label} className="flex min-h-32 flex-col justify-end px-8 py-8 md:min-h-40">
              <div className="font-serif text-[clamp(2.75rem,7vw,5.75rem)] leading-none">
                {loading ? (
                  <span
                    aria-label={`${label} loading`}
                    className="type-title-large text-ink-muted/70 font-sans"
                  >
                    Loading
                  </span>
                ) : (
                  stat
                )}
              </div>
              <div className="type-title-medium text-ink-soft mt-4">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-border border-b px-4 py-24 md:px-8">
        <div className="mx-auto grid w-full max-w-[88rem] gap-16 md:grid-cols-[minmax(0,28rem)_minmax(0,56rem)]">
          <div>
            <h2 className="font-serif text-3xl leading-snug text-balance md:text-4xl">
              Map the field.
            </h2>
            <p className="type-body-large text-ink-soft mt-6">
              Atlas is not a flat directory. It treats civic work as a field: people belong to
              organizations, organizations join coalitions, coalitions work across places, and gaps
              matter as much as what is already well documented.
            </p>
            <p className="type-body-large text-ink-soft mt-5">
              Use it to understand structure. Who leads, who staffs, who collaborates, where
              coverage is strong, and where the public record still needs work.
            </p>
          </div>

          <div className="border-border bg-surface-container-lowest border">
            <div className="border-border flex items-center justify-between gap-4 border-b px-8 py-4">
              <span className="font-serif text-sm">Recently indexed</span>
              <span className="type-label-small text-ink-soft">{featuredEntries.length} shown</span>
            </div>
            {featuredEntries.map((entry) => (
              <a
                key={entry.id}
                href={profileHref(entry)}
                className="border-border hover:bg-surface-container flex items-center justify-between gap-4 border-b px-8 py-4 no-underline transition-colors duration-150 last:border-b-0"
              >
                <div>
                  <p className="font-serif text-sm">{entry.name}</p>
                  <p className="type-label-small text-ink-soft mt-1">{formatLocation(entry)}</p>
                </div>
                <span className="type-label-small text-ink-soft shrink-0">
                  {entry.source_count} sources
                </span>
              </a>
            ))}
            <p className="type-label-small bg-surface-container text-ink-soft border-border border-t px-8 py-4">
              Open each record to inspect the public sources behind it.
            </p>
          </div>
        </div>
      </section>

      <section className="border-border border-b px-4 py-24 md:px-8">
        <div className="mx-auto grid w-full max-w-[88rem] gap-16 md:grid-cols-[minmax(0,40rem)_minmax(0,44rem)] md:items-center">
          <div>
            <h2 className="text-3xl leading-snug text-balance md:text-4xl">Prepare for action.</h2>
            <p className="type-body-large text-ink-soft mt-6">
              When your team is entering a new city, planning a campaign, preparing a story, or
              looking for partners, Atlas helps turn a broad question into a usable short list. You
              get the people to know, the groups around them, and the gaps to check before anyone
              makes a call.
            </p>
            <FacetTileGrid tiles={placeTiles.slice(0, 4)} className="mt-10" />
          </div>

          <div className="border-border bg-surface-container-lowest border">
            <div className="border-border flex items-center justify-between gap-4 border-b px-8 py-4">
              <p className="flex items-center gap-2 font-serif text-sm">
                <MapPinned className="text-accent-deep h-4 w-4" aria-hidden="true" />
                Places with activity
              </p>
              <span className="type-label-small text-ink-soft">{placeTiles.length} shown</span>
            </div>
            <FacetTileGrid tiles={placeTiles.slice(0, 6)} />
          </div>
        </div>
      </section>

      <section className="border-border border-b px-4 py-24 md:px-8">
        <div className="mx-auto max-w-[88rem]">
          <div className="mb-16 grid gap-16 md:grid-cols-[minmax(0,50rem)_minmax(0,14rem)_minmax(0,16rem)]">
            <div className="md:col-span-2">
              <h2 className="text-3xl leading-snug text-balance md:text-4xl">Work as a team.</h2>
              <p className="type-body-large text-ink-soft mt-6">
                The same public records become shared work inside a team: save people, compare
                sources, assign follow-ups, and keep notes beside the records everyone can inspect.
              </p>
            </div>
            <div className="flex items-end">
              {!localMode ? (
                <Link
                  to="/pricing"
                  className="type-label-medium text-accent-deep inline-flex items-center gap-2 hover:underline"
                >
                  Pro and Team plans
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </div>

          <div className="border-border bg-surface-container-lowest border">
            <div className="border-border flex flex-col gap-4 border-b px-8 py-4 lg:flex-row lg:items-center lg:justify-between">
              <p className="font-serif text-sm">Source-backed records</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="type-label-small text-ink-soft">
                  {sourceTiles.length} source types shown
                </span>
              </div>
            </div>
            <FacetTileGrid tiles={[...sourceTiles, ...typeTiles].slice(0, 8)} columns="four" />
          </div>
        </div>
      </section>

      <HomeDiscoverySection
        entries={entries}
        issueTiles={issueTiles}
        recentEntriesLoading={recentEntriesLoading}
        totalEntries={totalEntries}
      />
    </div>
  );
}

function FacetTileGrid({
  className,
  columns = "two",
  tiles,
}: {
  className?: string;
  columns?: "two" | "four";
  tiles: HomeFacetTile[];
}) {
  if (tiles.length === 0) {
    return null;
  }

  return (
    <div
      className={[
        "border-border bg-border grid gap-px overflow-hidden border",
        columns === "four" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {tiles.map((tile) => (
        <a
          key={`${tile.href}:${tile.label}`}
          href={tile.href}
          className="bg-surface-container-lowest hover:bg-surface-container min-h-32 p-8 no-underline transition-colors duration-150"
        >
          <p className="text-ink-strong font-serif text-lg leading-snug">{tile.label}</p>
          <p className="type-label-small text-accent-deep mt-5">{tile.count}</p>
        </a>
      ))}
    </div>
  );
}
