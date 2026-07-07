import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestWorkspaceApi, requireActiveWorkspaceId } from "./workspace-api";

export type WorkspaceFirehoseSourceKind = "rss" | "atom" | "web_page";
export type WorkspaceFirehoseSourcePriority = "hot" | "warm";
export type WorkspaceFirehoseSourceSafetyPolicy =
  "standard" | "person_review_required" | "review_all";

export interface WorkspaceFirehoseSourceTargetListInput {
  coverageTargetId?: string;
}

export interface WorkspaceFirehoseSourceTargetInput {
  coverage_target_id: string;
  label: string;
  url: string;
  source_kind: WorkspaceFirehoseSourceKind;
  source_class: string;
  places: string[];
  issues: string[];
  priority?: WorkspaceFirehoseSourcePriority;
  cadence_seconds?: number;
  enabled?: boolean;
  safety_policy?: WorkspaceFirehoseSourceSafetyPolicy;
  public_route_enabled?: boolean;
  origin_note?: string | null;
}

export interface WorkspaceFirehoseSourceTarget {
  id: string;
  org_id: string;
  coverage_target_id: string;
  label: string;
  url: string;
  source_kind: WorkspaceFirehoseSourceKind;
  source_class: string;
  places: string[];
  issues: string[];
  priority: WorkspaceFirehoseSourcePriority;
  cadence_seconds: number;
  enabled: boolean;
  safety_policy: WorkspaceFirehoseSourceSafetyPolicy;
  public_route_enabled: boolean;
  origin: string;
  origin_note: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_http_status: number | null;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceFirehoseSourceTargetCollection {
  items: WorkspaceFirehoseSourceTarget[];
  total: number;
}

export interface WorkspaceFirehoseSourceTargetRunInput {
  sourceTargetId: string;
  body: string;
  content_type?: string | null;
  etag?: string | null;
  fetched_at: string;
  last_modified?: string | null;
  status_code: number;
  url: string;
}

export interface WorkspaceFirehoseSourceTargetRunResult {
  artifacts_created: number;
  routes_created: number;
  signals_created: number;
  unchanged: boolean;
}

const firehoseSourceKindSchema = z.enum(["rss", "atom", "web_page"]);
const firehoseSourcePrioritySchema = z.enum(["hot", "warm"]);
const firehoseSourceSafetyPolicySchema = z.enum([
  "standard",
  "person_review_required",
  "review_all",
]);

const firehoseSourceTargetListInputSchema = z.object({
  coverageTargetId: z.string().min(1).optional(),
});

const firehoseSourceTargetInputSchema = z.object({
  cadence_seconds: z.number().int().min(30).max(86400).optional(),
  coverage_target_id: z.string().min(1),
  enabled: z.boolean().optional(),
  issues: z.array(z.string().min(1)).min(1),
  label: z.string().min(1),
  origin_note: z.string().nullable().optional(),
  places: z.array(z.string().min(1)).min(1),
  priority: firehoseSourcePrioritySchema.optional(),
  public_route_enabled: z.boolean().optional(),
  safety_policy: firehoseSourceSafetyPolicySchema.optional(),
  source_class: z.string().min(1),
  source_kind: firehoseSourceKindSchema,
  url: z.string().min(1),
});

const firehoseSourceTargetRunInputSchema = z.object({
  body: z.string().min(1),
  content_type: z.string().nullable().optional(),
  etag: z.string().nullable().optional(),
  fetched_at: z.string().min(1),
  last_modified: z.string().nullable().optional(),
  sourceTargetId: z.string().min(1),
  status_code: z.number().int().min(100).max(599),
  url: z.string().min(1),
});

type FirehoseSourceTargetListInputData = z.infer<typeof firehoseSourceTargetListInputSchema>;
type FirehoseSourceTargetRunInputData = z.infer<typeof firehoseSourceTargetRunInputSchema>;

function appendOptional(
  params: URLSearchParams,
  key: string,
  value: string | number | null | undefined,
): void {
  if (value !== undefined && value !== null) {
    params.set(key, String(value));
  }
}

function buildFirehoseSourceTargetsPath(input: FirehoseSourceTargetListInputData): string {
  const params = new URLSearchParams();
  appendOptional(params, "coverage_target_id", input.coverageTargetId);
  const query = params.toString();
  return query ? `/firehose/source-targets?${query}` : "/firehose/source-targets";
}

export async function loadWorkspaceFirehoseSourceTargetsData(
  input: WorkspaceFirehoseSourceTargetListInput = {},
): Promise<WorkspaceFirehoseSourceTargetCollection> {
  await requireActiveWorkspaceId("Open a workspace before loading Firehose sources.");
  const data = firehoseSourceTargetListInputSchema.parse(input);
  return await requestWorkspaceApi<WorkspaceFirehoseSourceTargetCollection>(
    buildFirehoseSourceTargetsPath(data),
  );
}

export async function createWorkspaceFirehoseSourceTargetData(
  input: WorkspaceFirehoseSourceTargetInput,
): Promise<WorkspaceFirehoseSourceTarget> {
  await requireActiveWorkspaceId("Open a workspace before creating Firehose sources.");
  const data = firehoseSourceTargetInputSchema.parse(input);
  return await requestWorkspaceApi<WorkspaceFirehoseSourceTarget>("/firehose/source-targets", {
    body: JSON.stringify(data),
    method: "POST",
  });
}

function runSourceTargetBody(
  input: FirehoseSourceTargetRunInputData,
): Omit<FirehoseSourceTargetRunInputData, "sourceTargetId"> {
  return {
    body: input.body,
    content_type: input.content_type,
    etag: input.etag,
    fetched_at: input.fetched_at,
    last_modified: input.last_modified,
    status_code: input.status_code,
    url: input.url,
  };
}

export async function runWorkspaceFirehoseSourceTargetData(
  input: WorkspaceFirehoseSourceTargetRunInput,
): Promise<WorkspaceFirehoseSourceTargetRunResult> {
  await requireActiveWorkspaceId("Open a workspace before running Firehose sources.");
  const data = firehoseSourceTargetRunInputSchema.parse(input);
  return await requestWorkspaceApi<WorkspaceFirehoseSourceTargetRunResult>(
    `/firehose/source-targets/${encodeURIComponent(data.sourceTargetId)}/runs`,
    {
      body: JSON.stringify(runSourceTargetBody(data)),
      method: "POST",
    },
  );
}

export const loadWorkspaceFirehoseSourceTargets = createServerFn({ method: "GET" })
  .validator(firehoseSourceTargetListInputSchema)
  .handler(async ({ data }) => {
    return await loadWorkspaceFirehoseSourceTargetsData(data);
  });

export const createWorkspaceFirehoseSourceTarget = createServerFn({ method: "POST" })
  .validator(firehoseSourceTargetInputSchema)
  .handler(async ({ data }) => {
    return await createWorkspaceFirehoseSourceTargetData(data);
  });

export const runWorkspaceFirehoseSourceTarget = createServerFn({ method: "POST" })
  .validator(firehoseSourceTargetRunInputSchema)
  .handler(async ({ data }) => {
    return await runWorkspaceFirehoseSourceTargetData(data);
  });
