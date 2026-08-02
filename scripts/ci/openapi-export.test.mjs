import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("OpenAPI export supplies its non-hosted auth mode", () => {
  const binDir = mkdtempSync(join(tmpdir(), "atlas-openapi-export-"));
  const capturePath = join(binDir, "captured-auth-mode");
  writeFileSync(
    join(binDir, "uv"),
    `#!/bin/sh\nprintf '%s' "$ATLAS_MULTI_USER" > "$ATLAS_OPENAPI_CAPTURE"\n`,
    { mode: 0o755 },
  );

  const env = { ...process.env };
  delete env.ATLAS_MULTI_USER;
  env.ATLAS_OPENAPI_CAPTURE = capturePath;
  env.PATH = `${binDir}:${env.PATH}`;

  execFileSync("sh", [resolve("scripts/openapi-export.sh")], { env });

  assert.equal(readFileSync(capturePath, "utf8"), "false");
});
