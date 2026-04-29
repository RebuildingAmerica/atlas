import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { humanize } from "@/domains/catalog/catalog";
import { cn } from "@/lib/utils";
import { Badge } from "@/platform/ui/badge";
import type { Entry } from "@/types";
import type { ProfileBrowseScope } from "@/domains/catalog/profile-browse";

export function formatLocation(entry: Entry): string {
  if (entry.city && entry.state) {
    return `${entry.city}, ${entry.state}`;
  }
  if (entry.region) {
    return entry.region;
  }
  return entry.state ?? "Location not specified";
}

export function formatFreshness(date?: string): string | null {
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

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) {
    return "A";
  }
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function entryTypeLabel(entry: Entry): string {
  return entry.type === "person"
    ? "Person"
    : entry.type === "organization"
      ? "Organization"
      : humanize(entry.type);
}

export function buildScopeCopy(scope: ProfileBrowseScope): {
  description: string;
  title: string;
} {
  if (scope === "people") {
    return {
      title: "People",
      description:
        "A calm directory for the people Atlas has surfaced across public record, place, and issue.",
    };
  }
  if (scope === "organizations") {
    return {
      title: "Organizations",
      description:
        "A public-facing directory of organizations Atlas has surfaced through local reporting, records, and source-backed research.",
    };
  }
  return {
    title: "Profiles",
    description:
      "Wander through the people and organizations Atlas has surfaced across issue areas, cities, and public record.",
  };
}

export function EntryHeroMedia({
  entry,
  className,
  initialsClassName,
}: {
  entry: Entry;
  className?: string;
  initialsClassName?: string;
}) {
  if (entry.photo_url) {
    return (
      <div className={cn("relative w-full overflow-hidden", className)}>
        <img src={entry.photo_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "from-accent-soft/35 to-surface-container-high relative flex w-full items-center justify-center overflow-hidden bg-gradient-to-br",
        className,
      )}
      aria-hidden
    >
      <span className={cn("text-ink-strong/30 font-semibold", initialsClassName)}>
        {getInitials(entry.name)}
      </span>
    </div>
  );
}

export function ProfileEntryLink({
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

export function ProfileMeta({
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

export function SectionHeading({
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

export function ShelfCard({
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

export function CompanionSpotlight({
  entry,
  issueAreaLabels,
}: {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
}) {
  return (
    <ProfileEntryLink
      entry={entry}
      className="group border-border bg-surface-container-lowest hover:border-border-strong flex h-full flex-col overflow-hidden rounded-[1rem] border transition-colors duration-200"
    >
      <EntryHeroMedia
        entry={entry}
        className="aspect-[16/9]"
        initialsClassName="type-display-small"
      />
      <article className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="type-label-small text-ink-muted tracking-[0.2em] uppercase">
              {entryTypeLabel(entry)}
            </p>
            <h3 className="type-title-medium text-ink-strong truncate leading-tight font-medium">
              {entry.name}
            </h3>
            <p className="type-body-small text-ink-muted">{formatLocation(entry)}</p>
          </div>
          <ArrowUpRight className="text-ink-muted h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
        <p className="type-body-small text-ink-soft line-clamp-2 leading-relaxed">
          {entry.description}
        </p>
        <ProfileMeta entry={entry} issueAreaLabels={issueAreaLabels} />
      </article>
    </ProfileEntryLink>
  );
}
