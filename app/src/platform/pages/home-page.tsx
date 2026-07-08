import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bell,
  BookOpen,
  ExternalLink,
  FileText,
  type LucideIcon,
  MapPinned,
  Search,
} from "lucide-react";
import { useState } from "react";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import type { Entry, EntryType } from "@/types";

interface HomeHeroActionsProps {
  query: string;
  onQueryChange: (value: string) => void;
}

interface SearchExample {
  query: string;
  result: string;
}

interface FieldActor {
  name: string;
  role: string;
  connections: string;
}

interface BriefActor {
  name: string;
  type: string;
  note: string;
  sources: number | "manual";
}

interface FeatureWorkflow {
  name: string;
  description: string;
  Icon: LucideIcon;
}

interface HomeStat {
  stat: string;
  label: string;
  loading: boolean;
}

interface IssueTile {
  count: string;
  description?: string;
  imageUrl?: string;
  label: string;
}

const ISSUE_CHIPS = [
  "Housing",
  "Climate",
  "Criminal Justice",
  "Education",
  "Voting Rights",
  "Immigration",
] as const;

const SEARCH_EXAMPLES: SearchExample[] = [
  { query: "tenant organizers · Detroit, MI", result: "34 actors" },
  { query: "voting rights · Georgia", result: "218 actors" },
  { query: "climate policy · Gulf Coast", result: "91 actors" },
  { query: "criminal justice reform · Texas", result: "174 actors" },
  { query: "housing advocates · Phoenix, AZ", result: "56 actors" },
];

const FIELD_ACTORS: FieldActor[] = [
  { name: "María Martínez", role: "Community organizer", connections: "4 connections" },
  {
    name: "Detroit Housing Coalition",
    role: "Organization · 8 staff indexed",
    connections: "12 connections",
  },
  {
    name: "Coalition for Property Tax Justice",
    role: "Coalition · 6 member orgs",
    connections: "7 connections",
  },
  {
    name: "Legal Aid & Defender Assoc.",
    role: "Organization · housing unit",
    connections: "3 connections",
  },
];

const FEATURE_WORKFLOWS: FeatureWorkflow[] = [
  {
    description: "Start with a place and problem, not a complicated research form.",
    Icon: Search,
    name: "Name the need",
  },
  {
    description: "See the people and organizations most relevant to the work ahead.",
    Icon: FileText,
    name: "Find the right people",
  },
  {
    description: "Know when the public record is thin before you rely on it.",
    Icon: Bell,
    name: "See what is missing",
  },
  {
    description: "Leave with a short list you can bring to a meeting or share with a team.",
    Icon: BookOpen,
    name: "Take it with you",
  },
];

const BRIEF_ACTORS: BriefActor[] = [
  {
    name: "María Martínez",
    note: "Avery is confirming meeting details before outreach.",
    sources: 8,
    type: "Assigned · follow-up",
  },
  {
    name: "Detroit Housing Coalition",
    note: "Shared note added for partner briefing.",
    sources: 12,
    type: "Reviewed",
  },
  {
    name: "Coalition for Property Tax Justice",
    note: "Coverage gap flagged for staff research.",
    sources: 4,
    type: "Needs review",
  },
  {
    name: "Legal Aid & Defender Assoc.",
    note: "Exported to county hearing packet.",
    sources: 5,
    type: "Exported",
  },
  {
    name: "James Whitfield",
    note: "Manual lead, visible only to this workspace.",
    sources: "manual",
    type: "Private note",
  },
  {
    name: "Wayne Co. Housing Commission",
    note: "Morgan assigned public-record refresh.",
    sources: 7,
    type: "Assigned · refresh",
  },
];

const ISSUE_TILES: IssueTile[] = [
  {
    count: "5,103 actors",
    description: "From early childhood to higher ed, the largest cluster of civic work in Atlas.",
    imageUrl:
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1200&q=80",
    label: "Education Equity",
  },
  {
    count: "4,667 actors",
    description:
      "Organizing, litigation, and policy documented across every region of the country.",
    imageUrl:
      "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80",
    label: "Racial Justice",
  },
  { count: "4,220 actors", label: "Climate & Environment" },
  { count: "3,812 actors", label: "Housing & Homelessness" },
  { count: "3,488 actors", label: "Economic Justice" },
  { count: "2,940 actors", label: "Criminal Justice Reform" },
  { count: "2,715 actors", label: "Healthcare Access" },
  { count: "2,341 actors", label: "Immigration" },
];

