import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareCloudflareOutput } from "./web-cloudflare-output.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/**
 * Apply only the retained Worker domains during recovery.
 *
 * @param options - Immutable deployment material and the exact domains to attach.
 */
export async function applyRecoveryDomains({
  directory,
  deployment,
  domains,
  env = process.env,
  runner = spawnSync,
}) {
  const temporary = mkdtempSync(join(tmpdir(), "atlas-rollback-domains-"));
  try {
    await prepareCloudflareOutput({
      directory,
      architecture: deployment.architecture,
      outputRoot: temporary,
      accountId: deployment.accountId,
      workerName: deployment.workerName,
      workerEnv: {},
      domains,
    });
    const result = runner(
      process.execPath,
      [
        join(ROOT, "node_modules/cf/bin/cf"),
        "workers",
        "triggers",
        "deploy",
        "--prebuilt",
        ...(deployment.architecture === "workers" ? ["--mode", "production"] : []),
        ...(!env.CLOUDFLARE_API_TOKEN && env.ATLAS_CF_PROFILE
          ? ["--profile", env.ATLAS_CF_PROFILE]
          : []),
      ],
      { cwd: temporary, env, encoding: "utf8", timeout: 120000 },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        "cf recovery domain application failed; provider diagnostics suppressed.",
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
