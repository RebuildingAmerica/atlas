import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptTrace, decryptTrace } from "./hosted-traces.mjs";
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
