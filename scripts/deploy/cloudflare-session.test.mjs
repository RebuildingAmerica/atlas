import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import {
  createCloudflareSession,
  loadPinnedOAuthCredential,
  runCloudflareSession,
} from "./cloudflare-session.mjs";

const TOKEN = "synthetic-session-bearer";
const NOW = Date.parse("2026-10-10T12:00:00Z");
const credential = () => ({
  oauth_token: TOKEN,
  expiration_time: "2026-10-10T13:00:00Z",
  refresh_token: "synthetic-refresh-secret",
});

test("one explicit profile read supplies only the bearer to a child environment", async () => {
  const env = { ATLAS_CF_PROFILE: "atlas", CLOUDFLARE_ACCOUNT_ID: "account" };
  let reads = 0;
  const result = await runCloudflareSession(["node", "deploy.mjs"], {
    env,
    now: () => NOW,
    loader(profile) {
      reads++;
      assert.equal(profile, "atlas");
      return credential();
    },
    async runner(command, args, options) {
      assert.equal(command, "node");
      assert.deepEqual(args, ["deploy.mjs"]);
      assert.equal(options.env.CLOUDFLARE_API_TOKEN, TOKEN);
      assert.equal(options.env.ATLAS_CF_PROFILE, "atlas");
      assert.equal(JSON.stringify(args).includes(TOKEN), false);
      assert.equal(
        JSON.stringify(options).includes("synthetic-refresh-secret"),
        false,
      );
      return { code: 0 };
    },
  });
  assert.equal(reads, 1);
  assert.equal(result, 0);
  assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
});

test("explicit API tokens bypass the loader, including with an explicit profile", async () => {
  const env = {
    CLOUDFLARE_API_TOKEN: TOKEN,
    ATLAS_CF_PROFILE: "another-profile",
  };
  assert.equal(
    await runCloudflareSession(["pnpm", "web:doctor"], {
      env,
      loader() {
        assert.fail("must not access stored credentials");
      },
      async runner(_command, _args, options) {
        assert.deepEqual(options.env, env);
        return { code: 7 };
      },
    }),
    7,
  );
});

test("bearers are redacted across output chunks on both streams", async () => {
  let stdout = "";
  let stderr = "";
  await runCloudflareSession(["node", "deploy.mjs"], {
    env: { CLOUDFLARE_API_TOKEN: TOKEN },
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
    async runner(_command, _args, _options, output) {
      output.stdout("before " + TOKEN.slice(0, 8));
      output.stdout(TOKEN.slice(8) + " after " + TOKEN);
      for (const char of "error " + TOKEN + " end") output.stderr(char);
      return { code: 1 };
    },
  });
  assert.equal(stdout, "before [REDACTED] after [REDACTED]");
  assert.equal(stderr, "error [REDACTED] end");
});

for (const [name, value] of [
  ["missing", undefined],
  ["expired", { ...credential(), expiration_time: "2026-10-10T11:00:00Z" }],
  ["invalid expiry", { ...credential(), expiration_time: "invalid" }],
  ["missing expiry", { oauth_token: TOKEN }],
  ["missing OAuth bearer", { api_token: TOKEN }],
  ["invalid bearer", { ...credential(), oauth_token: "invalid\ntoken" }],
]) {
  test(`${name} OAuth credentials fail before starting a child`, async () => {
    await assert.rejects(
      runCloudflareSession(["node", "deploy.mjs"], {
        env: { ATLAS_CF_PROFILE: "atlas" },
        now: () => NOW,
        loader: () => value,
        runner() {
          assert.fail("child must not start");
        },
      }),
      /OAuth credential is missing, invalid, or expired/,
    );
  });
}

