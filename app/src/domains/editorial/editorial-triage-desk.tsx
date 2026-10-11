import {
  AdminInlineStatus,
  AdminStatusBadge,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import type { EditorialTriage, TriageQueue } from "./editorial-triage.functions";

export interface EditorialTriageDeskProps {
  errorMessage?: string;
  /** The current time in milliseconds, so how long something waited is stable in one render. */
  now: number;
  triage?: EditorialTriage;
}

interface DeskQueue {
  detail: string;
  href: string;
  label: string;
  queue?: TriageQueue;
}

interface QueueCardProps {
  desk: DeskQueue;
  now: number;
}

const MINUTE_MS = 60_000;
/** Sorts after every real arrival time, and equal to itself so ties stay put. */
const UNDATED = Number.MAX_SAFE_INTEGER;

/**
 * What needs the operator now: each review queue with how much is waiting
 * and how long its oldest item has waited, longest wait first.
 */
export function EditorialTriageDesk({ errorMessage, now, triage }: EditorialTriageDeskProps) {
  const queues: DeskQueue[] = [
    {
      detail: "Private profile and source reports from visitors.",
      href: "/editorial/corrections",
      label: "Review visitor corrections",
      queue: triage?.corrections,
    },
    {
      detail: "Proposed public facts to check against their sources.",
      href: "/editorial/discovery-reviews",
      label: "Review discovered profiles",
      queue: triage?.discoveryReviews,
    },
    {
      detail: "People asking to represent a profile.",
      href: "/editorial/profile-claims",
      label: "Review profile verifications",
      queue: triage?.claims,
    },
  ];
  const waitingTotal = queues.reduce((sum, desk) => sum + (desk.queue?.waiting ?? 0), 0);

  return (
    <section aria-label="Needs you" className="space-y-3">
      <div className="flex flex-col gap-1">
        <h2 className="type-title-large text-ink-strong">Needs you</h2>
        <p className="type-body-small text-ink-soft">
          {triage
            ? waitingTotal === 0
              ? "Nothing is waiting for review."
              : `${waitingTotal} waiting for review, longest wait first.`
            : "Review queues, longest wait first."}
        </p>
      </div>
      <AdminInlineStatus message={errorMessage} />
      <div className="grid gap-4 lg:grid-cols-3">
        {queues.sort(longestWaitFirst).map((desk) => (
          <QueueCard key={desk.href} desk={desk} now={now} />
        ))}
      </div>
    </section>
  );
}

function QueueCard({ desk, now }: QueueCardProps) {
  const { queue } = desk;
  return (
    <a
      href={desk.href}
      aria-label={desk.label}
      className="border-border bg-surface-container-lowest hover:bg-surface-container-low block rounded-lg border p-5 no-underline transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="type-title-small text-ink-strong">{desk.label}</h3>
        {queue ? (
          <AdminStatusBadge tone={queue.waiting > 0 ? "warn" : "pass"}>
            {queue.waiting > 0 ? `${queue.waiting} waiting` : "Clear"}
          </AdminStatusBadge>
        ) : null}
      </div>
      <p className="type-body-small text-ink-soft mt-2">{desk.detail}</p>
      {queue && queue.waiting > 0 && queue.oldestAt ? (
        <p className="type-label-medium text-ink-strong mt-2">{waitedFor(queue.oldestAt, now)}</p>
      ) : null}
    </a>
  );
}

/** Says how long the oldest item has waited, or when it arrived if its time cannot be read. */
function waitedFor(since: string, now: number): string {
  const arrived = Date.parse(since);
  if (Number.isNaN(arrived)) return `Waiting since ${since}`;
  const minutes = Math.max(0, Math.floor((now - arrived) / MINUTE_MS));
  if (minutes < 60) return "Oldest waiting under an hour";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Oldest waiting ${plural(hours, "hour")}`;
  return `Oldest waiting ${plural(Math.floor(hours / 24), "day")}`;
}

function plural(count: number, unit: string): string {
  return count === 1 ? `1 ${unit}` : `${count} ${unit}s`;
}

/** Orders queues by when their oldest item arrived; a queue with nothing dated goes last. */
function longestWaitFirst(left: DeskQueue, right: DeskQueue): number {
  return arrivedAt(left) - arrivedAt(right);
}

function arrivedAt(desk: DeskQueue): number {
  const { queue } = desk;
  if (!queue || queue.waiting === 0 || !queue.oldestAt) return UNDATED;
  const arrived = Date.parse(queue.oldestAt);
  return Number.isNaN(arrived) ? UNDATED : arrived;
}
