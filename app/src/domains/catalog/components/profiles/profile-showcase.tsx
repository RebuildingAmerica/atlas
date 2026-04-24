import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Building2, Sparkles, UserRound } from "lucide-react";
import { humanize } from "@/domains/catalog/catalog";
import { Badge } from "@/platform/ui/badge";
import type { Entry } from "@/types";
import type { ProfileBrowseScope } from "@/domains/catalog/profile-browse";

function formatLocation(entry: Entry): string {
  if (entry.city && entry.state) {
    return `${entry.city}, ${entry.state}`;
  }

  if (entry.region) {
    return entry.region;
  }

  return entry.state ?? "Location not specified";
}

function formatFreshness(date?: string): string | null {
  if (!date) {
    return null;
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (parts.length === 0) {
    return "A";
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function entryTypeLabel(entry: Entry): string {
  return entry.type === "person"
    ? "Person"
    : entry.type === "organization"
      ? "Organization"
      : humanize(entry.type);
}

function buildScopeCopy(scope: ProfileBrowseScope): {
  description: string;
  eyebrow: string;
  title: string;
} {
  if (scope === "people") {
    return {
      eyebrow: "Atlas directory",
      title: "People",
      description:
        "A calm directory for the people Atlas has surfaced across public record, place, and issue.",
    };
  }

  if (scope === "organizations") {
    return {
      eyebrow: "Atlas directory",
      title: "Organizations",
      description:
        "A public-facing directory of organizations Atlas has surfaced through local reporting, records, and source-backed research.",
    };
  }

  return {
    eyebrow: "Atlas directory",
    title: "Profiles",
    description:
      "Wander through the people and organizations Atlas has surfaced across issue areas, cities, and public record.",
  };
}

function ProfileEntryLink({
  children,
  className,
  entry,
}: {
  children: ReactNode;
  className?: string;
  entry: Entry;
}) {
  if (entry.slug && entry.type === "person") {
    return (
      <Link
        to="/profiles/people/$slug"
        params={{ slug: entry.slug }}
        viewTransition
        className={className}
      >
        {children}
      </Link>
    );
  }

  if (entry.slug && entry.type === "organization") {
    return (
      <Link
        to="/profiles/organizations/$slug"
        params={{ slug: entry.slug }}
        viewTransition
        className={className}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      to="/entries/$entryId"
      params={{ entryId: entry.id }}
      viewTransition
      className={className}
    >
      {children}
    </Link>
  );
}

function ProfileMeta({
  entry,
  issueAreaLabels,
  maxIssues = 2,
}: {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
  maxIssues?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="info">{entryTypeLabel(entry)}</Badge>
      {entry.verified ? <Badge variant="success">Verified</Badge> : null}
      {entry.issue_areas.slice(0, maxIssues).map((issueArea) => (
        <Badge key={issueArea} variant="warning">
          {issueAreaLabels[issueArea] ?? humanize(issueArea)}
        </Badge>
      ))}
    </div>
  );
}

function ShelfCard({
  entry,
  issueAreaLabels,
}: {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
}) {
  const freshness = formatFreshness(entry.latest_source_date);

  return (
    <ProfileEntryLink
      entry={entry}
      className="group bg-surface-container-lowest hover:bg-surface-container-low block h-full w-[18.5rem] shrink-0 rounded-[1rem] p-5 transition-colors duration-200"
    >
      <article className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="bg-accent-soft text-accent-ink flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold">
            {getInitials(entry.name)}
          </div>
          <ArrowUpRight className="text-ink-muted h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>

        <div className="space-y-2">
          <h3 className="type-title-medium text-ink-strong leading-tight">{entry.name}</h3>
          <p className="type-body-medium text-ink-muted">{formatLocation(entry)}</p>
        </div>

        <p className="type-body-medium text-ink-soft flex-1">{entry.description}</p>

        <ProfileMeta entry={entry} issueAreaLabels={issueAreaLabels} />

        <div className="type-body-medium text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{entry.source_count} sources</span>
          {freshness ? <span>Updated {freshness}</span> : null}
        </div>
      </article>
    </ProfileEntryLink>
  );
}

function CompanionSpotlight({
  entry,
  issueAreaLabels,
}: {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
}) {
  return (
    <ProfileEntryLink
      entry={entry}
      className="group bg-surface-container-low hover:bg-surface-container block rounded-[1rem] p-5 transition-colors duration-200"
    >
      <article className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="bg-surface-container text-ink-strong flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold">
            {getInitials(entry.name)}
          </div>
          <ArrowUpRight className="text-ink-muted h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>

        <div className="space-y-2">
          <p className="type-label-medium text-ink-muted tracking-[0.2em] uppercase">
            {entryTypeLabel(entry)}
          </p>
          <h3 className="type-title-large text-ink-strong leading-tight">{entry.name}</h3>
          <p className="type-body-medium text-ink-muted">{formatLocation(entry)}</p>
        </div>

        <p className="type-body-medium text-ink-soft">{entry.description}</p>
        <ProfileMeta entry={entry} issueAreaLabels={issueAreaLabels} />
      </article>
    </ProfileEntryLink>
  );
}

function SpotlightCard({
  entry,
  issueAreaLabels,
}: {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
}) {
  const freshness = formatFreshness(entry.latest_source_date);

  return (
    <ProfileEntryLink
      entry={entry}
      className="group bg-surface-container hover:bg-surface-container-high block h-full rounded-[1.25rem] px-6 py-6 transition-colors duration-200 lg:px-8 lg:py-8"
    >
      <article className="flex h-full flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-surface-container-high text-ink-strong">Featured</Badge>
        </div>

        <div className="space-y-4">
          <div className="bg-accent-soft text-accent-ink flex h-14 w-14 items-center justify-center rounded-[1.35rem] text-lg font-semibold">
            {getInitials(entry.name)}
          </div>

          <div className="space-y-3">
            <p className="type-label-medium text-ink-muted tracking-[0.2em] uppercase">
              {entryTypeLabel(entry)}
            </p>
            <h2 className="type-display-small text-ink-strong max-w-2xl leading-tight">
              {entry.name}
            </h2>
            <p className="type-body-large text-ink-soft max-w-2xl">{entry.description}</p>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-3">
          <span className="type-body-medium text-ink-strong">{formatLocation(entry)}</span>
          <span className="type-body-medium text-ink-strong">{entry.source_count} sources</span>
          {freshness ? (
            <span className="type-body-medium text-ink-strong">Updated {freshness}</span>
          ) : null}
        </div>

        <ProfileMeta entry={entry} issueAreaLabels={issueAreaLabels} maxIssues={3} />
      </article>
    </ProfileEntryLink>
  );
}

function SectionHeading({
  icon,
  subtitle,
  title,
}: {
  icon?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <header className="space-y-2">
      <div className="type-label-medium text-ink-muted flex items-center gap-2 tracking-[0.22em] uppercase">
        {icon}
        <span>{subtitle ?? "Atlas profiles"}</span>
      </div>
      <h2 className="type-display-small text-ink-strong leading-tight">{title}</h2>
    </header>
  );
}

export function ProfilesShowcaseHeader({ scope }: { scope: ProfileBrowseScope }) {
  const copy = buildScopeCopy(scope);

  return (
    <section className="bg-surface-container-low pt-6 pb-8 lg:pt-8 lg:pb-10">
      <div className="max-w-[56rem] space-y-6">
        <div className="space-y-3">
          <p className="type-label-medium text-ink-muted tracking-[0.22em] uppercase">
            {copy.eyebrow}
          </p>
          <h1 className="type-display-large text-ink-strong leading-[0.95]">{copy.title}</h1>
          <p className="type-body-large text-ink-soft max-w-3xl">{copy.description}</p>
        </div>
      </div>
    </section>
  );
}

export function ProfilesMarquee({
  entries,
  error = null,
  isLoading = false,
  issueAreaLabels,
}: {
  entries: Entry[];
  error?: Error | null;
  isLoading?: boolean;
  issueAreaLabels: Record<string, string>;
}) {
  if (error) {
    return (
      <section className="space-y-4">
        <SectionHeading
          icon={<Sparkles className="h-4 w-4" />}
          subtitle="Spotlight"
          title="Featured profiles"
        />
        <p className="type-body-medium text-red-800">{error.message}</p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="space-y-6">
        <SectionHeading
          icon={<Sparkles className="h-4 w-4" />}
          subtitle="Spotlight"
          title="Featured profiles"
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)]">
          <div className="bg-surface-container h-[30rem] animate-pulse rounded-[1.25rem]" />
          <div className="grid gap-4">
            <div className="bg-surface-container-low h-[14.5rem] animate-pulse rounded-[1rem]" />
            <div className="bg-surface-container-low h-[14.5rem] animate-pulse rounded-[1rem]" />
          </div>
        </div>
      </section>
    );
  }

  if (entries.length === 0) {
    return null;
  }

  const primary = entries[0];
  const companions = entries.slice(1, 3);

  return (
    <section className="space-y-6">
      <SectionHeading
        icon={<Sparkles className="h-4 w-4" />}
        subtitle="Spotlight"
        title="Profiles worth opening"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)]">
        {primary ? <SpotlightCard entry={primary} issueAreaLabels={issueAreaLabels} /> : null}

        <div className="grid gap-4">
          {companions.map((entry) => (
            <CompanionSpotlight key={entry.id} entry={entry} issueAreaLabels={issueAreaLabels} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProfilesShelf({
  entries,
  error = null,
  icon,
  isLoading = false,
  issueAreaLabels,
  subtitle,
  title,
}: {
  entries: Entry[];
  error?: Error | null;
  icon?: ReactNode;
  isLoading?: boolean;
  issueAreaLabels: Record<string, string>;
  subtitle?: string;
  title: string;
}) {
  if (error) {
    return (
      <section className="space-y-4 pt-7">
        <SectionHeading icon={icon} subtitle={subtitle} title={title} />
        <p className="type-body-medium text-red-800">{error.message}</p>
      </section>
    );
  }

  if (!isLoading && entries.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5 pt-7">
      <SectionHeading icon={icon} subtitle={subtitle} title={title} />

      <div className="flex gap-4 overflow-x-auto pb-3">
        {isLoading
          ? Array.from({ length: 4 }, (_, index) => (
              <div
                key={`${title}-skeleton-${index}`}
                className="bg-surface-container-lowest h-[22rem] w-[18.5rem] shrink-0 animate-pulse rounded-[1rem]"
              />
            ))
          : entries.map((entry) => (
              <ShelfCard key={entry.id} entry={entry} issueAreaLabels={issueAreaLabels} />
            ))}
      </div>
    </section>
  );
}

export interface IssueLandscapeGroup {
  entries: Entry[];
  error?: Error | null;
  issueArea: string;
  title: string;
}

function IssueClusterColumn({
  entries,
  error,
  title,
}: {
  entries: Entry[];
  error?: Error | null;
  title: string;
}) {
  if (error) {
    return (
      <div className="space-y-3">
        <h3 className="type-title-large text-ink-strong">{title}</h3>
        <p className="type-body-medium text-red-800">{error.message}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="type-title-large text-ink-strong">{title}</h3>
      <div className="divide-outline-variant bg-surface-container-lowest divide-y rounded-[1rem] px-5">
        {entries.slice(0, 4).map((entry) => (
          <ProfileEntryLink
            key={entry.id}
            entry={entry}
            className="group hover:text-accent flex items-center justify-between gap-4 py-4 transition-colors"
          >
            <div className="min-w-0 space-y-1">
              <p className="type-title-small text-ink-strong truncate">{entry.name}</p>
              <p className="type-body-medium text-ink-muted truncate">{formatLocation(entry)}</p>
            </div>
            <div className="type-body-medium text-ink-muted shrink-0 text-right">
              <p>{entryTypeLabel(entry)}</p>
              <p>{entry.source_count} sources</p>
            </div>
          </ProfileEntryLink>
        ))}
      </div>
    </div>
  );
}

export function ProfilesIssueLandscape({
  groups,
  isLoading = false,
}: {
  groups: IssueLandscapeGroup[];
  isLoading?: boolean;
}) {
  const visibleGroups = groups.filter((group) => group.entries.length > 0 || group.error);

  if (!isLoading && visibleGroups.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5 pt-7">
      <SectionHeading
        icon={<Building2 className="h-4 w-4" />}
        subtitle="Issue landscapes"
        title="Where the work is clustering"
      />

      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={`issue-skeleton-${index}`} className="space-y-4">
              <div className="bg-surface-container-low h-8 w-48 animate-pulse rounded-full" />
              <div className="bg-surface-container-lowest h-56 animate-pulse rounded-[1rem]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          {visibleGroups.map((group) => (
            <IssueClusterColumn
              key={group.issueArea}
              entries={group.entries}
              error={group.error}
              title={group.title}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ProfilesFreshList({
  entries,
  error = null,
  isLoading = false,
}: {
  entries: Entry[];
  error?: Error | null;
  isLoading?: boolean;
}) {
  if (error) {
    return (
      <section className="space-y-4 pt-7">
        <SectionHeading title="New in Atlas" subtitle="Recent arrivals" />
        <p className="type-body-medium text-red-800">{error.message}</p>
      </section>
    );
  }

  if (!isLoading && entries.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5 pt-7">
      <SectionHeading title="New in Atlas" subtitle="Recent arrivals" />

      <div className="divide-surface-container-high divide-y">
        {isLoading
          ? Array.from({ length: 5 }, (_, index) => (
              <div key={`fresh-skeleton-${index}`} className="py-4">
                <div className="bg-surface-container-lowest h-14 animate-pulse rounded-[0.75rem]" />
              </div>
            ))
          : entries.map((entry) => (
              <ProfileEntryLink
                key={entry.id}
                entry={entry}
                className="group hover:text-accent flex flex-col gap-3 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="type-title-medium text-ink-strong truncate">{entry.name}</p>
                  <p className="type-body-medium text-ink-muted truncate">
                    {entryTypeLabel(entry)} · {formatLocation(entry)}
                  </p>
                </div>
                <div className="type-body-medium text-ink-muted flex shrink-0 items-center gap-3">
                  <span>{entry.source_count} sources</span>
                  {formatFreshness(entry.latest_source_date) ? (
                    <span>{formatFreshness(entry.latest_source_date)}</span>
                  ) : null}
                  <ArrowUpRight className="h-4 w-4" />
                </div>
              </ProfileEntryLink>
            ))}
      </div>
    </section>
  );
}

export function ProfilesEmptyState({ scope }: { scope: ProfileBrowseScope }) {
  const title =
    scope === "people"
      ? "Atlas is still gathering people for this directory."
      : scope === "organizations"
        ? "Atlas is still gathering organizations for this directory."
        : "Atlas is still gathering profiles for this directory.";

  return (
    <section className="bg-surface-container rounded-[1.25rem] px-6 py-8 lg:px-8 lg:py-10">
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="type-label-medium text-ink-muted tracking-[0.22em] uppercase">
            Catalog warming up
          </p>
          <h2 className="type-display-small text-ink-strong leading-tight">{title}</h2>
          <p className="type-body-large text-ink-soft max-w-2xl">
            The directory will fill in as Atlas finds more source-backed profiles. Until then, the
            layout stays intact without pretending there is already a catalog to browse.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
          <div className="bg-surface-container-lowest h-56 rounded-[1rem]" />
          <div className="bg-surface-container-low h-56 rounded-[1rem]" />
          <div className="bg-surface-container-low h-56 rounded-[1rem]" />
        </div>
      </div>
    </section>
  );
}

export const PROFILE_SHOWCASE_ICONS = {
  organizations: <Building2 className="h-4 w-4" />,
  people: <UserRound className="h-4 w-4" />,
  spotlight: <Sparkles className="h-4 w-4" />,
};
