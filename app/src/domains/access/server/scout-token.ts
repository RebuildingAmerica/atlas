import "@tanstack/react-start/server-only";

import { z } from "zod";
import { ensureAuthReady } from "./auth";
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

interface ScoutTokenResponseBody {
  token: string;
  user: {
    id: string;
    email: string;
  };
  workspace_id: string | null;
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
  const auth = await ensureAuthReady();
  const session = scoutSessionSchema.parse(await auth.api.getSession({ headers: request.headers }));
  const user = session?.user;
  if (!user?.id) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const jwt = scoutJwtSchema.parse(await auth.api.getToken({ headers: request.headers }));
  if (!jwt?.token) {
    return Response.json({ error: "Scout token could not be issued" }, { status: 500 });
  }

  const workspaceId = await resolvePrimaryWorkspaceId(user.id);
  const responseBody: ScoutTokenResponseBody = {
    token: jwt.token,
    user: {
      id: user.id,
      email: user.email ?? "",
    },
    workspace_id: workspaceId,
  };

  return Response.json(responseBody, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
