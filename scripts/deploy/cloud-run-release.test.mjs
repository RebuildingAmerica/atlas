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
const SCHEDULER_ENV = {
  API_URL: "https://atlas-api.example.test",
  GCP_REGION: "us-central1",
  JOB_NAME: "atlas-discovery-scheduled",
  SCHEDULER_AUDIENCE: "https://atlas.example.test/api/discovery-runs/scheduled",
  SCHEDULER_SERVICE_ACCOUNT: "atlas-scheduler@atlas-test.iam.gserviceaccount.com",
};

void describe("cloud-run release scheduler", () => {
  void it("signs scheduled discovery calls with the scheduler's Google ID token", () => {
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
        ...SCHEDULER_ENV,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(logPath, "utf8");
    assert.match(calls, /scheduler jobs create http atlas-discovery-scheduled/);
    assert.match(calls, /--headers Content-Type=application\/json /);
    assert.match(
      calls,
      /--oidc-service-account-email atlas-scheduler@atlas-test\.iam\.gserviceaccount\.com/,
    );
    assert.match(
      calls,
      /--oidc-token-audience https:\/\/atlas\.example\.test\/api\/discovery-runs\/scheduled/,
    );
    assert.match(
      calls,
      /--uri https:\/\/atlas-api\.example\.test\/api\/discovery-runs\/scheduled/,
    );
    assert.doesNotMatch(calls, /X-Atlas-Internal-Secret=/);
  });

  void it("removes the retired shared-secret headers when updating an existing job", () => {
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
        ...SCHEDULER_ENV,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(logPath, "utf8");
    assert.match(calls, /scheduler jobs update http atlas-discovery-scheduled/);
    assert.match(
      calls,
      /--remove-headers X-Atlas-Internal-Secret,X-Atlas-Actor-Id,X-Atlas-Actor-Email/,
    );
    assert.match(calls, /--oidc-service-account-email atlas-scheduler@/);
  });

  void it("refuses to configure the job without the scheduler identity", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-scheduler-test-"));
    const gcloudPath = path.join(tempDir, "gcloud");
    writeFileSync(gcloudPath, ["#!/bin/sh", "exit 0", ""].join("\n"), { mode: 0o755 });
    const { SCHEDULER_SERVICE_ACCOUNT: _omitted, ...withoutAccount } = SCHEDULER_ENV;

    const result = spawnSync("node", [releaseScript, "ensure-scheduler"], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH ?? ""}`,
        ...withoutAccount,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SCHEDULER_SERVICE_ACCOUNT/);
  });
});

function fakeGcloud(tempDir, servingRevision) {
  const logPath = path.join(tempDir, "gcloud-args.log");
  const gcloudPath = path.join(tempDir, "gcloud");
  const described = JSON.stringify({
    status: { traffic: [{ revisionName: servingRevision, percent: 100 }] },
  });
  writeFileSync(
    gcloudPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}`,
      'if [ "$1 $2 $3" = "run services describe" ]; then',
      `  printf '%s' ${JSON.stringify(described)}`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return logPath;
}

function runRollback(tempDir, targetRevision) {
  const outputPath = path.join(tempDir, "github-output");
  writeFileSync(outputPath, "");
  const result = spawnSync("node", [releaseScript, "rollback"], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${tempDir}:${process.env.PATH ?? ""}`,
      SERVICE_NAME: "atlas-api",
      GCP_REGION: "us-central1",
      TARGET_REVISION: targetRevision,
      GITHUB_OUTPUT: outputPath,
    },
  });
  return { result, outputPath };
}

void describe("cloud-run release rollback", () => {
  void it("moves all traffic to the named revision and confirms it is serving", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-rollback-test-"));
    const logPath = fakeGcloud(tempDir, "atlas-api-00041-abc");

    const { result, outputPath } = runRollback(tempDir, "atlas-api-00041-abc");

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(logPath, "utf8"),
      /run services update-traffic atlas-api --region us-central1 --to-revisions=atlas-api-00041-abc=100 --quiet/,
    );
    assert.match(readFileSync(outputPath, "utf8"), /revision=atlas-api-00041-abc/);
  });

  void it("fails when Cloud Run does not confirm the named revision is serving", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-rollback-test-"));
    fakeGcloud(tempDir, "atlas-api-00042-new");

    const { result } = runRollback(tempDir, "atlas-api-00041-abc");

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /did not confirm 100% traffic on atlas-api-00041-abc/);
  });

  void it("refuses a revision of another service before calling gcloud", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-rollback-test-"));
    const logPath = fakeGcloud(tempDir, "atlas-pds-00001-aaa");

    const { result } = runRollback(tempDir, "atlas-pds-00001-aaa");

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TARGET_REVISION must name a atlas-api revision/);
    assert.throws(() => readFileSync(logPath, "utf8"));
  });
});
