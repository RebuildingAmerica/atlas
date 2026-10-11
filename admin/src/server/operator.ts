/**
 * Who is using the admin: the person Cloudflare Access signed in, if they are
 * a platform operator.
 *
 * Access already refuses anyone outside the operator policy; this is the
 * second lock, so a request that reached the Worker some other way, or an
 * Access policy that drifted, still gets nowhere.
 */

import type { PerimeterRefusalReason } from "@rebuildingamerica/atlas-access/perimeter/perimeter";
import type { AdminRuntime } from "./admin-runtime";

export const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";

export type OperatorRefusalReason = PerimeterRefusalReason | "not_an_operator";

export type OperatorResult =
  | {
      ok: true;
      email: string;
      /** The Access assertion to forward to the API; null only in local development. */
      assertion: string | null;
    }
  | { ok: false; reason: OperatorRefusalReason };

/**
 * Identifies the operator behind a request.
 *
 * @param request - The incoming request.
 * @param runtime - The admin's settings and Access verifier.
 */
export async function identifyOperator(
  request: Request,
  { env, verifier }: AdminRuntime,
): Promise<OperatorResult> {
  if (env.devOperatorEmail) {
    return { ok: true, email: env.devOperatorEmail, assertion: null };
  }
  const result = await verifier.verify(request);
  if (!result.ok) return { ok: false, reason: result.reason };
  const { email } = result.principal;
  if (!env.operators.has(email))
    return { ok: false, reason: "not_an_operator" };
  return {
    ok: true,
    email,
    assertion: request.headers.get(ACCESS_ASSERTION_HEADER),
  };
}
