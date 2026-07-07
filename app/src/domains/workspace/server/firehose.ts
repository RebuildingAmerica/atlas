import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestWorkspaceApi, requireActiveWorkspaceId } from "./workspace-api";
export {
  createWorkspaceFirehoseSourceTarget,
  createWorkspaceFirehoseSourceTargetData,
  loadWorkspaceFirehoseSourceTargets,
  loadWorkspaceFirehoseSourceTargetsData,
  runWorkspaceFirehoseSourceTarget,
  runWorkspaceFirehoseSourceTargetData,
} from "./firehose-source-targets";
export type {
  WorkspaceFirehoseSourceKind,
  WorkspaceFirehoseSourcePriority,
  WorkspaceFirehoseSourceSafetyPolicy,
  WorkspaceFirehoseSourceTarget,
  WorkspaceFirehoseSourceTargetCollection,
  WorkspaceFirehoseSourceTargetInput,
  WorkspaceFirehoseSourceTargetListInput,
  WorkspaceFirehoseSourceTargetRunInput,
  WorkspaceFirehoseSourceTargetRunResult,
} from "./firehose-source-targets";

export type WorkspaceFirehoseActorType =
  "person" | "organization" | "initiative" | "campaign" | "event";
export type WorkspaceFirehoseDeliveryMode = "sse" | "websocket";
export type WorkspaceFirehoseReviewState =
  "not_required" | "pending" | "approved" | "held" | "rejected";
export type WorkspaceFirehoseSignalType =
  | "public_meeting"
  | "public_comment"
  | "vote"
  | "filing"
  | "grant_award"
  | "coalition_activity"
  | "new_source"
  | "role_change"
  | "freshness_change";
export type WorkspaceFirehoseSort = "detected_at_desc" | "occurred_at_desc" | "relevance_desc";
export type WorkspaceFirehoseVisibility = "workspace" | "partner" | "public" | "reviewer";

export interface WorkspaceFirehoseQueryInput {
  places?: string[];
  issues?: string[];
  actorTypes?: WorkspaceFirehoseActorType[];
  signalTypes?: WorkspaceFirehoseSignalType[];
  sourceClasses?: string[];
  visibility?: WorkspaceFirehoseVisibility;
  since?: string | null;
  until?: string | null;
  cursor?: string | null;
  limit?: number;
  sort?: WorkspaceFirehoseSort;
}

export interface WorkspaceFirehoseQuery {
  places: string[];
  issues: string[];
  actor_types: WorkspaceFirehoseActorType[];
  signal_types: WorkspaceFirehoseSignalType[];
  source_classes: string[];
  visibility: WorkspaceFirehoseVisibility;
  since: string | null;
  until: string | null;
  cursor: string | null;
  limit: number;
  sort: WorkspaceFirehoseSort;
}

export interface WorkspaceFirehoseWorkspaceContext {
  org_id: string;
  actor_id: string;
  auth_type: string;
  api_key_id: string | null;
}

export interface WorkspaceFirehoseUsageContext {
  meter: "firehose_snapshot" | "firehose_session" | "firehose_stream" | "firehose_socket";
  query_fingerprint: string;
}

export interface WorkspaceFirehoseSummary {
  total_signals: number;
  visible_signals: number;
  held_signals: number;
  latest_cursor: string | null;
}

export interface WorkspaceFirehoseLinks {
  self: string;
  next: string | null;
  events: string | null;
}

export interface WorkspaceFirehoseEvidence {
  source_url: string;
  title: string | null;
  publisher: string | null;
  published_at: string | null;
  captured_at: string;
  passage: string;
  locator: string | null;
  content_hash: string;
}

export interface WorkspaceFirehoseActorRef {
  id: string | null;
  name: string;
  type: WorkspaceFirehoseActorType;
  role: string;
}

export interface WorkspaceFirehoseDestination {
  type: "workspace" | "profile" | "place" | "issue" | "partner" | "public" | "review";
  id: string | null;
  state: "active" | "held" | "suppressed";
}

export interface WorkspaceFirehoseSignal {
  id: string;
  type: WorkspaceFirehoseSignalType;
  title: string;
  summary: string;
  occurred_at: string | null;
  detected_at: string;
  public_realm_basis: string;
  places: string[];
  issues: string[];
  actors: WorkspaceFirehoseActorRef[];
  confidence: number;
  sensitivity: number;
  review_state: WorkspaceFirehoseReviewState;
  visibility: WorkspaceFirehoseVisibility;
  evidence: WorkspaceFirehoseEvidence[];
  destinations: WorkspaceFirehoseDestination[];
}

export interface WorkspaceFirehoseSession {
  id: string;
  state: "active" | "expired";
  query: WorkspaceFirehoseQuery;
  workspace: WorkspaceFirehoseWorkspaceContext;
  usage: WorkspaceFirehoseUsageContext;
  created_at: string;
  expires_at: string;
  snapshot_url: string;
  events_url: string;
  socket_url: string;
}

