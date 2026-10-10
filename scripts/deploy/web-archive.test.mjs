import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { archiveWebRelease } from "./web-archive.mjs";
import { createWebManifest, digestDirectory } from "./web-release.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-archive-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "artifact"));
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "artifact/server.js"), "verified server");
  writeFileSync(join(directory, "assets/main.js"), "verified client");
  const manifest = createWebManifest({
    target: "staging",
    architecture: "workers",
    releaseSha: "a".repeat(40),
    sourceDirty: false,
    artifactDigest: digestDirectory(join(directory, "artifact")),
    assetsDigest: digestDirectory(join(directory, "assets")),
  });
  const deployment = {
    ...manifest,
    workerVersionId: "12345678-1234-1234-1234-123456789abc",
    candidateUrl: "https://candidate.atlas.example.com",
  };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(directory, "deployment.json"), JSON.stringify(deployment));
  writeFileSync(
    join(directory, "private-journal.json"),
    "private origin secret",
  );
  return { directory, manifest, deployment };
}
test("rollback archive retains exact portable artifacts and deployment identity without private journals", (t) => {
  const { directory, deployment } = fixture(t);
  const report = archiveWebRelease({
    directory,
    runtime: { ATLAS_AUTH_INTERNAL_SECRET: "existing-private-secret" },
  });
  assert.equal(report.artifactDigest, deployment.artifactDigest);
  assert.match(report.archiveDigest, /^[a-f0-9]{64}$/);
  assert.equal(statSync(report.path).mode & 0o777, 0o600);
  const entries = spawnSync("tar", ["-tzf", report.path], { encoding: "utf8" });
  assert.equal(entries.status, 0);
  assert.ok(entries.stdout.includes("artifact/server.js"));
  assert.ok(entries.stdout.includes("assets/main.js"));
  assert.ok(entries.stdout.includes("deployment.json"));
  assert.equal(entries.stdout.includes("private-journal"), false);
});
test("tampering, plaintext secrets and invalid release identity prevent creating a rollback archive", (t) => {
  for (const modification of ["tamper", "secret", "identity"]) {
    const { directory, manifest, deployment } = fixture(t);
    if (modification === "identity")
      writeFileSync(
        join(directory, "deployment.json"),
        JSON.stringify({ ...deployment, workerName: "unrelated" }),
      );
    else {
      writeFileSync(
        join(directory, "artifact/server.js"),
        modification === "secret"
          ? "embedded-existing-private-secret"
          : "modified server",
      );
      if (modification === "secret") {
        const artifactDigest = digestDirectory(join(directory, "artifact"));
        writeFileSync(
          join(directory, "manifest.json"),
          JSON.stringify({ ...manifest, artifactDigest }),
        );
        writeFileSync(
          join(directory, "deployment.json"),
          JSON.stringify({ ...deployment, artifactDigest }),
        );
      }
    }
    assert.throws(() =>
      archiveWebRelease({
        directory,
        runtime: { ATLAS_AUTH_INTERNAL_SECRET: "existing-private-secret" },
      }),
    );
    assert.equal(existsSync(join(directory, "release.tar.gz")), false);
  }
});
