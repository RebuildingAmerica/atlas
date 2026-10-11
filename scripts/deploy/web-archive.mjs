#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  readFileSync,
  readdirSync,
  lstatSync,
  rmSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digestDirectory, verifyWebManifest } from "./web-release.mjs";
import { loadWebRuntime, runtimeInput } from "./web-candidate.mjs";
import { validateReleasePolicy } from "./web-assess.mjs";

/** Keep previous search/profile assets and server code together for rollback. */
export function archiveWebRelease({ directory, runtime }) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  );
  const deployment = JSON.parse(
    readFileSync(join(directory, "deployment.json"), "utf8"),
  );
  verifyWebManifest(deployment, {
    releaseSha: manifest.releaseSha,
    artifactDigest: digestDirectory(join(directory, "artifact")),
    assetsDigest: digestDirectory(join(directory, "assets")),
  });
  for (const key of [
    "target",
    "architecture",
    "workerName",
    "artifactDigest",
    "assetsDigest",
    "authSchemaVersion",
    "sourceDirty",
  ])
    if (manifest[key] !== deployment[key])
      throw new Error("Archive and deployment identity differ.");
  for (const key of ["execution", "runtimeDependencies", "releasePolicy"])
    if (JSON.stringify(manifest[key]) !== JSON.stringify(deployment[key]))
      throw new Error("Archive and joint runtime identity differ.");
  if (
    deployment.execution &&
    (!validateReleasePolicy(deployment.releasePolicy, deployment.releaseSha) ||
      !/^[a-f0-9]{32}$/.test(deployment.durableNamespaceId ?? ""))
  )
    throw new Error(
      "DO rollback requires the recorded operator policy and published web namespace.",
    );
  if (
    JSON.stringify(manifest.publicEnv) !==
      JSON.stringify(deployment.publicEnv) ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      deployment.workerVersionId ?? "",
    )
  )
    throw new Error(
      "A published release with matching public configuration is required.",
    );
  const privateValues = Object.entries(runtime)
    .filter(
      ([key, value]) =>
        /(?:SECRET|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL)$/.test(key) &&
        typeof value === "string" &&
        value.length > 8,
    )
    .flatMap(([, value]) => [
      Buffer.from(value),
      Buffer.from(JSON.stringify(value).slice(1, -1)),
    ]);
  function inspect(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error("Archive cannot contain symbolic links.");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) inspect(join(path, name));
      return;
    }
    if (!stat.isFile()) throw new Error("Unsupported archive entry.");
    const contents = readFileSync(path);
    if (privateValues.some((value) => contents.includes(value)))
      throw new Error(
        "A runtime secret is embedded in the release; archive refused.",
      );
  }
  const entries = ["artifact", "assets", "manifest.json", "deployment.json"];
  for (const entry of entries) inspect(join(directory, entry));
  const path = join(directory, "release.tar.gz"),
    temporary = join(directory, `.release-${randomUUID()}.tar.gz`);
  try {
    writeFileSync(temporary, "", { flag: "wx", mode: 0o600 });
    const result = spawnSync(
      "tar",
      ["-czf", resolve(temporary), "-C", resolve(directory), ...entries],
      { encoding: "utf8", timeout: 120000 },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        "Rollback archive creation failed; diagnostics suppressed.",
      );
    chmodSync(temporary, 0o600);
    const archiveDigest = createHash("sha256")
      .update(readFileSync(temporary))
      .digest("hex");
    renameSync(temporary, path);
    const report = {
      schemaVersion: 1,
      path: resolve(path),
      archiveDigest,
      releaseSha: deployment.releaseSha,
      workerVersionId: deployment.workerVersionId,
      artifactDigest: deployment.artifactDigest,
      assetsDigest: deployment.assetsDigest,
      ...(deployment.execution
        ? {
            execution: deployment.execution,
            durableNamespaceId: deployment.durableNamespaceId,
            runtimeDependencies: deployment.runtimeDependencies,
            releasePolicy: deployment.releasePolicy,
          }
        : {}),
    };
    writeFileSync(
      join(directory, "archive.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    return report;
  } finally {
    rmSync(temporary, { force: true });
  }
}
function main() {
  const args = process.argv.slice(2),
    index = args.indexOf("--directory");
  if (index < 0 || !args[index + 1])
    throw new Error("An explicit release directory is required.");
  console.log(
    JSON.stringify(
      archiveWebRelease({
        directory: resolve(args[index + 1]),
        runtime: loadWebRuntime(runtimeInput()),
      }),
      null,
      2,
    ),
  );
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  try {
    main();
  } catch {
    console.error(
      "Rollback archive failed; check exact artifact identity and embedded runtime secrets. Provider details were suppressed.",
    );
    process.exitCode = 1;
  }