test("missing commands, implicit profiles, invalid profiles and invalid env tokens fail closed", async () => {
  for (const [command, env] of [
    [[], { CLOUDFLARE_API_TOKEN: TOKEN }],
    [["node"], {}],
    [["node"], { ATLAS_CF_PROFILE: "../atlas" }],
    [["node"], { CLOUDFLARE_API_TOKEN: "token\nsecret" }],
  ]) {
    await assert.rejects(
      runCloudflareSession(command, {
        env,
        loader() {
          assert.fail("invalid input must not read credentials");
        },
        runner() {
          assert.fail("invalid input must not start child");
        },
      }),
    );
  }
});

test("loader and child exceptions never expose credential-bearing diagnostics", async () => {
  for (const failure of ["loader", "runner"]) {
    await assert.rejects(
      runCloudflareSession(["node"], {
        env: { ATLAS_CF_PROFILE: "atlas" },
        now: () => NOW,
        loader() {
          if (failure === "loader") throw new Error(TOKEN);
          return credential();
        },
        runner() {
          throw new Error(TOKEN);
        },
      }),
      (error) => !error.message.includes(TOKEN) && error.cause === undefined,
    );
  }
});

test("signal termination becomes a failing session result", async () => {
  assert.equal(
    await runCloudflareSession(["node"], {
      env: { CLOUDFLARE_API_TOKEN: TOKEN },
      runner: async () => ({ code: null, signal: "SIGTERM" }),
    }),
    1,
  );
});

test("one in-memory session supports repeated commands and refuses expiry without rereading", async () => {
  let reads = 0;
  const session = await createCloudflareSession({
    env: { ATLAS_CF_PROFILE: "atlas" },
    now: () => NOW,
    loader() {
      reads++;
      return credential();
    },
  });
  assert.equal(session.expiresAt, NOW + 3_600_000);
  assert.equal(JSON.stringify(session).includes(TOKEN), false);
  assert.equal(inspect(session).includes(TOKEN), false);
  assert.equal(Object.keys(session).includes("env"), false);
  for (let count = 0; count < 2; count++) {
    assert.equal(
      await runCloudflareSession(["node"], {
        session,
        now: () => NOW,
        loader() {
          assert.fail("reuse must not reload");
        },
        runner: async (_command, _args, options) => {
          assert.equal(options.env.CLOUDFLARE_API_TOKEN, TOKEN);
          return { code: 0 };
        },
      }),
      0,
    );
  }
  await assert.rejects(
    runCloudflareSession(["node"], {
      session,
      now: () => NOW + 3_600_000,
      loader() {
        assert.fail("expiry must not reload");
      },
      runner() {
        assert.fail("expired session must not run");
      },
    }),
    /session is invalid or expired/,
  );
  assert.equal(reads, 1);
});

test("explicit profile and account overrides retain the inherited execution environment", async () => {
  const accountId = "0123456789abcdef0123456789abcdef";
  const session = await createCloudflareSession({
    profile: "atlas",
    accountId,
    env: {
      PATH: "/inherited/bin",
      HOME: "/inherited/home",
      ATLAS_CF_PROFILE: "other",
    },
    now: () => NOW,
    loader(profile) {
      assert.equal(profile, "atlas");
      return credential();
    },
  });
  assert.equal(session.env.PATH, "/inherited/bin");
  assert.equal(session.env.HOME, "/inherited/home");
  assert.equal(session.env.CLOUDFLARE_ACCOUNT_ID, accountId);
  assert.equal(session.env.ATLAS_CF_PROFILE, "atlas");
  for (const invalid of [
    { profile: "../atlas" },
    { accountId: "not-an-account" },
  ]) {
    await assert.rejects(
      createCloudflareSession({
        ...invalid,
        loader() {
          assert.fail("invalid selection must not load credentials");
        },
      }),
    );
  }
});

test("the real child boundary redacts a synthetic env bearer without provider operations", async () => {
  let stdout = "";
  let stderr = "";
  const code = await runCloudflareSession(
    [
      process.execPath,
      "-e",
      "process.stdout.write(process.env.CLOUDFLARE_API_TOKEN); process.stderr.write(process.env.CLOUDFLARE_API_TOKEN); process.exitCode = 4;",
    ],
    {
      env: { CLOUDFLARE_API_TOKEN: TOKEN },
      loader() {
        assert.fail("no credential access");
      },
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    },
  );
  assert.equal(code, 4);
  assert.equal(stdout, "[REDACTED]");
  assert.equal(stderr, "[REDACTED]");
});

