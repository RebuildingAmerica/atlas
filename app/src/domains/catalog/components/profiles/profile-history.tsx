import { formatStableDateTime, MONTH_YEAR } from "@rebuildingamerica/atlas-ui/format/date-time";
import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  FileClock,
  MessageSquareWarning,
  ShieldCheck,
  SquarePen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entry, Source } from "@rebuildingamerica/atlas-api-client";

interface ProfileHistoryProps {
  entry: Entry;
}

interface HistoryEvent {
  id: string;
  label: string;
  date: string;
  description: string;
  tone: "neutral" | "source" | "verified" | "updated";
}

interface DatedSource {
  source: Source;
  date: string;
}

interface AuditItem {
  id: string;
  label: string;
  description: string;
}

const TONE_CLASS: Record<HistoryEvent["tone"], string> = {
  neutral: "border-border-taupe bg-surface-container-lowest text-ink-soft",
  source: "border-civic/40 bg-surface-container-low text-ink-strong",
  verified: "border-civic/40 bg-surface-container-low text-ink-strong",
  updated: "border-accent/30 bg-surface-container-lowest text-ink-soft",
};

function formatHistoryDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Undated";
  }
  return formatStableDateTime(date, MONTH_YEAR);
}

/**
 * Date a source packet is filed under.
 *
 * A packet always carries `ingested_at`, so there is no such thing as an
 * undated source here — the calendar day it was published wins when the
 * publisher gave one.
 */
function sourceDate(source: Source): string {
  return source.published_date ?? source.ingested_at;
}

function mostRecentSource(sources: Source[]): DatedSource | null {
  const dated = sources.map((source) => ({ source, date: sourceDate(source) }));

  dated.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return dated[0] ?? null;
}

function sourceDescription(source: Source): string {
  return source.publication ?? source.title ?? "Source packet";
}

function buildHistoryEvents(entry: Entry): HistoryEvent[] {
  const events: HistoryEvent[] = [
    {
      id: "first-listed",
      label: "First listed",
      date: entry.first_seen,
      description: "Earliest public record date on this profile.",
      tone: "neutral",
    },
  ];

  const latestSource = mostRecentSource(entry.sources ?? []);
  if (latestSource) {
    events.push({
      id: "latest-source",
      label: "Latest source",
      date: latestSource.date,
      description: sourceDescription(latestSource.source),
      tone: "source",
    });
  }

  const verifiedAt = entry.claim.claim_verified_at ?? entry.last_verified;
  if (entry.claim.status === "verified" && verifiedAt) {
    events.push({
      id: "subject-verified",
      label: "Subject verified",
      date: verifiedAt,
      description: "Representation confirmed by the subject.",
      tone: "verified",
    });
  } else if (entry.trust.level === "atlas_verified" && entry.last_verified) {
    events.push({
      id: "atlas-verified",
      label: "Atlas-verified",
      date: entry.last_verified,
      description: "Profile facts reviewed against public evidence.",
      tone: "verified",
    });
  }

  if (entry.updated_at && entry.updated_at !== entry.created_at) {
    events.push({
      id: "representation-updated",
      label: "Representation updated",
      date: entry.updated_at,
      description: "Profile details changed.",
      tone: "updated",
    });
  }

  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function verificationAuditDescription(entry: Entry): string {
  if (entry.claim.status === "pending") {
    return "Representation verification under review.";
  }
  if (entry.claim.status === "verified") {
    const verifiedAt = entry.claim.claim_verified_at ?? entry.last_verified;
    return verifiedAt
      ? `Representation verified ${formatHistoryDate(verifiedAt)}.`
      : "Representation verified.";
  }
  if (entry.claim.status === "revoked") {
    return "Representation verification no longer active.";
  }
  if (entry.trust.level === "atlas_verified" && entry.last_verified) {
    return `Public evidence reviewed ${formatHistoryDate(entry.last_verified)}.`;
  }
  return "No subject verification recorded.";
}

function representationAuditDescription(entry: Entry): string {
  if (entry.updated_at && entry.updated_at !== entry.created_at) {
    return `Profile details changed ${formatHistoryDate(entry.updated_at)}.`;
  }
  return "No profile detail changes since listing.";
}

function buildAuditItems(entry: Entry): AuditItem[] {
  return [
    {
      id: "correction-review",
      label: "Correction review",
      description: "Source-linked corrections and missing context can be sent for review.",
    },
    {
      id: "verification-review",
      label: "Verification review",
      description: verificationAuditDescription(entry),
    },
    {
      id: "representation-changes",
      label: "Representation changes",
      description: representationAuditDescription(entry),
    },
  ];
}

function HistoryIcon({ tone }: { tone: HistoryEvent["tone"] }) {
  const className = "h-4 w-4";
  if (tone === "source") {
    return <FileClock className={className} aria-hidden />;
  }
  if (tone === "verified") {
    return <ShieldCheck className={className} aria-hidden />;
  }
  if (tone === "updated") {
    return <SquarePen className={className} aria-hidden />;
  }
  return <CalendarClock className={className} aria-hidden />;
}

export function ProfileHistory({ entry }: ProfileHistoryProps) {
  const events = buildHistoryEvents(entry);
  const auditItems = buildAuditItems(entry);
  const hasDatedSource = events.some((event) => event.id === "latest-source");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="type-label-small text-ink-muted tracking-widest uppercase">History</p>
          <h2 className="text-ink-strong text-base font-semibold">Record history</h2>
        </div>
        {hasDatedSource ? null : (
          <p className="type-body-small text-ink-muted">No dated source updates.</p>
        )}
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {events.map((event) => (
          <li key={event.id} className={cn("rounded-lg border px-4 py-3", TONE_CLASS[event.tone])}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0" aria-hidden>
                <HistoryIcon tone={event.tone} />
              </span>
              <div className="min-w-0">
                <p className="type-label-medium text-ink-strong">{event.label}</p>
                <time className="type-body-small text-ink-muted" dateTime={event.date}>
                  {formatHistoryDate(event.date)}
                </time>
                <p className="type-body-small text-ink-soft mt-1">{event.description}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="border-border bg-surface-container-lowest space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="type-label-small text-ink-muted tracking-widest uppercase">Audit</p>
            <h3 className="type-title-medium text-ink-strong">Audit trail</h3>
          </div>
          <Link
            to="/feedback/$slug"
            params={{ slug: entry.slug }}
            className="type-label-medium text-accent hover:underline"
          >
            Send a correction
          </Link>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          {auditItems.map((item) => (
            <div key={item.id} className="border-border rounded-lg border px-3 py-2">
              <dt className="type-label-medium text-ink-strong flex items-center gap-2">
                {item.id === "correction-review" ? (
                  <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden />
                ) : item.id === "verification-review" ? (
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <SquarePen className="h-3.5 w-3.5" aria-hidden />
                )}
                {item.label}
              </dt>
              <dd className="type-body-small text-ink-soft mt-1">{item.description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
