/** Test-owned Access authority: production verification with this run's ephemeral JWKS. */
import { CloudflareAccessVerifier } from "@rebuildingamerica/atlas-access/perimeter/cloudflare-access";
import { readAdminEnv } from "../../src/server/admin-env";
import type { AdminRuntime } from "../../src/server/admin-runtime";

let runtime: AdminRuntime | undefined;
export function loadAdminRuntime(): AdminRuntime {
  runtime ??= {
    development: true,
    env: readAdminEnv(process.env, { development: true }),
    verifier: new CloudflareAccessVerifier(
      readAdminEnv(process.env, { development: true }).access,
      {
        fetch: () =>
          Promise.resolve(
            Response.json(JSON.parse(process.env.ATLAS_E2E_ACCESS_JWKS ?? "")),
          ),
      },
    ),
  };
  return runtime;
}
