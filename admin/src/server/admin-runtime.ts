/**
 * The admin's settings and Access verifier, built once per Worker isolate.
 *
 * A failure to build is kept, not thrown, so the gate can answer every request
 * with a 503 that names no detail, rather than crash the isolate.
 */

import { env as workerEnv } from "cloudflare:workers";
import { CloudflareAccessVerifier } from "@rebuildingamerica/atlas-access/perimeter/cloudflare-access";
import type { PerimeterVerifier } from "@rebuildingamerica/atlas-access/perimeter/perimeter";
import { readAdminEnv, type AdminEnv, type AdminEnvSource } from "./admin-env";

export interface AdminApiRuntimeBinding {
  getByName(
    name: string,
    options: { locationHint: "enam" },
  ): { fetch(request: Request): Promise<Response> };
}

export interface AdminRuntimeSource extends AdminEnvSource {
  API_RUNTIME?: AdminApiRuntimeBinding;
}

export interface AdminRuntime {
  env: AdminEnv;
  verifier: PerimeterVerifier;
  development: boolean;
  apiRuntime?: AdminApiRuntimeBinding;
}

export type AdminRuntimeResult = AdminRuntime | Error;

let cached: AdminRuntimeResult | undefined;

/**
 * Builds the runtime from an environment.
 *
 * @param source - The Worker's environment.
 * @param development - True only under `vite dev`.
 */
export function createAdminRuntime(
  source: AdminRuntimeSource,
  development: boolean,
): AdminRuntimeResult {
  try {
    const env = readAdminEnv(source, { development });
    if (!development && !source.API_RUNTIME)
      throw new Error("API_RUNTIME binding is required on a deployed admin.");
    return {
      env,
      verifier: new CloudflareAccessVerifier(env.access),
      development,
      apiRuntime: source.API_RUNTIME,
    };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** Returns this isolate's runtime, built on first use from the Worker's settings and secrets. */
export function loadAdminRuntime(): AdminRuntimeResult {
  cached ??= createAdminRuntime(workerEnv, import.meta.env.DEV);
  return cached;
}
