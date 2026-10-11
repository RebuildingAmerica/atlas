import "@tanstack/react-start/server-only";

import { z } from "zod";
import { hasCallbackSecret } from "@/domains/access/server/callback-secret";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";
import { lookupPlatformAccount } from "./platform-lookup";

const lookupRequestSchema = z.object({ query: z.string().trim().min(1).max(320) });

/**
 * Answers the API's account lookup for the platform admin.
 *
 * Accounts, workspaces and purchases live in the app's database, so the API
 * asks here, over the callback channel only it holds the secret for.
 *
 * @param request - The API's callback, carrying `X-Atlas-Callback-Secret`.
 * @returns The account or workspace found; 401 without the callback secret;
 *   400 for a missing query.
 */
export async function handlePlatformLookupRequest(request: Request): Promise<Response> {
  const runtime = getAuthRuntimeConfig();
  if (!hasCallbackSecret(request, runtime.callbackSecret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = lookupRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_lookup" }, { status: 400 });
  }
  return Response.json(await lookupPlatformAccount(parsed.data.query), {
    headers: { "Cache-Control": "no-store" },
  });
}
