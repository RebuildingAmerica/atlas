import "@tanstack/react-start/server-only";

import { getAuthDatabase, getAuthPgPool } from "./auth";

/**
 * Returns the workspace id Atlas should bind into an OAuth access token when
 * the client did not request an explicit ``org:{id}`` scope.
 *
 * The rule is intentionally narrow: only auto-bind when the user belongs to
 * exactly one workspace.  A user with zero workspaces shouldn't have an
 * ``org_id`` claim at all (the API enforces ``require_org_actor`` on
 * org-scoped routes), and a multi-workspace user must disambiguate via the
 * consent-page picker so we don't silently leak data from the wrong
 * workspace.
 *
 * Returns ``null`` for the zero/multi cases so the caller can fall back
 * to "no claim", which preserves the explicit failure mode at the API
 * boundary.
 *
 * @param userId - The Better Auth user id to look up.
 */
export async function resolvePrimaryWorkspaceId(userId: string): Promise<string | null> {
  if (!userId) {
    return null;
  }

  const pool = getAuthPgPool();
  if (pool) {
    const result = await pool.query<{ organizationId: string }>(
      'SELECT "organizationId" FROM "member" WHERE "userId" = $1 LIMIT 2',
      [userId],
    );
    if (result.rows.length === 1) {
      return result.rows[0]?.organizationId ?? null;
    }
    return null;
  }

  const database = getAuthDatabase();
  if (!database) {
    return null;
  }

  const rows = database
    .prepare("SELECT organizationId FROM member WHERE userId = ? LIMIT 2")
    .all(userId) as { organizationId: string }[];
  if (rows.length === 1) {
    return rows[0]?.organizationId ?? null;
  }
  return null;
}