const TYPE_LABELS: Record<EntryType, string> = {
  campaign: "campaign",
  event: "event",
  initiative: "initiative",
  organization: "org",
  person: "person",
};

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

function formatStatCount(value: number | undefined): string {
  if (value === undefined || value <= 0) {
    return "";
  }

  return NUMBER_FORMATTER.format(value);
}

function browseUrl(query: string): string {
  return `/browse?query=${encodeURIComponent(query)}&offset=0`;
}

function humanizeIssue(value: string | undefined): string {
  if (!value) {
    return "Unlisted";
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatLocation(entry: Entry): string {
  return [entry.city, entry.state].filter(Boolean).join(", ") || entry.region || "Place not listed";
}

function profileHref(entry: Entry): string {
  if (!entry.slug) {
    return "/browse";
  }

  switch (entry.type) {
    case "campaign":
      return `/profiles/campaigns/${entry.slug}`;
    case "event":
      return `/profiles/events/${entry.slug}`;
    case "initiative":
      return `/profiles/initiatives/${entry.slug}`;
    case "organization":
      return `/profiles/organizations/${entry.slug}`;
    case "person":
      return `/profiles/people/${entry.slug}`;
  }
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

function RecentEntryRow({ entry }: { entry: Entry }) {
  const issue = humanizeIssue(entry.issue_areas[0]);
  const description = entry.description || formatLocation(entry);

  return (
    <a
      href={profileHref(entry)}
      className="group hover:bg-surface-container -mx-3 grid gap-3 px-3 py-4 no-underline transition-colors duration-150 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center"
    >
      <span className="type-label-small border-border-strong text-ink-soft w-fit border px-2 py-1">
        {TYPE_LABELS[entry.type]}
      </span>
      <span className="min-w-0">
        <span className="text-ink-strong font-serif text-base">{entry.name}</span>
        <span className="type-label-medium text-ink-soft mt-1 block truncate">{description}</span>
      </span>
      <span className="flex flex-wrap items-center gap-3 md:justify-end">
        <span className="type-label-small text-ink-soft">{formatLocation(entry)}</span>
        <span className="type-label-small border-border-strong text-civic border px-2 py-1">
          {issue}
        </span>
        <span className="type-label-small text-ink-soft">{entry.source_count} sources</span>
        <ExternalLink
          className="text-ink-muted h-3.5 w-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-70"
          aria-hidden="true"
        />
      </span>
    </a>
  );
}

export function HomePage() {
  const session = useAtlasSession();
  const localMode = session.data?.isLocal ?? false;
  const isSignedIn = session.data !== null && session.data !== undefined && !localMode;
  const [query, setQuery] = useState("");
  const recentEntries = useEntries({ limit: 16, offset: 0 });
  const entries = recentEntries.data?.data ?? [];
  const totalEntries = recentEntries.data?.pagination.total;
  const browseCount =
    totalEntries && totalEntries > 0 ? NUMBER_FORMATTER.format(totalEntries) : "actors";
  const organizationCount = recentEntries.data?.facets.entity_types?.find(
    (facet) => facet.value === "organization",
  )?.count;
  const stateCount = recentEntries.data?.facets.states?.length;
  const homeStats: HomeStat[] = [
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

          <HomeHeroActions onQueryChange={setQuery} query={query} />

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
                  housing organizers in Detroit
                </span>
              </div>
            </div>
            <div className="bg-border grid gap-px sm:grid-cols-2">
              {SEARCH_EXAMPLES.slice(0, 4).map((example) => (
                <a
                  key={example.query}
                  href={browseUrl(example.query)}
                  className="bg-surface-container-lowest hover:bg-surface-container min-h-32 p-8 no-underline transition-colors duration-150"
                >
                  <p className="text-ink-strong font-serif text-lg leading-snug">{example.query}</p>
                  <p className="type-label-small text-accent-deep mt-5">{example.result}</p>
                </a>
              ))}
            </div>
            <div className="border-border flex flex-wrap items-center justify-between gap-4 border-t px-8 py-4">
              <span className="type-label-small text-ink-soft">
                People · organizations · initiatives · coalitions
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
              <span className="font-serif text-sm">Housing · Detroit, MI</span>
              <span className="type-label-small text-ink-soft">34 actors · 9 orgs</span>
            </div>
            {FIELD_ACTORS.map((actor) => (
              <div
                key={actor.name}
                className="border-border flex items-center justify-between gap-4 border-b px-8 py-4 last:border-b-0"
              >
                <div>
                  <p className="font-serif text-sm">{actor.name}</p>
                  <p className="type-label-small text-ink-soft mt-1">{actor.role}</p>
                </div>
                <span className="type-label-small text-ink-soft shrink-0">{actor.connections}</span>
              </div>
            ))}
            <p className="type-label-small bg-surface-container text-ink-soft border-border border-t px-8 py-4">
              Coverage gap · transit + housing overlap: 2 known actors, weakly sourced
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
            <div className="border-border bg-border mt-10 grid gap-px overflow-hidden border sm:grid-cols-2">
              {FEATURE_WORKFLOWS.map((feature) => (
                <div key={feature.name} className="bg-surface-container-lowest p-8">
                  <feature.Icon className="text-accent-deep mb-5 h-5 w-5" aria-hidden="true" />
                  <p className="font-serif text-lg">{feature.name}</p>
                  <p className="type-body-small text-ink-soft mt-3">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border-border bg-surface-container-lowest border">
            <div className="border-border flex items-center justify-between gap-4 border-b px-8 py-4">
              <p className="flex items-center gap-2 font-serif text-sm">
                <MapPinned className="text-accent-deep h-4 w-4" aria-hidden="true" />
                Meeting prep · Wayne County housing
              </p>
              <span className="type-label-small text-ink-soft">Prepared today</span>
            </div>
            <div className="bg-border grid gap-px md:grid-cols-[0.9fr_1.1fr]">
              <div className="bg-surface-container-lowest p-8">
                <p className="font-serif text-xl leading-snug">
                  Who should we talk to before Thursday's tenant-protection hearing?
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {["Wayne County", "Housing", "Tenant groups", "Legal aid"].map((tag) => (
                    <span
                      key={tag}
                      className="type-label-small border-border-strong text-ink-soft border px-2.5 py-1"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="bg-surface-container-lowest p-8">
                <div className="space-y-4">
                  {[
                    ["34", "people and groups"],
                    ["11", "strong records"],
                    ["3", "gaps to check"],
                  ].map(([value, label]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4">
                      <span className="font-serif text-3xl">{value}</span>
                      <span className="type-label-small text-ink-soft">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="divide-border divide-y">
              {["Save the shortlist", "Share with the team", "Keep watching this issue"].map(
                (action) => (
                  <div key={action} className="flex items-center justify-between gap-4 px-8 py-4">
                    <span className="type-label-medium text-ink-strong">{action}</span>
                    <ArrowRight className="text-accent-deep h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="border-border border-b px-4 py-24 md:px-8">
        <div className="mx-auto max-w-[88rem]">
          <div className="mb-16 grid gap-16 md:grid-cols-[minmax(0,50rem)_minmax(0,14rem)_minmax(0,16rem)]">
            <div className="md:col-span-2">
              <h2 className="text-3xl leading-snug text-balance md:text-4xl">Work as a team.</h2>
              <p className="type-body-large text-ink-soft mt-6">
                Pro and Team plans give civic research a shared workspace: assign follow-ups, keep
                private notes beside Atlas records, review additions before they leave the team, and
                export clean packets for a story, funder update, coalition meeting, or partner
                handoff.
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
              <p className="font-serif text-sm">Workspace · Wayne County Housing</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="type-label-small text-ink-soft">3 teammates · updated 2h ago</span>
                {["Export", "Share", "Assign"].map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="type-label-small border-border-strong text-ink-soft hover:bg-surface-container border px-3 py-1.5 transition-colors duration-150"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-border grid gap-px md:grid-cols-3">
              {BRIEF_ACTORS.map((actor) => (
                <div key={actor.name} className="bg-surface-container-lowest px-8 py-6">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <p className="font-serif text-sm">{actor.name}</p>
                    <span className="type-label-small text-ink-soft shrink-0">
                      {typeof actor.sources === "number"
                        ? `${actor.sources} sources`
                        : actor.sources}
                    </span>
                  </div>
                  <p className="type-label-small text-accent-deep mb-2">{actor.type}</p>
                  <p className="type-body-small text-ink-soft">{actor.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-border border-b px-4 py-16 md:px-8">
        <div className="mx-auto max-w-[88rem]">
          <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="font-serif text-2xl">Recently indexed</h2>
            <Link
              to="/browse"
              className="type-label-medium text-accent-deep inline-flex items-center gap-1.5 hover:underline"
            >
              Browse all {browseCount}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          <div className="border-border mb-5 flex flex-wrap gap-2 border-b pb-5">
            {["All", "People", "Organizations", ...ISSUE_CHIPS].map((filter) => (
              <a
                key={filter}
                href={filter === "All" ? "/browse" : browseUrl(filter)}
                className="type-label-small border-border-strong text-ink-soft hover:bg-surface-container border px-3 py-1.5 no-underline transition-colors duration-150"
              >
                {filter}
              </a>
            ))}
            <span className="type-label-small text-ink-soft ml-auto self-center">
              {entries.length} shown
            </span>
          </div>

          {recentEntries.isLoading ? null : entries.length > 0 ? (
            <div className="divide-border divide-y">
              {entries.map((entry) => (
                <RecentEntryRow key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <p className="type-body-medium text-ink-soft py-12 text-center">
              No people listed yet.
            </p>
          )}
        </div>
      </section>

      <section className="px-4 py-16 md:px-8">
        <div className="mx-auto max-w-[88rem]">
          <h2 className="font-serif text-2xl">Browse by issue</h2>
          <div className="bg-border mt-10 grid gap-px overflow-hidden md:grid-cols-4">
            {ISSUE_TILES.map((issue, index) => {
              const featured = index < 2;
              return (
                <a
                  key={issue.label}
                  href={`/browse?query=${encodeURIComponent(issue.label)}&offset=0`}
                  className={
                    featured
                      ? "group bg-ink-strong relative flex min-h-72 flex-col justify-end overflow-hidden p-7 no-underline md:col-span-2"
                      : "group bg-surface-container-lowest hover:bg-surface-container flex min-h-32 flex-col justify-end p-6 no-underline transition-colors duration-150"
                  }
                >
                  {featured && issue.imageUrl ? (
                    <>
                      <img
                        src={issue.imageUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover opacity-45"
                      />
                      <span className="from-ink-strong via-ink-strong/70 absolute inset-0 bg-gradient-to-t to-transparent" />
                    </>
                  ) : null}
                  <span className="relative">
                    <span
                      className={
                        featured
                          ? "type-label-small text-surface/65"
                          : "type-label-small text-ink-soft"
                      }
                    >
                      {issue.count}
                    </span>
                    <span
                      className={
                        featured
                          ? "text-surface mt-3 block font-serif text-3xl"
                          : "text-ink-strong mt-2 block font-medium"
                      }
                    >
                      {issue.label}
                    </span>
                    {issue.description ? (
                      <span className="type-body-small text-surface/75 mt-3 block max-w-xl">
                        {issue.description}
                      </span>
                    ) : null}
                    <span
                      className={
                        featured
                          ? "type-label-small text-surface/65 mt-5 inline-flex items-center gap-2"
                          : "type-label-small text-accent-deep mt-4 inline-flex items-center gap-2"
                      }
                    >
                      Explore
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p className="type-label-small text-ink-soft">Showing 8 of 24 issue areas</p>
            <Link
              to="/browse"
              className="type-label-medium text-accent-deep inline-flex items-center gap-1.5 hover:underline"
            >
              View all issues
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
