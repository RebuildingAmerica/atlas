import { existsSync } from "node:fs";
import path from "node:path";
import type { ApiDomainTarget } from "./api-domain.js";
import type { ApiEdgeConfig } from "./api-edge-models.js";
import { parseEnvFile } from "../lib/env-file.js";

const DEFAULT_REGION = "us-central1";

const TARGETS: Record<ApiDomainTarget, { domain: string; service: string }> = {
  prod: {
    domain: "atlas-api.rebuildingus.org",
    service: "atlas-api",
  },
  staging: {
    domain: "atlas-api-staging.rebuildingus.org",
    service: "atlas-api-staging",
  },
};

export function readConfig(
  projectRoot: string,
  target: ApiDomainTarget,
): ApiEdgeConfig | null {
  const env = mergeEnvFiles([
    path.join(projectRoot, ".env.production"),
    path.join(projectRoot, ".env"),
    path.join(projectRoot, "api", ".env"),
  ]);
  const project = env.get("GCP_PROJECT_ID");
  if (!project) return null;
  const targetConfig = TARGETS[target];
  return {
    target,
    domain: targetConfig.domain,
    service: targetConfig.service,
    region: env.get("GCP_REGION") ?? DEFAULT_REGION,
    project,
    edgeOriginSecret: env.get("ATLAS_EDGE_ORIGIN_SECRET") ?? "",
  };
}

function mergeEnvFiles(files: string[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const file of files) {
    if (!existsSync(file)) continue;
    const parsed = parseEnvFile(file);
    for (const [key, value] of parsed) {
      if (!merged.has(key)) merged.set(key, value);
    }
  }
  return merged;
}
