import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, privateDecrypt } from "node:crypto";
import { test } from "node:test";

import { recoverPdsBroker } from "./pds-broker-recovery.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 4096,
});
const env = {
  ATLAS_RECOVERY_PUBLIC_KEY: publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64"),
  ATLAS_PDS_PUBLIC_URL: "https://pds.atlas.example",
  ATLAS_PDS_INSTANCE_NAME: "atlas-pds",
  ATLAS_PDS_INSTANCE_ZONE: "us-east1-b",
  GCP_PROJECT_ID: "atlas-example",
  GITHUB_SHA: "a".repeat(40),
};
const credential = "synthetic-broker-value";
const reply = {
  origin: env.ATLAS_PDS_PUBLIC_URL,
  brokerSecret: credential,
};

test("recovers only the existing broker setting into an encrypted artifact", () => {
  let command;
  const envelope = recoverPdsBroker({
    env,
    run: (binary, args, options) => {
      command = { binary, args, options };
      const program = args.at(-1).slice("sudo python3 -c '".length, -1);
      const fixture = [
        `ATLAS_PDS_PUBLIC_URL=${reply.origin}`,
        `ATLAS_PDS_INVITE_BROKER_SECRET=${credential}`,
        "PDS_ADMIN_PASSWORD=synthetic-unrelated-value", // pragma: allowlist secret - synthetic host fixture
        "PDS_JWT_SECRET=synthetic-unrelated-value", // pragma: allowlist secret - synthetic host fixture
      ].join("\n");
      const driver = `from unittest.mock import patch\nwith patch("pathlib.Path.read_text", return_value=${JSON.stringify(fixture)}):\n    exec(${JSON.stringify(program)})`;
      return { status: 0, stdout: execFileSync("python3", ["-c", driver]) };
    },
  });
  assert.equal(command.binary, "gcloud");
  assert.deepEqual(command.args.slice(0, 9), [
    "compute",
    "ssh",
    "atlas-pds",
    "--project",
    "atlas-example",
    "--zone",
    "us-east1-b",
    "--tunnel-through-iap",
    "--quiet",
  ]);
  assert.equal(command.options.stdio[1], "pipe");
  assert.equal(command.options.stdio[2], "pipe");
  assert.equal(envelope.releaseSha, env.GITHUB_SHA);
  assert.equal(envelope.origin, env.ATLAS_PDS_PUBLIC_URL);
  assert.equal(JSON.stringify(envelope).includes(credential), false);
  const opened = JSON.parse(
    privateDecrypt(
      { key: privateKey, oaepHash: "sha256" },
      Buffer.from(envelope.ciphertext, "base64"),
    ),
  );
  assert.deepEqual(opened, reply);
});

test("provider failures cannot echo secrets or produce an artifact", () => {
  assert.throws(
    () =>
      recoverPdsBroker({
        env,
        run: () => ({ status: 1, stdout: credential, stderr: credential }),
      }),
    /^Error: PDS broker read failed; provider diagnostics suppressed\.$/,
  );
});

test("rejects a wrong host, additional private fields, empty or oversized secrets", () => {
  for (const document of [
    { ...reply, origin: "https://other.atlas.example" },
    { ...reply, adminPassword: "unrelated-value" }, // pragma: allowlist secret - synthetic rejected field
    { ...reply, brokerSecret: "" },
    { ...reply, brokerSecret: "x".repeat(257) },
  ]) {
    assert.throws(
      () =>
        recoverPdsBroker({
          env,
          run: () => ({
            status: 0,
            stdout: Buffer.from(JSON.stringify(document)),
          }),
        }),
      /PDS broker response is invalid/,
    );
  }
});

test("invalid recipient keys and deployment identities fail before provider access", () => {
  for (const overrides of [
    { ATLAS_RECOVERY_PUBLIC_KEY: "invalid" },
    { ATLAS_PDS_PUBLIC_URL: "http://pds.atlas.example" },
    { ATLAS_PDS_INSTANCE_NAME: "--other-command" },
    { GITHUB_SHA: "" },
  ]) {
    let called = false;
    assert.throws(() =>
      recoverPdsBroker({
        env: { ...env, ...overrides },
        run: () => {
          called = true;
        },
      }),
    );
    assert.equal(called, false);
  }
});

test("recovery diagnostics identify only a closed failure category", () => {
  const cases = [
    ["not-json synthetic-private-value", "invalid-json"],
    ["null", "invalid-fields"],
    [JSON.stringify({ brokerSecret: credential }), "invalid-fields"],
    [
      JSON.stringify({ ...reply, origin: "https://other.atlas.example" }),
      "origin-mismatch",
    ],
    [
      JSON.stringify({ ...reply, brokerSecret: "synthetic private value" }),
      "invalid-credential",
    ],
  ];
  for (const [stdout, category] of cases) {
    assert.throws(
      () =>
        recoverPdsBroker({
          env,
          run: () => ({ status: 0, stdout: Buffer.from(stdout) }),
        }),
      (error) => {
        assert.equal(
          error.message,
          `PDS broker response is invalid (${category}); private diagnostics suppressed.`,
        );
        assert.equal(error.message.includes(credential), false);
        assert.equal(error.message.includes("synthetic-private-value"), false);
        return true;
      },
    );
  }
});
