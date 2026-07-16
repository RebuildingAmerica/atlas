import { z } from "zod";

export type PublicFirehoseLiveState = "live" | "reconnecting" | "offline" | "updated-manually";
export type PublicFirehoseReviewState = "not_required" | "pending" | "approved" | "held";
export type PublicFirehoseSignalType =
  "public_meeting" | "coalition_activity" | "grant_award" | "new_source";
export type PublicFirehoseVisibility = "public" | "workspace" | "reviewer";

export interface PublicFirehoseSearchInput {
  issue?: string | string[];
  limit?: number | string;
  place?: string | string[];
  signal_type?: string | string[];
  source_class?: string | string[];
}

export interface PublicFirehoseQuery {
  issue: string[];
  limit: number;
  place: string[];
  signal_type: string[];
  source_class: string[];
}

export interface PublicFirehosePlace {
  label: string;
  slug: string;
}

export interface PublicFirehoseIssue {
  label: string;
  slug: string;
}

export interface PublicFirehoseEvidence {
  captured_at: string;
  content_hash: string;
  passage: string;
  published_at: string | null;
  publisher: string;
  source_class: string;
  source_url: string;
  title: string;
}

export interface PublicFirehoseSignal {
  confidence: number;
  detected_at: string;
  evidence: PublicFirehoseEvidence;
  id: string;
  issues: PublicFirehoseIssue[];
  occurred_at: string | null;
  places: PublicFirehosePlace[];
  public_realm_basis: string;
  review_state: PublicFirehoseReviewState;
  sensitivity: number;
  signal_type: PublicFirehoseSignalType;
  summary: string;
  title: string;
  visibility: PublicFirehoseVisibility;
}

export interface PublicFirehoseSummary {
  latest_detected_at: string | null;
  total_signals: number;
  visible_signals: number;
}

export interface PublicFirehoseSnapshot {
  generated_at: string;
  query: PublicFirehoseQuery;
  signals: PublicFirehoseSignal[];
  summary: PublicFirehoseSummary;
}

export interface PublicFirehoseReadyEvent {
  query: PublicFirehoseQuery;
  type: "firehose.ready";
}

export interface PublicFirehoseSignalEvent {
  signal: PublicFirehoseSignal;
  type: "firehose.signal";
}

export interface PublicFirehoseHeartbeatEvent {
  type: "heartbeat";
}

export type PublicFirehoseEvent =
  PublicFirehoseReadyEvent | PublicFirehoseSignalEvent | PublicFirehoseHeartbeatEvent;

export type PublicFirehoseFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export const publicFirehoseSearchSchema = z.object({
  issue: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().catch(50),
  place: z.string().optional(),
  signal_type: z.string().optional(),
  source_class: z.string().optional(),
});

const DEFAULT_LIMIT = 50;

const PUBLIC_FIREHOSE_FIXTURES: PublicFirehoseSignal[] = [
  {
    confidence: 0.86,
    detected_at: "2026-07-06T22:10:00Z",
    evidence: {
      captured_at: "2026-07-06T22:10:00Z",
      content_hash: "sha256:detroit-night-bus-agenda",
      passage:
        "The board posted a hearing agenda for proposed night bus service changes and public comment.",
      published_at: "2026-07-06T21:58:00Z",
      publisher: "Detroit Transit Board",
      source_class: "government_agenda",
      source_url: "https://detroit.example/agendas/night-bus",
      title: "Night bus hearing agenda",
    },
    id: "fh_public_detroit_hearing_agenda",
    issues: [{ label: "Transit", slug: "transit" }],
    occurred_at: "2026-07-08T00:30:00Z",
    places: [{ label: "Detroit, MI", slug: "detroit-mi" }],
    public_realm_basis: "Published public meeting agenda",
    review_state: "not_required",
    sensitivity: 0.12,
    signal_type: "public_meeting",
    summary:
      "Detroit transit officials posted a public hearing agenda for proposed night bus service changes.",
    title: "Transit board posts night bus hearing agenda",
    visibility: "public",
  },
  {
    confidence: 0.82,
    detected_at: "2026-07-06T21:42:00Z",
    evidence: {
      captured_at: "2026-07-06T21:43:00Z",
      content_hash: "sha256:las-vegas-housing-coalition",
      passage:
        "A coalition of tenant, faith, and neighborhood groups announced a rent-stability forum.",
      published_at: "2026-07-06T21:20:00Z",
      publisher: "Clark County Housing Table",
      source_class: "organization_update",
      source_url: "https://lasvegas.example/updates/rent-forum",
      title: "Rent stability forum announcement",
    },
    id: "fh_public_las_vegas_coalition",
    issues: [{ label: "Housing", slug: "housing" }],
    occurred_at: "2026-07-12T01:00:00Z",
    places: [{ label: "Las Vegas, NV", slug: "las-vegas-nv" }],
    public_realm_basis: "Published organization update",
    review_state: "not_required",
    sensitivity: 0.18,
    signal_type: "coalition_activity",
    summary:
      "A local housing coalition announced a public forum with tenant, faith, and neighborhood groups.",
    title: "Housing coalition announces rent-stability forum",
    visibility: "public",
  },
  {
    confidence: 0.8,
    detected_at: "2026-07-06T20:55:00Z",
    evidence: {
      captured_at: "2026-07-06T20:56:00Z",
      content_hash: "sha256:kansas-city-heat-grant",
      passage:
        "The foundation awarded neighborhood resilience grants for cooling centers and canvassing.",
      published_at: "2026-07-06T20:30:00Z",
      publisher: "Heartland Civic Fund",
      source_class: "grant_notice",
      source_url: "https://kc.example/grants/heat-resilience",
      title: "Heat resilience grant awards",
    },
    id: "fh_public_kansas_city_grant",
    issues: [{ label: "Climate", slug: "climate" }],
    occurred_at: "2026-07-06T20:30:00Z",
    places: [{ label: "Kansas City, MO", slug: "kansas-city-mo" }],
    public_realm_basis: "Published grant notice",
    review_state: "not_required",
    sensitivity: 0.1,
    signal_type: "grant_award",
    summary:
      "A civic fund announced neighborhood grants for cooling centers and heat-safety canvassing.",
    title: "Civic fund awards heat resilience grants",
    visibility: "public",
  },
  {
    confidence: 0.41,
    detected_at: "2026-07-06T20:10:00Z",
    evidence: {
      captured_at: "2026-07-06T20:10:00Z",
      content_hash: "sha256:held-person-signal",
      passage: "A person-centered mention requires review before public routing.",
      published_at: "2026-07-06T19:55:00Z",
      publisher: "Example Source",
      source_class: "news",
      source_url: "https://example.test/held",
      title: "Held update",
    },
    id: "fh_held_person_signal",
    issues: [{ label: "Civic participation", slug: "civic_participation" }],
    occurred_at: null,
    places: [{ label: "Example, US", slug: "example-us" }],
    public_realm_basis: "Review required",
    review_state: "held",
    sensitivity: 0.82,
    signal_type: "new_source",
    summary: "Held signal.",
    title: "Held signal",
    visibility: "reviewer",
  },
];

