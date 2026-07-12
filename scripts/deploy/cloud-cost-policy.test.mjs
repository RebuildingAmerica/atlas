import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  buildArtifactCleanupPolicy,
  evaluateCloudRunCostPosture,
  evaluateRepositoryCostPosture,
} from "./cloud-cost-policy.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");
const preflightScript = path.join(rootDir, "scripts/deploy/cloud-cost-preflight.mjs");

void describe("cloud cost policy", () => {
  void it("accepts a scale-to-zero Cloud Run service with bounded resources", () => {
    const posture = evaluateCloudRunCostPosture({
      name: "atlas-api",
      template: {
        annotations: {},
        containerConcurrency: 1,
        containers: [
          {
            resources: { limits: { cpu: "1", memory: "768Mi" } },
          },
        ],
      },
    });

    assert.equal(posture.status, "pass");
    assert.deepEqual(posture.blockers, []);
  });

  void it("blocks paid-idle Cloud Run drift before deploy work starts", () => {
    const posture = evaluateCloudRunCostPosture({
      name: "atlas-api",
      template: {
        annotations: {
          "autoscaling.knative.dev/minScale": "1",
          "run.googleapis.com/cpu-throttling": "false",
        },
        containerConcurrency: 1,
        containers: [
          {
            resources: { limits: { cpu: "2", memory: "2Gi" } },
          },
        ],
      },
    });

    assert.equal(posture.status, "block");
    assert.match(posture.blockers.join("\n"), /min instances must stay at 0/);
    assert.match(posture.blockers.join("\n"), /CPU must stay request-allocated/);
    assert.match(posture.blockers.join("\n"), /CPU limit 2 exceeds policy maximum 1/);
    assert.match(posture.blockers.join("\n"), /memory limit 2Gi exceeds policy maximum 768Mi/);
  });

  void it("blocks Artifact Registry repositories without cleanup policies", () => {
    const posture = evaluateRepositoryCostPosture({
      cleanupPolicies: null,
      cleanupPolicyDryRun: false,
      name: "projects/rap-atlas-prod/locations/us-central1/repositories/atlas-images",
      sizeBytes: "1930654000",
    });

    assert.equal(posture.status, "block");
    assert.match(posture.blockers.join("\n"), /Artifact Registry cleanup policy is required/);
  });

  void it("builds the repository cleanup policy that preserves rollback images", () => {
    const policy = buildArtifactCleanupPolicy();

    assert.equal(policy.length, 2);
    assert.deepEqual(policy[0], {
      name: "delete-untagged-api-images",
      action: { type: "Delete" },
      condition: {
        olderThan: "86400s",
        packageNamePrefixes: ["atlas-api"],
        tagState: "untagged",
      },
    });
    assert.deepEqual(policy[1], {
      name: "keep-recent-api-images",
      action: { type: "Keep" },
      mostRecentVersions: {
        keepCount: 5,
        packageNamePrefixes: ["atlas-api"],
      },
    });
  });
});

void describe("cloud cost preflight CLI", () => {
  void it("applies cleanup policy before evaluating deployed service drift", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-cost-preflight-"));
    const logPath = path.join(tempDir, "gcloud-args.log");
    const gcloudPath = path.join(tempDir, "gcloud");
    writeFileSync(
      gcloudPath,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}`,
        'if [ "$1 $2 $3" = "run services describe" ]; then',
        "  cat <<'JSON'",
        JSON.stringify({
          spec: {
            template: {
              metadata: { annotations: {} },
              spec: {
                containerConcurrency: 1,
                containers: [{ resources: { limits: { cpu: "1", memory: "768Mi" } } }],
              },
            },
          },
        }),
        "JSON",
        "  exit 0",
        "fi",
        'if [ "$1 $2 $3" = "artifacts repositories describe" ]; then',
        "  cat <<'JSON'",
        JSON.stringify({
          cleanupPolicies: { "delete-untagged-api-images": {} },
          cleanupPolicyDryRun: false,
          name: "projects/rap-atlas-prod/locations/us-central1/repositories/atlas-images",
          sizeBytes: "402653184",
        }),
        "JSON",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const result = spawnSync("node", [preflightScript, "check"], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH ?? ""}`,
        GCP_REGION: "us-central1",
        IMAGE_REGISTRY: "us-central1-docker.pkg.dev/rap-atlas-prod/atlas-images",
        SERVICE_NAME: "atlas-api",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(logPath, "utf8");
    assert.match(calls, /artifacts repositories set-cleanup-policies atlas-images/);
    assert.match(calls, /run services describe atlas-api/);
    assert.match(result.stdout, /Cloud cost preflight passed/);
  });
});
