import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encryptTrace,
  decryptTrace,
  readRetainedHostedReport,
} from "./hosted-traces.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("hosted trace evidence round-trips only with the existing secret and exact run identity", () => {
  const secret = "fixture-hosted-verifier-credential",
    identity = `${"a".repeat(40)}:123:1`,
    body = Buffer.from("session-cookie=fixture-private-identity");
  const encrypted = encryptTrace(body, secret, identity);
  assert.equal(encrypted.includes(body), false);
  assert.deepEqual(decryptTrace(encrypted, secret, identity), body);
  assert.throws(() => decryptTrace(encrypted, `${secret}-other`, identity));
  assert.throws(() =>
    decryptTrace(encrypted, secret, identity.replace(":1", ":2")),
  );
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptTrace(encrypted, secret, identity));
});
test("hosted trace encryption refuses missing existing credentials", () => {
  assert.throws(() =>
    encryptTrace(Buffer.from("trace"), "", `${"a".repeat(40)}:123:1`),
  );
});

test("retained report decoding requires the exact encrypted run and leaves data encrypted", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-retained-report-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const secret = "fixture-existing-verifier-credential";
  const identity = `${"b".repeat(40)}:123:1`;
  const report = { suites: [], private: "fixture-session" };
  const name = "hosted-results.json.encrypted";
  writeFileSync(
    join(directory, "index.json"),
    JSON.stringify({ identity, files: [name] }),
  );
  writeFileSync(
    join(directory, name),
    encryptTrace(Buffer.from(JSON.stringify(report)), secret, identity),
  );
  assert.deepEqual(
    readRetainedHostedReport({ directory, secret, identity }),
    report,
  );
  assert.throws(() =>
    readRetainedHostedReport({
      directory,
      secret,
      identity: identity.replace(":1", ":2"),
    }),
  );
  assert.throws(() =>
    readRetainedHostedReport({
      directory,
      secret: `${secret}-different`,
      identity,
    }),
  );
});