export interface WorkspaceFirehoseSnapshot {
  query: WorkspaceFirehoseQuery;
  workspace: WorkspaceFirehoseWorkspaceContext;
  usage: WorkspaceFirehoseUsageContext;
  generated_at: string;
  cursor: string | null;
  summary: WorkspaceFirehoseSummary;
  signals: WorkspaceFirehoseSignal[];
  links: WorkspaceFirehoseLinks;
  session: WorkspaceFirehoseSession | null;
}

const firehoseActorTypeSchema = z.enum([
  "person",
  "organization",
  "initiative",
  "campaign",
  "event",
]);
const firehoseSignalTypeSchema = z.enum([
  "public_meeting",
  "public_comment",
  "vote",
  "filing",
  "grant_award",
  "coalition_activity",
  "new_source",
  "role_change",
  "freshness_change",
]);
const firehoseVisibilitySchema = z.enum(["workspace", "partner", "public", "reviewer"]);
const firehoseSortSchema = z.enum(["detected_at_desc", "occurred_at_desc", "relevance_desc"]);

const firehoseQueryInputSchema = z.object({
  actorTypes: z.array(firehoseActorTypeSchema).default([]),
  cursor: z.string().min(1).nullable().optional(),
  issues: z.array(z.string().min(1)).default([]),
  limit: z.number().int().min(1).max(200).optional(),
  places: z.array(z.string().min(1)).default([]),
  signalTypes: z.array(firehoseSignalTypeSchema).default([]),
  since: z.string().min(1).nullable().optional(),
  sort: firehoseSortSchema.optional(),
  sourceClasses: z.array(z.string().min(1)).default([]),
  until: z.string().min(1).nullable().optional(),
  visibility: firehoseVisibilitySchema.optional(),
});

type FirehoseQueryInputData = z.infer<typeof firehoseQueryInputSchema>;

function appendValues(params: URLSearchParams, key: string, values: string[]): void {
  for (const value of values) {
    params.append(key, value);
  }
}

function appendOptional(
  params: URLSearchParams,
  key: string,
  value: string | number | null | undefined,
): void {
  if (value !== undefined && value !== null) {
    params.set(key, String(value));
  }
}

function buildFirehosePath(input: FirehoseQueryInputData): string {
  const params = new URLSearchParams();
  appendValues(params, "place", input.places);
  appendValues(params, "issue", input.issues);
  appendValues(params, "actor_type", input.actorTypes);
  appendValues(params, "signal_type", input.signalTypes);
  appendValues(params, "source_class", input.sourceClasses);
  appendOptional(params, "visibility", input.visibility);
  appendOptional(params, "since", input.since);
  appendOptional(params, "until", input.until);
  appendOptional(params, "cursor", input.cursor);
  appendOptional(params, "limit", input.limit);
  appendOptional(params, "sort", input.sort);

  const query = params.toString();
  return query ? `/firehose?${query}` : "/firehose";
}

/**
 * Loads a source-backed Firehose snapshot for the active workspace.
 *
 * @param input - Query filters applied to the Firehose view.
 * @returns Empty or populated Firehose snapshot for the active workspace.
 */
export async function loadWorkspaceFirehoseSnapshotData(
  input: WorkspaceFirehoseQueryInput = {},
): Promise<WorkspaceFirehoseSnapshot> {
  await requireActiveWorkspaceId("Open a workspace before loading Firehose.");
  const data = firehoseQueryInputSchema.parse(input);
  return await requestWorkspaceApi<WorkspaceFirehoseSnapshot>(buildFirehosePath(data), {
    headers: {
      Accept: "application/json",
    },
  });
}

/**
 * Builds the browser-visible SSE URL for an active-workspace Firehose query.
 *
 * @param input - Query filters applied to the Firehose event stream.
 * @returns Relative URL for observing the Firehose stream.
 */
export async function buildWorkspaceFirehoseEventsUrlData(
  input: WorkspaceFirehoseQueryInput = {},
): Promise<string> {
  await requireActiveWorkspaceId("Open a workspace before loading Firehose.");
  const data = firehoseQueryInputSchema.parse(input);
  return `/api${buildFirehosePath(data)}`;
}

export const loadWorkspaceFirehoseSnapshot = createServerFn({ method: "GET" })
  .validator(firehoseQueryInputSchema)
  .handler(async ({ data }) => {
    return await loadWorkspaceFirehoseSnapshotData(data);
  });

export const buildWorkspaceFirehoseEventsUrl = createServerFn({ method: "GET" })
  .validator(firehoseQueryInputSchema)
  .handler(async ({ data }) => {
    return await buildWorkspaceFirehoseEventsUrlData(data);
  });