test("bearers supplied as child arguments are rejected", async () => {
  await assert.rejects(
    runCloudflareSession(["node", "--token=" + TOKEN], {
      env: { CLOUDFLARE_API_TOKEN: TOKEN },
      runner() {
        assert.fail("token argv must not start");
      },
    }),
    /must not appear in command arguments/,
  );
});

function pinnedOptions(overrides = {}) {
  return {
    resolvePackage: () => "/fake/cf/package.json",
    readPackage: () => ({ name: "cf", version: "1.0.0-beta.14" }),
    importModule: async () => ({
      p() {},
      d: credential,
      s() {
        assert.fail("never refresh");
      },
    }),
    ...overrides,
  };
}

test("the pinned private loader selects the named profile then reads once, without refresh", async () => {
  const calls = [];
  const originalError = console.error;
  const result = await loadPinnedOAuthCredential(
    "atlas",
    pinnedOptions({
      importModule: async (url) => {
        assert.equal(url, "file:///fake/cf/dist/oauth-BUr8bPwo.mjs");
        console.error(TOKEN); // Pinned storage diagnostics must remain private.
        return {
          p(profile) {
            calls.push(["profile", profile]);
          },
          d() {
            calls.push(["read"]);
            return credential();
          },
          s() {
            assert.fail("never refresh");
          },
        };
      },
    }),
  );
  assert.deepEqual(calls, [["profile", "atlas"], ["read"]]);
  assert.equal(result.oauth_token, TOKEN);
  assert.equal(console.error, originalError);
});

test("package or private API drift fails closed before reading credentials", async () => {
  for (const options of [
    { readPackage: () => ({ name: "cf", version: "1.0.0-beta.15" }) },
    { readPackage: () => ({ name: "other", version: "1.0.0-beta.14" }) },
    { importModule: async () => ({ p() {}, d: "changed" }) },
    {
      importModule: async () => {
        throw new Error(TOKEN);
      },
    },
    {
      resolvePackage() {
        throw new Error(TOKEN);
      },
    },
  ]) {
    await assert.rejects(
      loadPinnedOAuthCredential("atlas", pinnedOptions(options)),
      (error) =>
        /pinned cf credential loader is unavailable/.test(error.message) &&
        !error.message.includes(TOKEN),
    );
  }
});

test("each separately created profile is explicitly selected, with diagnostics restored on failure", async () => {
  const selected = [];
  for (const profile of ["atlas", "other-account"]) {
    await loadPinnedOAuthCredential(
      profile,
      pinnedOptions({
        importModule: async () => ({
          p(value) {
            selected.push(value);
          },
          d: credential,
          s() {
            assert.fail("no refresh");
          },
        }),
      }),
    );
  }
  assert.deepEqual(selected, ["atlas", "other-account"]);
  const originalWarn = console.warn;
  await assert.rejects(
    loadPinnedOAuthCredential(
      "atlas",
      pinnedOptions({
        importModule: async () => ({
          p() {
            throw new Error(TOKEN);
          },
          d: credential,
          s() {},
        }),
      }),
    ),
  );
  assert.equal(console.warn, originalWarn);
});

test("overlapping private credential loads fail closed rather than mixing profiles", async () => {
  let finishImport;
  const first = loadPinnedOAuthCredential(
    "atlas",
    pinnedOptions({
      importModule: () =>
        new Promise((resolve) => {
          finishImport = resolve;
        }),
    }),
  );
  await assert.rejects(
    loadPinnedOAuthCredential("other-account", pinnedOptions()),
    /exclusive credential loading/,
  );
  finishImport({ p() {}, d: credential, s() {} });
  assert.equal((await first).oauth_token, TOKEN);
});
