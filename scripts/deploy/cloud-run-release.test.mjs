import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const rootDir = path.resolve(import.meta.dirname, "../..");
const releaseScript = path.join(
  rootDir,
  "scripts/deploy/cloud-run-release.mjs",
);
const authHeaderEnvName = "ATLAS_AUTH_INTERNAL_" + "SECRET";

void describe("cloud-run release scheduler", () => {
  void it("sends trusted internal actor headers to the scheduled discovery endpoint", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-scheduler-test-"));
    const logPath = path.join(tempDir, "gcloud-args.log");
    const gcloudPath = path.join(tempDir, "gcloud");
    writeFileSync(
      gcloudPath,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}`,
        'if [ "$1 $2 $3" = "scheduler jobs describe" ]; then',
        "  exit 1",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const result = spawnSync("node", [releaseScript, "ensure-scheduler"], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH ?? ""}`,
        API_URL: "https://atlas-api.example.test",
        [authHeaderEnvName]: "scheduler-header-value",
        GCP_REGION: "us-central1",
        JOB_NAME: "atlas-discovery-scheduled",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(logPath, "utf8");
    assert.match(calls, /scheduler jobs create http atlas-discovery-scheduled/);
    assert.match(
      calls,
      /Content-Type=application\/json,X-Atlas-Internal-Secret=scheduler-header-value,X-Atlas-Actor-Id=atlas-scheduler,X-Atlas-Actor-Email=scheduler@atlas\.rebuildingus\.org/,
    );
    assert.match(
      calls,
      /--uri https:\/\/atlas-api\.example\.test\/api\/discovery-runs\/scheduled/,
    );
  });

  void it("keeps trusted internal actor headers when updating an existing scheduler job", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-scheduler-test-"));
    const logPath = path.join(tempDir, "gcloud-args.log");
    const gcloudPath = path.join(tempDir, "gcloud");
    writeFileSync(
      gcloudPath,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}`,
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const result = spawnSync("node", [releaseScript, "ensure-scheduler"], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH ?? ""}`,
        API_URL: "https://atlas-api.example.test",
        [authHeaderEnvName]: "scheduler-header-value",
        GCP_REGION: "us-central1",
        JOB_NAME: "atlas-discovery-scheduled",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(logPath, "utf8");
    assert.match(calls, /scheduler jobs update http atlas-discovery-scheduled/);
    assert.match(
      calls,
      /--update-headers Content-Type=application\/json,X-Atlas-Internal-Secret=scheduler-header-value,X-Atlas-Actor-Id=atlas-scheduler,X-Atlas-Actor-Email=scheduler@atlas\.rebuildingus\.org/,
    );
  });
});
