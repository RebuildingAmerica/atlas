import "@tanstack/react-start/server-only";

import { z } from "zod";
import { ensureAuthReady } from "./auth";
import { ScoutDeviceRevokedError, registerOrTouchScoutDevice } from "./scout-devices";
import { resolvePrimaryWorkspaceId } from "./workspace-lookup";

const scoutSessionSchema = z
  .object({
    user: z.object({
      id: z.string(),
      email: z.string().optional(),
    }),
  })
  .nullable();

const scoutJwtSchema = z
  .object({
    token: z.string(),
  })
  .nullable();

const scoutTokenRequestSchema = z.object({
  default_upload_target: z.enum(["public", "workspace"]),
  search_key_configured: z.boolean().optional(),
  worker_id: z.string().trim().min(1).nullable().optional(),
  worker_name: z.string().trim().min(1),
  workspace_id: z.string().trim().min(1).nullable().optional(),
});

interface ScoutTokenResponseBody {
  token: string;
  user: {
    id: string;
    email: string;
  };
  worker_id: string;
  workspace_id: string | null;
}

type ScoutTokenRequestBody = z.infer<typeof scoutTokenRequestSchema>;

/**
 * Reads the Scout device metadata from the request body.
 *
 * @param request - The `/api/auth/scout/token` request.
 * @returns The parsed metadata, or null when the body is missing or malformed.
 */
async function readScoutTokenRequestBody(request: Request): Promise<ScoutTokenRequestBody | null> {
  try {
    return scoutTokenRequestSchema.parse(await request.json());
  } catch {
    return null;
  }
}

/**
 * Issues a short-lived Atlas API JWT for a browser-approved Scout session.
 *
 * Scout's device authorization flow returns a Better Auth bearer session. The
 * Python API accepts OAuth/JWT-style bearer tokens, so this bridge keeps the
 * opaque session on the app server and gives Scout a resource-server token for
 * sync calls.
 *
 * @param request - Incoming `/api/auth/scout/token` request.
 */
export async function issueScoutTokenRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await ensureAuthReady();
  const session = scoutSessionSchema.parse(await auth.api.getSession({ headers: request.headers }));
  const user = session?.user;
  if (!user?.id) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await readScoutTokenRequestBody(request);
  if (!body) {
    return Response.json({ error: "Scout device metadata is required." }, { status: 400 });
  }

  const workspaceId = body.workspace_id ?? (await resolvePrimaryWorkspaceId(user.id));
  let workerId: string;
  try {
    const device = await registerOrTouchScoutDevice({
      defaultUploadTarget: body.default_upload_target,
      id: body.worker_id ?? undefined,
      searchKeyConfigured: body.search_key_configured,
      userId: user.id,
      workerName: body.worker_name,
      workspaceId,
    });
    workerId = device.id;
  } catch (error) {
    if (error instanceof ScoutDeviceRevokedError) {
      return Response.json({ error: "Scout device revoked" }, { status: 403 });
    }
    throw error;
  }

  const jwt = scoutJwtSchema.parse(await auth.api.getToken({ headers: request.headers }));
  if (!jwt?.token) {
    return Response.json({ error: "Scout token could not be issued" }, { status: 500 });
  }

  const responseBody: ScoutTokenResponseBody = {
    token: jwt.token,
    user: {
      id: user.id,
      email: user.email ?? "",
    },
    worker_id: workerId,
    workspace_id: workspaceId,
  };

  return Response.json(responseBody, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
