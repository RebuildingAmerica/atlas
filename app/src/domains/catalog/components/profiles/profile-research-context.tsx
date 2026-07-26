import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  Contact,
  FileText,
  Handshake,
  Mail,
  MapPin,
  Network,
  Tags,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { humanize } from "@rebuildingamerica/atlas-catalog/catalog";
import { formatProfileLocation } from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import {
  MONTH_YEAR,
  formatDateTimeOrInput,
  formatStableDateTime,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

interface ProfileResearchContextProps {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
}

interface ContextItem {
  label: string;
  value: string;
  Icon: LucideIcon;
}

interface ResearchRecordItem {
  label: string;
  value: string;
  Icon: LucideIcon;
}

interface PivotLink {
  label: string;
  search: Record<string, string>;
}

function issueFocus(entry: Entry, labels: Record<string, string>): string | null {
  const values = entry.issue_areas.map((slug) => labels[slug] ?? humanize(slug));
  return values.length > 0 ? values.join(" · ") : null;
}

function placeContext(entry: Entry): string {
  return formatProfileLocation(entry);
}

function contactRoute(entry: Entry): string | null {
  const route = entry.email ?? entry.website ?? entry.phone;
  if (!route) {
    return null;
  }

  return route;
}

function summary(entry: Entry): string {
  return entry.custom_bio ?? entry.description;
}

function sourcePacketLabel(count: number): string {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}

function publicContactLabel(entry: Entry): string {
  if (entry.email || entry.website || entry.phone) {
    return "Available";
  }
  return "Not listed";
}

function researchRecordItems(entry: Entry): ResearchRecordItem[] {
  return [
    { label: "Related people and groups", value: "Connections", Icon: Network },
    { label: "Issues", value: `${entry.issue_areas.length} issue areas`, Icon: Tags },
    { label: "Sources", value: sourcePacketLabel(entry.source_count), Icon: FileText },
    { label: "Contact", value: publicContactLabel(entry), Icon: Contact },
  ];
}

function contextItems(entry: Entry, labels: Record<string, string>): ContextItem[] {
  const items: ContextItem[] = [];
  const focus = issueFocus(entry, labels);
  const route = contactRoute(entry);

  if (focus) {
    items.push({ label: "Issues", value: focus, Icon: Tags });
  }

  items.push({ label: "Place", value: placeContext(entry), Icon: MapPin });

  if (route) {
    items.push({ label: "Contact", value: route, Icon: Mail });
  }

  items.push({
    label: "Last seen",
    value: formatDateTimeOrInput(
      formatStableDateTime,
      entry.latest_source_date ?? entry.last_seen,
      MONTH_YEAR,
    ),
    Icon: CalendarClock,
  });

  return items;
}

function placePivot(entry: Entry): PivotLink | null {
  if (entry.city && entry.state) {
    return {
      label: `People and groups in ${entry.city}`,
      search: { cities: entry.city, states: entry.state },
    };
  }
  if (entry.state) {
    return {
      label: `People and groups in ${entry.state}`,
      search: { states: entry.state },
    };
  }
  if (entry.region) {
    return {
      label: `People and groups in ${entry.region}`,
      search: { regions: entry.region },
    };
  }
  return null;
}

function pivotLinks(entry: Entry, labels: Record<string, string>): PivotLink[] {
  const links: PivotLink[] = [];
  const place = placePivot(entry);
  if (place) {
    links.push(place);
  }
  const primaryIssue = entry.issue_areas[0];
  if (primaryIssue) {
    links.push({
      label: `${labels[primaryIssue] ?? humanize(primaryIssue)} actors`,
      search: { issue_areas: primaryIssue },
    });
  }
  return links;
}

export function ProfileResearchContext({ entry, issueAreaLabels }: ProfileResearchContextProps) {
  const items = contextItems(entry, issueAreaLabels);
  const recordItems = researchRecordItems(entry);
  const pivots = pivotLinks(entry, issueAreaLabels);

  return (
    <section
      aria-labelledby="profile-context-heading"
      className="border-border-taupe bg-paper-faded border-t px-6 py-6 sm:px-8"
    >
      <section
        aria-label="Profile summary"
        className="border-ink-strong/80 border-l-[3px] py-1 pl-5"
      >
        <div className="flex items-center gap-2">
          <Handshake
            data-testid="research-context-icon"
            className="text-civic h-4 w-4"
            aria-hidden
          />
          <h2
            id="profile-context-heading"
            className="type-label-small text-ink-muted tracking-widest uppercase"
          >
            Why this matters
          </h2>
        </div>
        <p className="type-title-large text-ink-strong mt-3 max-w-3xl leading-snug">
          {summary(entry)}
        </p>
      </section>

      <div role="group" aria-label="Quick facts" className="mt-6">
        <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.label} className="grid grid-cols-[1.75rem_1fr] gap-3">
              <item.Icon
                data-testid="research-context-icon"
                className="text-civic mt-0.5 h-4 w-4"
                aria-hidden
              />
              <div className="border-border border-b pb-3">
                <dt className="type-label-small text-ink-muted">{item.label}</dt>
                <dd className="type-title-small text-ink-strong mt-1 font-medium">{item.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>

      <div className="border-border mt-6 border-t pt-5">
        <div role="group" aria-labelledby="profile-context-evidence-heading">
          <h3
            id="profile-context-evidence-heading"
            className="type-label-small text-ink-muted tracking-widest uppercase"
          >
            Evidence
          </h3>
          <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-4">
            {recordItems.map((item) => (
              <div key={item.label} className="grid grid-cols-[1.5rem_1fr] gap-2">
                <item.Icon
                  data-testid="research-context-icon"
                  className="text-civic h-4 w-4"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="type-label-small text-ink-muted">{item.label}</p>
                  <p className="type-title-small text-ink-strong mt-1 font-medium">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
          {pivots.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {pivots.map((pivot) => (
                <Link
                  key={pivot.label}
                  to="/browse"
                  search={pivot.search}
                  className="type-label-medium border-border hover:border-civic hover:text-civic text-ink-soft rounded-full border px-3 py-1.5 transition-colors"
                >
                  {pivot.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <div
          role="group"
          aria-labelledby="profile-context-corrections-heading"
          className="border-border mt-5 border-t pt-5"
        >
          <h3
            id="profile-context-corrections-heading"
            className="type-label-small text-ink-muted tracking-widest uppercase"
          >
            Corrections
          </h3>
          <p className="type-body-small text-ink-soft mt-2 max-w-2xl">
            Flag stale facts, missing context, or representation issues for review.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/feedback/$slug"
              params={{ slug: entry.slug }}
              search={{ kind: "missing_context" }}
              className="type-label-medium border-border hover:border-civic hover:text-civic text-ink-soft rounded-full border px-3 py-1.5 transition-colors"
            >
              Add missing context
            </Link>
            <Link
              to="/claim/$slug"
              params={{ slug: entry.slug }}
              className="type-label-medium border-border hover:border-civic hover:text-civic text-ink-soft rounded-full border px-3 py-1.5 transition-colors"
            >
              Verify representation
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