function splitList(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) =>
    item
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function normalizePublicFirehoseSearch(
  input: PublicFirehoseSearchInput = {},
): PublicFirehoseQuery {
  const parsedLimit =
    typeof input.limit === "string" ? Number.parseInt(input.limit, 10) : input.limit;
  const limit =
    parsedLimit && Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(50, parsedLimit))
      : DEFAULT_LIMIT;
  return {
    issue: splitList(input.issue),
    limit,
    place: splitList(input.place),
    signal_type: splitList(input.signal_type),
    source_class: splitList(input.source_class),
  };
}

function includesEveryFilter(values: string[], filters: string[]): boolean {
  return filters.length === 0 || filters.some((filter) => values.includes(filter));
}

function isPublicSafeSignal(signal: PublicFirehoseSignal): boolean {
  return (
    signal.visibility === "public" &&
    signal.review_state === "not_required" &&
    signal.sensitivity < 0.5
  );
}

function signalMatchesQuery(signal: PublicFirehoseSignal, query: PublicFirehoseQuery): boolean {
  return (
    includesEveryFilter(
      signal.places.map((place) => place.slug),
      query.place,
    ) &&
    includesEveryFilter(
      signal.issues.map((issue) => issue.slug),
      query.issue,
    ) &&
    includesEveryFilter([signal.signal_type], query.signal_type) &&
    includesEveryFilter([signal.evidence.source_class], query.source_class)
  );
}

export function listPublicFirehoseSignals(
  input: PublicFirehoseSearchInput = {},
): PublicFirehoseSnapshot {
  const query = normalizePublicFirehoseSearch(input);
  const signals = PUBLIC_FIREHOSE_FIXTURES.filter(isPublicSafeSignal)
    .filter((signal) => signalMatchesQuery(signal, query))
    .sort((left, right) => right.detected_at.localeCompare(left.detected_at))
    .slice(0, query.limit);

  return {
    generated_at: new Date().toISOString(),
    query,
    signals,
    summary: {
      latest_detected_at: signals[0]?.detected_at ?? null,
      total_signals: signals.length,
      visible_signals: signals.length,
    },
  };
}

export function buildPublicFirehoseSearchParams(query: PublicFirehoseQuery): URLSearchParams {
  const params = new URLSearchParams();
  query.place.forEach((place) => {
    params.append("place", place);
  });
  query.issue.forEach((issue) => {
    params.append("issue", issue);
  });
  query.signal_type.forEach((signalType) => {
    params.append("signal_type", signalType);
  });
  query.source_class.forEach((sourceClass) => {
    params.append("source_class", sourceClass);
  });
  if (query.limit !== DEFAULT_LIMIT) {
    params.set("limit", String(query.limit));
  }
  return params;
}

function publicFirehosePath(query: PublicFirehoseQuery): string {
  const params = buildPublicFirehoseSearchParams(query).toString();
  return params ? `/api/firehose/public?${params}` : "/api/firehose/public";
}

export async function fetchPublicFirehoseSignals(
  input: PublicFirehoseSearchInput = {},
  fetcher?: PublicFirehoseFetcher,
  serverBaseUrl?: string,
): Promise<PublicFirehoseSnapshot> {
  const query = normalizePublicFirehoseSearch(input);
  const path = publicFirehosePath(query);
  const requestUrl =
    typeof window === "undefined" && !fetcher && serverBaseUrl
      ? new URL(path, serverBaseUrl).toString()
      : path;
  const requestFetch = fetcher ?? globalThis.fetch.bind(globalThis);
  const response = await requestFetch(requestUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Public Firehose request failed (${response.status})`);
  }

  return (await response.json()) as PublicFirehoseSnapshot;
}

export function mergePublicFirehoseSignal(
  currentSignals: PublicFirehoseSignal[],
  incomingSignal: PublicFirehoseSignal,
): PublicFirehoseSignal[] {
  if (currentSignals.some((signal) => signal.id === incomingSignal.id)) {
    return currentSignals;
  }
  return [incomingSignal, ...currentSignals].sort((left, right) =>
    right.detected_at.localeCompare(left.detected_at),
  );
}

export function isPublicFirehoseEvent(value: unknown): value is PublicFirehoseEvent {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }
  const event = value;
  return (
    event.type === "firehose.ready" ||
    event.type === "firehose.signal" ||
    event.type === "heartbeat"
  );
}
