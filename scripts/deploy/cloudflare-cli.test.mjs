import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as cloudflareCli from "./cloudflare-cli.mjs";
const { cloudflareCommand } = cloudflareCli;

test("Cloudflare writes use cf and keep database credentials out of argv and diagnostics", () => {
  let bodyFile;
  const secret = "private-database-password";
  const result = cloudflareCommand(["hyperdrive", "create"], {
    env: { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "token" },
    body: { origin: { password: secret } },
    runner(binary, args, options) {
      assert.equal(binary, "pnpm");
      assert.deepEqual(args.slice(0, 4), [
        "exec",
        "cf",
        "hyperdrive",
        "create",
      ]);
      assert.equal(args.join(" ").includes(secret), false);
      bodyFile = args.at(-1).slice(1);
      assert.equal(statSync(bodyFile).mode & 0o777, 0o600);
      assert.equal(JSON.parse(readFileSync(bodyFile)).origin.password, secret);
      assert.equal(options.env.CLOUDFLARE_API_TOKEN, "token");
      return { status: 0, stdout: '{"id":"created"}' };
    },
  });
  assert.deepEqual(result, { id: "created" });
  assert.equal(existsSync(bodyFile), false);
  assert.throws(
    () =>
      cloudflareCommand(["hyperdrive", "create"], {
        env: {
          CLOUDFLARE_ACCOUNT_ID: "account",
          CLOUDFLARE_API_TOKEN: "token",
        },
        runner: () => ({ status: 1, stderr: secret }),
      }),
    (error) =>
      !error.message.includes(secret) &&
      error.message.includes("cf hyperdrive create"),
  );
});

test("Cloudflare diagnostics identify credential formats without returning credential material", () => {
  assert.equal(typeof cloudflareCli.cloudflareCredentialKind, "function");
  const { cloudflareCredentialKind } = cloudflareCli;
  assert.equal(
    cloudflareCredentialKind(`cfat_${"x".repeat(48)}`),
    "account-scannable",
  );
  assert.equal(
    cloudflareCredentialKind(`cfut_${"x".repeat(48)}`),
    "user-scannable",
  );
  assert.equal(
    cloudflareCredentialKind(`cfut_${"x".repeat(35)}`),
    "invalid-scannable",
  );
  assert.equal(cloudflareCredentialKind("legacy-token"), "legacy");
  assert.equal(cloudflareCredentialKind(""), "missing");
});

test("Cloudflare failures distinguish process, HTTP, and JSON errors without exposing provider output", () => {
  const secret = "private-provider-credential"; // pragma: allowlist secret -- dummy redaction fixture
  const cases = [
    [
      {
        error: Object.assign(new Error(secret), { code: "ENOENT" }),
        status: null,
      },
      "executable-not-found",
    ],
    [{ status: 1, stderr: `Status code: 401 ${secret}` }, "authentication"],
    [{ status: 1, stderr: `Status code: 403 ${secret}` }, "permission-denied"],
    [{ status: 1, stderr: secret }, "nonzero-exit"],
    [{ status: 0, stdout: secret }, "invalid-json"],
  ];
  for (const [result, failure] of cases) {
    assert.throws(
      () =>
        cloudflareCommand(["hyperdrive", "get", secret], {
          env: {
            CLOUDFLARE_ACCOUNT_ID: "account",
            CLOUDFLARE_API_TOKEN: secret,
          },
          runner: () => result,
        }),
      (error) => error.failure === failure && !error.message.includes(secret),
    );
  }
});

test("Cloudflare reads require an explicit account and credential and honor named cf profiles", () => {
  assert.throws(
    () => cloudflareCommand(["hyperdrive", "list"], { env: {} }),
    /CLOUDFLARE_ACCOUNT_ID/,
  );
  assert.throws(
    () =>
      cloudflareCommand(["hyperdrive", "list"], {
        env: { CLOUDFLARE_ACCOUNT_ID: "account" },
      }),
    /ATLAS_CF_PROFILE/,
  );
  cloudflareCommand(["hyperdrive", "list"], {
    env: { CLOUDFLARE_ACCOUNT_ID: "account", ATLAS_CF_PROFILE: "atlas" },
    runner(_binary, args) {
      assert.deepEqual(args.slice(-2), ["--profile", "atlas"]);
      return { status: 0, stdout: "[]" };
    },
  });
});
