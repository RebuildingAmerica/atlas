import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  MapPinned,
  Mic2,
  Newspaper,
  Search,
  Users2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { EntryFilters } from "@/components/entries/entry-filters";
import { EntryList } from "@/components/entries/entry-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/page-layout";
import { useEntries } from "@/hooks/use-entries";
import { useTaxonomy } from "@/hooks/use-taxonomy";

const searchSchema = z.object({
  query: z.string().optional(),
  states: z.string().optional(),
  cities: z.string().optional(),
  regions: z.string().optional(),
  issue_areas: z.string().optional(),
  entry_types: z.string().optional(),
  source_types: z.string().optional(),
  offset: z.coerce.number().min(0).optional().catch(0),
});

type RouteSearch = z.infer<typeof searchSchema>;
type FilterKey = "states" | "cities" | "regions" | "issue_areas" | "entry_types" | "source_types";

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: "People",
  organization: "Organizations",
  initiative: "Initiatives",
  campaign: "Campaigns",
  event: "Events",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  news_article: "Local news",
  op_ed: "Opinion",
  podcast: "Podcasts",
  academic_paper: "Research",
  government_record: "Government records",
  social_media: "Social media",
  org_website: "Organization sites",
  conference: "Conferences",
  video: "Video",
  report: "Reports",
  other: "Other",
};

const FEATURED_SOURCE_TYPES = ["news_article", "podcast", "government_record", "org_website"];
const FEATURED_ENTRY_TYPES = ["person", "organization", "initiative", "campaign"];

export const Route = createFileRoute("/")({
  ssr: false,
  validateSearch: searchSchema,
  component: BrowsePage,
});

