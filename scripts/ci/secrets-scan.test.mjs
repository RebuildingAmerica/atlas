import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function scan(status) {
  const root = mkdtempSync(path.join(os.tmpdir(), "atlas-secret-scan-"));
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "bin"));
  copyFileSync(
    new URL("../secrets-scan.sh", import.meta.url),
    path.join(root, "scripts/secrets-scan.sh"),
  );
  const baseline = '{"results":{}}\n';
  writeFileSync(path.join(root, ".secrets.baseline"), baseline);
  writeFileSync(
    path.join(root, "bin/git"),
    "#!/bin/sh\nprintf 'known fixture.txt\\000another.txt\\000'\n",
  );
  writeFileSync(
    path.join(root, "bin/uv"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const baseline = args[args.indexOf('--baseline') + 1];
fs.writeFileSync(process.env.SCAN_CALL, JSON.stringify({baseline, files:args.slice(args.indexOf('--baseline') + 2)}));
fs.writeFileSync(baseline, '{"results":{},"metadata":"updated"}\\n');
console.log(process.env.SCANNER_STATUS === '3' ? 'Please git add the baseline' : 'scanner diagnostic');
process.exit(Number(process.env.SCANNER_STATUS));
`,
  );
  for (const executable of ["git", "uv"])
    chmodSync(path.join(root, "bin", executable), 0o755);
  const callPath = path.join(root, "call.json");
  const result = spawnSync("sh", ["scripts/secrets-scan.sh"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
      ATLAS_SECRETS_SCAN_CHANGED_ONLY: String(false),
      SCANNER_STATUS: String(status),
      SCAN_CALL: callPath,
    },
  });
  const call = JSON.parse(readFileSync(callPath, "utf8"));
  const checkedBaseline = readFileSync(
    path.join(root, ".secrets.baseline"),
    "utf8",
  );
  const temporaryBaselineExists = existsSync(call.baseline);
  rmSync(root, { recursive: true, force: true });
  return { result, call, baseline, checkedBaseline, temporaryBaselineExists };
}

test("reviewed findings moving lines pass without rewriting the committed baseline", () => {
  const scanned = scan(3);
  assert.equal(
    scanned.result.status,
    0,
    scanned.result.stdout + scanned.result.stderr,
  );
  assert.equal(scanned.checkedBaseline, scanned.baseline);
  assert.deepEqual(scanned.call.files, ["known fixture.txt", "another.txt"]);
  assert.equal(scanned.temporaryBaselineExists, false);
  assert.doesNotMatch(scanned.result.stdout, /Please git add/);
});

test("new findings still fail and leave the reviewed baseline unchanged", () => {
  const scanned = scan(1);
  assert.notEqual(scanned.result.status, 0);
  assert.equal(scanned.checkedBaseline, scanned.baseline);
  assert.equal(scanned.temporaryBaselineExists, false);
  assert.match(scanned.result.stdout, /scanner diagnostic/);
});

test("scanner errors remain failures", () => {
  const scanned = scan(2);
  assert.notEqual(scanned.result.status, 0);
  assert.equal(scanned.checkedBaseline, scanned.baseline);
  assert.equal(scanned.temporaryBaselineExists, false);
});
