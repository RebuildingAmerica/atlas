import { readBuildOutput } from "@cloudflare/build-output-utils";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { copyWebArtifact } from "./web-release.mjs";

/** Rebind verified bundles without rebuilding or introducing deployment credentials. */
export async function prepareCloudflareOutput({
  directory,
  architecture,
  outputRoot,
  accountId,
  workerName,
  workerEnv,
  hostname,
  domains = [hostname],
}) {
  if (
    workerEnv.NODE_ENV &&
    (workerEnv.NODE_ENV.type !== "text" ||
      workerEnv.NODE_ENV.value !== "production")
  )
    throw new Error("Hosted Workers require NODE_ENV=production.");
  const output = join(outputRoot, ".cloudflare/output/v0");
  mkdirSync(output, { recursive: true });
  copyWebArtifact(
    join(
      directory,
      architecture === "workers" ? "artifact" : "artifact/cf-edge",
    ),
    output,
  );
  const root = JSON.parse(readFileSync(join(output, "config.json"), "utf8"));
  root.accountId = accountId;
  writeFileSync(join(output, "config.json"), JSON.stringify(root));
  const workerDirectory = join(output, "workers/default");
  const workerFile = join(workerDirectory, "worker.config.json");
  const worker = JSON.parse(readFileSync(workerFile, "utf8"));
  worker.name = workerName;
  worker.workersDev = false;
  worker.previewUrls = false;
  if (
    !domains.length ||
    domains.some((domain) => !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(domain))
  )
    throw new Error("Explicit nonempty Worker domains are required.");
  worker.domains = domains;
  worker.triggers = [];
  worker.assets = {
    htmlHandling: architecture === "workers" ? "drop-trailing-slash" : "none",
    notFoundHandling: "none",
    runWorkerFirst: false,
  };
  // Better Auth reads runtime NODE_ENV through its env proxy. A production
  // build alone does not enable its shared rate limits on Workers, leaving
  // account recovery and sign-in exposed to abuse and CPU probes incomplete.
  worker.env = {
    ...workerEnv,
    NODE_ENV: { type: "text", value: "production" },
    ASSETS: { type: "assets" },
  };
  writeFileSync(workerFile, JSON.stringify(worker));
  const assets = join(workerDirectory, "assets");
  rmSync(assets, { recursive: true, force: true });
  cpSync(join(directory, "assets"), assets, { recursive: true });
  // cf's own parser rejects malformed, nonportable or incomplete Build Output.
  return readBuildOutput(outputRoot);
}