function parseList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function serializeList(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.join(",");
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function BrowsePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: taxonomy } = useTaxonomy();

  const selectedFilters = useMemo(
    () => ({
      states: parseList(search.states),
      cities: parseList(search.cities),
      regions: parseList(search.regions),
      issue_areas: parseList(search.issue_areas),
      entry_types: parseList(search.entry_types),
      source_types: parseList(search.source_types),
    }),
    [search],
  );

  const [queryDraft, setQueryDraft] = useState(search.query ?? "");

  useEffect(() => {
    setQueryDraft(search.query ?? "");
  }, [search.query]);

  const issueAreaLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    if (!taxonomy) {
      return labels;
    }
    Object.values(taxonomy).forEach((issues) => {
      issues.forEach((issue) => {
        labels[issue.slug] = issue.name;
      });
    });
    return labels;
  }, [taxonomy]);

  const quickIssueAreas = useMemo(() => {
    if (!taxonomy) {
      return [];
    }
    return Object.values(taxonomy)
      .flat()
      .slice(0, 8)
      .map((issue) => ({ slug: issue.slug, label: issue.name }));
  }, [taxonomy]);

  const entriesQuery = useEntries({
    query: search.query,
    states: selectedFilters.states,
    cities: selectedFilters.cities,
    regions: selectedFilters.regions,
    issue_areas: selectedFilters.issue_areas,
    entry_types: selectedFilters.entry_types as Array<
      "person" | "organization" | "initiative" | "campaign" | "event"
    >,
    source_types: selectedFilters.source_types as Array<
      | "news_article"
      | "op_ed"
      | "podcast"
      | "academic_paper"
      | "government_record"
      | "social_media"
      | "org_website"
      | "conference"
      | "video"
      | "report"
      | "other"
    >,
    limit: 20,
    offset: search.offset ?? 0,
  });

  const results = entriesQuery.data;
  const resultEntries = results?.data ?? [];
  const total = results?.pagination.total ?? 0;
  const atlasIsEmpty = !entriesQuery.isLoading && !entriesQuery.error && total === 0;
  const hasActiveSearch =
    Boolean(search.query) ||
    selectedFilters.states.length > 0 ||
    selectedFilters.cities.length > 0 ||
    selectedFilters.regions.length > 0 ||
    selectedFilters.issue_areas.length > 0 ||
    selectedFilters.entry_types.length > 0 ||
    selectedFilters.source_types.length > 0;

  const selectedBadges = [
    ...selectedFilters.states.map((value) => ({ key: "states" as const, value, label: value })),
    ...selectedFilters.cities.map((value) => ({ key: "cities" as const, value, label: value })),
    ...selectedFilters.regions.map((value) => ({ key: "regions" as const, value, label: value })),
    ...selectedFilters.issue_areas.map((value) => ({
      key: "issue_areas" as const,
      value,
      label: issueAreaLabels[value] ?? humanize(value),
    })),
    ...selectedFilters.entry_types.map((value) => ({
      key: "entry_types" as const,
      value,
      label: ENTITY_TYPE_LABELS[value] ?? humanize(value),
    })),
    ...selectedFilters.source_types.map((value) => ({
      key: "source_types" as const,
      value,
      label: SOURCE_TYPE_LABELS[value] ?? humanize(value),
    })),
  ];

  const updateSearch = (next: Partial<RouteSearch>) => {
    void navigate({
      to: "/",
      search: (previous) => ({
        ...previous,
        ...next,
      }),
    });
  };

  const handleToggleFilter = (key: FilterKey, value: string) => {
    updateSearch({
      [key]: serializeList(toggleValue(selectedFilters[key], value)),
      offset: 0,
    });
  };

  const runSearch = (value?: string) => {
    updateSearch({ query: value || undefined, offset: 0 });
  };

  const geographySummary = [
    selectedFilters.states.length ? `${selectedFilters.states.length} states` : null,
    selectedFilters.regions.length ? `${selectedFilters.regions.length} regions` : null,
    selectedFilters.cities.length ? `${selectedFilters.cities.length} municipalities` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <PageLayout className="space-y-8 py-10">
      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2rem] border border-stone-300 bg-[#f8f2e7] p-8 shadow-[0_18px_50px_rgba(28,25,23,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">
            The Atlas
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-stone-950 md:text-6xl">
            A working index of people and organizations doing civic work across the country.
          </h1>
          <div className="mt-6 max-w-3xl space-y-4 text-base leading-8 text-stone-700">
            <p>
              Across the country, people are organizing tenants, building worker co-ops,
              defending clean water, reimagining public safety, and keeping institutions alive.
              They are often visible only in fragments.
            </p>
            <p>
              Atlas should let you move through that landscape directly: by person,
              organization, issue, geography, and the kinds of public records or media
              appearances that surface them.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[1.5rem] border border-stone-300 bg-white/85 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Search
              </p>
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  runSearch(queryDraft);
                }}
              >
                <div className="flex items-center gap-3 rounded-[1.25rem] border border-stone-300 bg-stone-50 px-4 py-3">
                  <Search className="h-4 w-4 text-stone-500" />
                  <input
                    value={queryDraft}
                    onChange={(event) => setQueryDraft(event.target.value)}
                    placeholder="Search names, issues, campaigns, geographies"
                    className="w-full bg-transparent text-base text-stone-900 outline-none placeholder:text-stone-400"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {["housing", "labor", "climate", "democracy", "justice"].map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => {
                        setQueryDraft(sample);
                        runSearch(sample);
                      }}
                      className="rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-100"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </form>
            </div>

            <div className="rounded-[1.5rem] border border-stone-300 bg-stone-950 p-5 text-stone-100">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">
                Current scope
              </p>
              <dl className="mt-4 space-y-4">
                <div>
                  <dt className="text-xs uppercase tracking-[0.22em] text-stone-500">Entries</dt>
                  <dd className="mt-1 text-3xl font-semibold">{total}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.22em] text-stone-500">Geography</dt>
                  <dd className="mt-1 text-sm leading-6 text-stone-200">
                    {geographySummary || "No geography lens applied"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.22em] text-stone-500">Active filters</dt>
                  <dd className="mt-1 text-sm leading-6 text-stone-200">
                    {selectedBadges.length > 0 ? `${selectedBadges.length} applied` : "None yet"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-stone-300 bg-white/90 p-6 shadow-[0_18px_50px_rgba(28,25,23,0.06)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">
                Atlas board
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
                Start from a dimension, not a homepage.
              </h2>
            </div>
            <MapPinned className="h-6 w-6 text-stone-500" />
          </div>

          <div className="mt-6 grid gap-4">
            <QuickFilterGroup
              title="Issue areas"
              icon={<MapPinned className="h-4 w-4" />}
              theme="light"
              items={quickIssueAreas.map((issue) => ({
                value: issue.slug,
                label: issue.label,
                active: selectedFilters.issue_areas.includes(issue.slug),
                onClick: () => handleToggleFilter("issue_areas", issue.slug),
              }))}
            />

            <QuickFilterGroup
              title="Entity types"
              icon={<Users2 className="h-4 w-4" />}
              theme="light"
              items={FEATURED_ENTRY_TYPES.map((entryType) => ({
                value: entryType,
                label: ENTITY_TYPE_LABELS[entryType] ?? humanize(entryType),
                active: selectedFilters.entry_types.includes(entryType),
                onClick: () => handleToggleFilter("entry_types", entryType),
              }))}
            />

            <QuickFilterGroup
              title="Mention types"
              icon={<Newspaper className="h-4 w-4" />}
              theme="light"
              items={FEATURED_SOURCE_TYPES.map((sourceType) => ({
                value: sourceType,
                label: SOURCE_TYPE_LABELS[sourceType] ?? humanize(sourceType),
                active: selectedFilters.source_types.includes(sourceType),
                onClick: () => handleToggleFilter("source_types", sourceType),
              }))}
            />

            <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                    Geography
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-700">
                    State, region, and municipality are first-class filters, but they are only
                    one part of the search space.
                  </p>
                </div>
                <Building2 className="h-5 w-5 text-stone-400" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {["State", "Region", "Municipality", "Neighborhood"].map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-stone-300 px-3 py-1 text-sm text-stone-600"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2rem] border border-stone-300 bg-white/90 p-6 shadow-[0_18px_50px_rgba(28,25,23,0.06)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Live surface
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
                {atlasIsEmpty && !hasActiveSearch ? "The Atlas needs to be seeded." : "Current matches"}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {search.query ? <Badge variant="info">Query: {search.query}</Badge> : null}
              {selectedBadges.map((badge) => (
                <button
                  key={`${badge.key}:${badge.value}`}
                  type="button"
                  onClick={() => handleToggleFilter(badge.key, badge.value)}
                >
                  <Badge>{badge.label}</Badge>
                </button>
              ))}
            </div>
          </div>

          {resultEntries.length > 0 ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {resultEntries.slice(0, 4).map((entry) => (
                <Link
                  key={entry.id}
                  to="/entries/$entryId"
                  params={{ entryId: entry.id }}
                  className="group rounded-[1.5rem] border border-stone-300 bg-[#fcfaf5] p-5 transition-colors hover:border-stone-500"
                >
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="info">{ENTITY_TYPE_LABELS[entry.type] ?? humanize(entry.type)}</Badge>
                    <span className="text-xs font-medium text-stone-500">{entry.source_count} sources</span>
                  </div>
                  <p className="mt-4 text-lg font-semibold text-stone-950">{entry.name}</p>
                  <p className="mt-1 text-sm font-medium text-stone-500">
                    {[entry.city, entry.state].filter(Boolean).join(", ") || entry.region || "Location not specified"}
                  </p>
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-700">
                    {entry.description}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <AtlasModeCard
                icon={<Users2 className="h-5 w-5" />}
                title="Search by people or organizations"
                description="Names should be a first-class entry point into the civic landscape, not an afterthought behind issue pages."
              />
              <AtlasModeCard
                icon={<MapPinned className="h-5 w-5" />}
                title="Use layered filters"
                description="Geography, issue area, entity type, and source type should all be combinable from the first screen."
              />
              <AtlasModeCard
                icon={<Mic2 className="h-5 w-5" />}
                title="Follow visibility trails"
                description="People and organizations appear differently across local news, podcasts, public records, and organization sites."
              />
              <AtlasModeCard
                icon={<Building2 className="h-5 w-5" />}
                title="Run discovery"
                description="The current database is empty. Until it is seeded, this page can show the interaction model but not the civic landscape itself."
              />
            </div>
          )}
        </div>

        <div className="rounded-[2rem] border border-stone-300 bg-[#f4efe2] p-6 shadow-[0_18px_50px_rgba(28,25,23,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Notes
          </p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-stone-700">
            <p>
              The marketed promise is a map of civic activity. This page now behaves more like a
              research desk than a SaaS landing page, but it is still a faceted directory surface,
              not a literal geographic map.
            </p>
            <p>
              A real map view should be added as its own interface once entries have normalized
              coordinates or mappable geography. Right now the stronger problem is making the main
              browse surface feel alive, useful, and direct.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/discovery"
              className="inline-flex items-center rounded-full border border-stone-900 px-4 py-2 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-white"
            >
              Open discovery
            </Link>
            <button
              type="button"
              onClick={() => {
                setQueryDraft("");
                void navigate({ to: "/", search: {} });
              }}
              className="inline-flex items-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-100"
            >
              Reset lens
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
        <EntryFilters
          query={queryDraft}
          onQueryChange={setQueryDraft}
          onSearchSubmit={() => updateSearch({ query: queryDraft || undefined, offset: 0 })}
          onClear={() => {
            setQueryDraft("");
            void navigate({ to: "/", search: {} });
          }}
          selectedFilters={selectedFilters}
          onToggleFilter={handleToggleFilter}
          facets={
            results?.facets ?? {
              states: [],
              cities: [],
              regions: [],
              issue_areas: [],
              entity_types: [],
              source_types: [],
            }
          }
          issueAreaLabels={issueAreaLabels}
        />

        <div className="space-y-6">
          <EntryList
            entries={resultEntries}
            total={results?.pagination.total}
            isLoading={entriesQuery.isLoading}
            error={entriesQuery.error}
            issueAreaLabels={issueAreaLabels}
            hasActiveSearch={hasActiveSearch}
          />

          {results?.pagination.total ? (
            <div className="flex items-center justify-between rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-stone-500">
                Showing {results.pagination.offset + 1}-
                {Math.min(
                  results.pagination.offset + results.pagination.limit,
                  results.pagination.total,
                )}{" "}
                of {results.pagination.total}
              </p>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  disabled={results.pagination.offset === 0}
                  onClick={() =>
                    updateSearch({
                      offset: Math.max(0, results.pagination.offset - results.pagination.limit),
                    })
                  }
                >
                  Previous
                </Button>
                <Button
                  disabled={!results.pagination.has_more}
                  onClick={() =>
                    updateSearch({
                      offset: results.pagination.offset + results.pagination.limit,
                    })
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </PageLayout>
  );
}

function QuickFilterGroup({
  title,
  icon,
  items,
  theme = "dark",
}: {
  title: string;
  icon: ReactNode;
  items: Array<{ value: string; label: string; active: boolean; onClick: () => void }>;
  theme?: "dark" | "light";
}) {
  if (items.length === 0) {
    return null;
  }

  const titleClass =
    theme === "light"
      ? "text-stone-500"
      : "text-slate-300";

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] ${titleClass}`}>
        {icon}
        <span>{title}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={item.onClick}
            className={[
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              theme === "light"
                ? item.active
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-300 bg-stone-50 text-stone-700 hover:border-stone-500 hover:bg-stone-100"
                : item.active
                  ? "border-sky-300 bg-sky-400/20 text-sky-100"
                  : "border-white/12 bg-slate-950/45 text-slate-100 hover:border-white/20 hover:bg-white/10",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AtlasModeCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-stone-300 bg-[#fcfaf5] p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-900 text-stone-50">
        {icon}
      </div>
      <p className="mt-4 text-lg font-semibold text-stone-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-700">{description}</p>
    </div>
  );
}
