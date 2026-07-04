import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  CoverageTargetDetailResponse,
  EntityDetailResponse,
  OrgWatchCollectionResponse,
  OrgWatchRequestNotificationPreference,
  OrgWatchResponse,
  OrgWatchResponseResourceType,
  OrgWatchStatusResponse,
} from "@/lib/generated/atlas";

export type WorkspaceWatchResourceType = OrgWatchResponseResourceType;
export type WorkspaceWatchNotificationPreference = OrgWatchRequestNotificationPreference;
export type WorkspaceWatch = OrgWatchResponse;
export type WorkspaceWatchBaseCollection = OrgWatchCollectionResponse;
export type WorkspaceWatchStatus = OrgWatchStatusResponse;

export interface WorkspaceWatchInput {
  notificationPreference?: WorkspaceWatchNotificationPreference;
  resourceId: string;
  resourceType: WorkspaceWatchResourceType;
}

export interface WorkspaceWatchListItem {
  href: string | null;
  label: string;
  location?: string;
  resourceLabel: string;
  status?: string;
  watch: WorkspaceWatch;
}

export interface WorkspaceWatchCollection {
  items: WorkspaceWatchListItem[];
  total: number;
}

const workspaceWatchInputSchema = z.object({
  notificationPreference: z.enum(["digest", "immediate", "muted"]).optional(),
  resourceId: z.string().min(1),
  resourceType: z.enum(["entry", "coverage_target"]),
});

async function loadWatchServerModules() {
  if (import.meta.env.SSR) {
    const [sessionState, apiClient] = await Promise.all([
      import("@/domains/access/server/session-state"),
      import("@/domains/discovery/server/api-client"),
    ]);
    return { sessionState, apiClient };
  }

  throw new Error("Workspace watch server modules are only available on the server.");
}

async function requireActiveWorkspaceId(): Promise<string> {
  const { sessionState } = await loadWatchServerModules();
  const { requireReadyAtlasSessionState } = sessionState;
  const session = await requireReadyAtlasSessionState();
  const activeWorkspaceId = session.workspace.activeOrganization?.id;
  if (!activeWorkspaceId) {
    throw new Error("Open a workspace before loading workspace watches.");
  }

  return activeWorkspaceId;
}

function watchPath(orgId: string, input: WorkspaceWatchInput): string {
  return `/orgs/${encodeURIComponent(orgId)}/watches/${input.resourceType}/${encodeURIComponent(input.resourceId)}`;
}

function joinLocation(...parts: (string | null | undefined)[]): string | undefined {
  const location = parts.filter(Boolean).join(", ");
  return location || undefined;
}

function entryResourceLabel(type: string): string {
  if (type === "person") return "Person";
  if (type === "organization") return "Organization";
  if (type === "initiative") return "Initiative";
  if (type === "campaign") return "Campaign";
  if (type === "event") return "Event";
  return "Actor";
}

function entryHref(entry: EntityDetailResponse): string | null {
  if (!entry.slug) return null;
  if (entry.type === "person") return `/profiles/people/${entry.slug}`;
  if (entry.type === "organization") return `/profiles/organizations/${entry.slug}`;
  if (entry.type === "initiative") return `/profiles/initiatives/${entry.slug}`;
  if (entry.type === "campaign") return `/profiles/campaigns/${entry.slug}`;
  if (entry.type === "event") return `/profiles/events/${entry.slug}`;
  return null;
}

async function enrichEntryWatch(
  requestAtlasApi: <T>(path: string, init?: RequestInit) => Promise<T>,
  watch: WorkspaceWatch,
): Promise<WorkspaceWatchListItem> {
  const entry = await requestAtlasApi<EntityDetailResponse>(
    `/entities/${encodeURIComponent(watch.resource_id)}`,
  );
  return {
    href: entryHref(entry),
    label: entry.name,
    location: entry.address.display ?? joinLocation(entry.address.city, entry.address.state),
    resourceLabel: entryResourceLabel(entry.type),
    watch,
  };
}

async function enrichCoverageTargetWatch(
  requestAtlasApi: <T>(path: string, init?: RequestInit) => Promise<T>,
  orgId: string,
  watch: WorkspaceWatch,
): Promise<WorkspaceWatchListItem> {
  const detail = await requestAtlasApi<CoverageTargetDetailResponse>(
    `/orgs/${encodeURIComponent(orgId)}/coverage-targets/${encodeURIComponent(watch.resource_id)}`,
  );
  return {
    href: `/coverage/${watch.resource_id}`,
    label: detail.target.name,
    location: detail.target.geography,
    resourceLabel: "Coverage target",
    status: detail.target.status,
    watch,
  };
}

/**
 * Loads watch status for one resource in the signed-in workspace.
 *
 * @param input - Resource type and id to inspect.
 * @returns Watch status and watch resource when present.
 */
export async function loadWorkspaceWatchStatusData(
  input: WorkspaceWatchInput,
): Promise<WorkspaceWatchStatus> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadWatchServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<WorkspaceWatchStatus>(watchPath(orgId, input));
}

/**
 * Loads shared watches for the signed-in workspace with display context.
 *
 * @returns Watch rows enriched with actor or coverage target labels and links.
 */
export async function loadWorkspaceWatchesData(): Promise<WorkspaceWatchCollection> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadWatchServerModules();
  const { requestAtlasApi } = apiClient;
  const collection = await requestAtlasApi<WorkspaceWatchBaseCollection>(
    `/orgs/${encodeURIComponent(orgId)}/watches`,
  );
  const items = await Promise.all(
    collection.items.map((watch) => {
      if (watch.resource_type === "entry") {
        return enrichEntryWatch(requestAtlasApi, watch);
      }
      return enrichCoverageTargetWatch(requestAtlasApi, orgId, watch);
    }),
  );

  return {
    items,
    total: collection.total,
  };
}

/**
 * Creates or updates a workspace watch.
 *
 * @param input - Resource type, resource id, and optional notification preference.
 * @returns Created or updated watch resource.
 */
export async function watchWorkspaceResourceData(
  input: WorkspaceWatchInput,
): Promise<WorkspaceWatch> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadWatchServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<WorkspaceWatch>(watchPath(orgId, input), {
    body: JSON.stringify(
      input.notificationPreference
        ? { notification_preference: input.notificationPreference }
        : null,
    ),
    method: "PUT",
  });
}

/**
 * Removes a workspace watch.
 *
 * @param input - Resource type and id to stop watching.
 */
export async function unwatchWorkspaceResourceData(input: WorkspaceWatchInput): Promise<void> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadWatchServerModules();
  const { requestAtlasApi } = apiClient;
  await requestAtlasApi(watchPath(orgId, input), {
    method: "DELETE",
  });
}

export const loadWorkspaceWatchStatus = createServerFn({ method: "GET" })
  .inputValidator(workspaceWatchInputSchema)
  .handler(async ({ data }) => {
    return await loadWorkspaceWatchStatusData(data);
  });

export const loadWorkspaceWatches = createServerFn({ method: "GET" }).handler(async () => {
  return await loadWorkspaceWatchesData();
});

export const watchWorkspaceResource = createServerFn({ method: "POST" })
  .inputValidator(workspaceWatchInputSchema)
  .handler(async ({ data }) => {
    return await watchWorkspaceResourceData(data);
  });

export const unwatchWorkspaceResource = createServerFn({ method: "POST" })
  .inputValidator(workspaceWatchInputSchema)
  .handler(async ({ data }) => {
    await unwatchWorkspaceResourceData(data);
  });
