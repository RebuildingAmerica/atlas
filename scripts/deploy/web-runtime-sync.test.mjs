import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectWebRuntime,
  synchronizeWebRuntime,
} from "./web-runtime-sync.mjs";

const canonical = {
  ATLAS_PUBLIC_URL: "https://atlas.example.com",
  ATLAS_SERVER_API_PROXY_TARGET: "https://api.example.com",
  ATLAS_MANAGED: "true",
  ATLAS_MULTI_USER: "true",
  ATLAS_AUTH_INTERNAL_SECRET: "unchanged-private-signing",
  ATLAS_AUTH_CALLBACK_SECRET: "dedicated-api-callback",
  ATLAS_EDGE_ORIGIN_SECRET: "low-privilege-ip-proof",
  ATLAS_ADMIN_PUBLIC_URL: "https://admin.example.com",
  DATABASE_URL: "postgres://user:private-db@db.example.com/atlas",
  ATLAS_EMAIL_RESEND_API_KEY: "unchanged-private-email",
  ATLAS_AUTH_JWT_AUDIENCES: "https://atlas.example.com/mcp",
  ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
    "https://atlas.example.com/api/auth/internal/api-key",
  ATLAS_SAML_SP_PRIVATE_KEY: "unchanged-private-enterprise-key",
};
const rows = () =>
  Object.entries(canonical).map(([key, value], i) => ({
    id: `env_${i}`,
    key,
    target: ["production"],
    type: "encrypted",
    value,
  }));
function provider(inventory = rows()) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push(url);
      assert.equal(new URL(url).origin, "https://api.vercel.com");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, "Bearer private-provider-token");
      if (new URL(url).pathname.endsWith("/env"))
        return Response.json({ envs: inventory });
      const id = new URL(url).pathname.split("/").at(-1);
      const row = inventory.find((row) => row.id === id);
      return Response.json({ ...row, decrypted: true });
    },
  };
}
const input = {
  target: "production",
  project: "prj_atlas",
  team: "team_atlas",
  token: "private-provider-token",
};

test("runtime sync reads exact production variables and preserves optional identity configuration", async () => {
  const p = provider([
    ...rows(),
    {
      id: "nitro",
      key: "NITRO_PRESET",
      type: "plain",
      target: ["production"],
      value: "vercel",
    },
    {
      id: "foreign",
      key: "ATLAS_PUBLIC_URL",
      type: "plain",
      target: ["preview"],
      value: "https://preview.example.com",
    },
  ]);
  assert.deepEqual(await collectWebRuntime({ ...input, ...p }), canonical);
  assert.ok(
    p.calls.every(
      (url) => new URL(url).searchParams.get("teamId") === input.team,
    ),
  );
});

test("managed migration makes account and workspace mode explicit for older deployments using implicit enabled mode", async () => {
  const inventory = rows().filter(
    (row) => !["ATLAS_MANAGED", "ATLAS_MULTI_USER"].includes(row.key),
  );
  assert.deepEqual(
    await collectWebRuntime({ ...input, ...provider(inventory) }),
    canonical,
  );
  assert.deepEqual(
    await collectWebRuntime({
      ...input,
      ...provider(inventory),
      existing: canonical,
    }),
    canonical,
  );
});

test("write-only provider secrets require the existing value and never accept ciphertext or placeholders", async () => {
  const inventory = rows().map((row) =>
    row.key === "ATLAS_SAML_SP_PRIVATE_KEY"
      ? { ...row, type: "sensitive", value: "ciphertext-placeholder" }
      : row,
  );
  await assert.rejects(
    () => collectWebRuntime({ ...input, ...provider(inventory) }),
    /ATLAS_SAML_SP_PRIVATE_KEY/,
  );
  const p = provider(inventory);
  assert.deepEqual(
    await collectWebRuntime({
      ...input,
      ...p,
      existing: {
        ATLAS_SAML_SP_PRIVATE_KEY: canonical.ATLAS_SAML_SP_PRIVATE_KEY,
      },
    }),
    canonical,
  );
  assert.equal(
    p.calls.some((url) =>
      url.endsWith(
        `/env_${Object.keys(canonical).indexOf("ATLAS_SAML_SP_PRIVATE_KEY")}?teamId=team_atlas`,
      ),
    ),
    false,
  );
  await assert.rejects(
    () =>
      collectWebRuntime({
        ...input,
        ...provider(),
        existing: { ATLAS_AUTH_INTERNAL_SECRET: "different-private-signing" },
      }),
    /conflict/,
  );
});

test("staging requires an explicit custom environment and rejects ambiguous configuration", async () => {
  const customEnvironmentId = "env_staging";
  const inventory = rows().map((row) => ({
    ...row,
    target: ["preview"],
    customEnvironmentIds: [customEnvironmentId],
  }));
  assert.deepEqual(
    await collectWebRuntime({
      ...input,
      target: "staging",
      customEnvironmentId,
      ...provider(inventory),
    }),
    canonical,
  );
  await assert.rejects(
    () =>
      collectWebRuntime({
        ...input,
        target: "staging",
        ...provider(inventory),
      }),
    /custom environment/,
  );
  await assert.rejects(
    () => collectWebRuntime({ ...input, ...provider([...rows(), rows()[0]]) }),
    /Duplicate/,
  );
  await assert.rejects(
    () =>
      collectWebRuntime({
        ...input,
        ...provider(rows().map((row) => ({ ...row, type: "unknown" }))),
      }),
    /Unsupported/,
  );
});

test("CI additions supply split credentials without replacing retained identity configuration", async () => {
  const additional = { ATLAS_PLATFORM_OPERATOR_EMAILS: "operator@example.org" };
  const result = await collectWebRuntime({
    ...input,
    ...provider(),
    additional,
  });
  assert.deepEqual(result, { ...canonical, ...additional });
  const inventory = rows().map((row) =>
    row.key === "ATLAS_SAML_SP_PRIVATE_KEY"
      ? { ...row, type: "sensitive" }
      : row,
  );
  assert.deepEqual(
    await collectWebRuntime({
      ...input,
      ...provider(inventory),
      additional: {
        ...additional,
        ATLAS_SAML_SP_PRIVATE_KEY: canonical.ATLAS_SAML_SP_PRIVATE_KEY,
      },
    }),
    { ...canonical, ...additional },
  );
  await assert.rejects(
    collectWebRuntime({
      ...input,
      ...provider(),
      additional: {
        ATLAS_SAML_SP_PRIVATE_KEY: "different-enterprise-identity",
      },
    }),
    /conflict/,
  );
  await assert.rejects(
    collectWebRuntime({
      ...input,
      ...provider(),
      additional: {
        DATABASE_URL: "postgres://different-retained-database/atlas",
      },
    }),
    /conflict/,
  );
  await assert.rejects(
    collectWebRuntime({
      ...input,
      ...provider(),
      additional: {
        ATLAS_PLATFORM_OPERATOR_EMAILS: ["operator@example.org"],
      },
    }),
    /configuration strings/,
  );
});

test("doctor never writes; successful sync writes a private file and sends secrets only through stdin", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-runtime-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, ".atlas/web/runtime.json");
  const calls = [];
  const tool = (binary, args, options) =>
    calls.push({ binary, args, input: options.input });
  const options = { ...input, ...provider(), root, output, tool };
  const result = await synchronizeWebRuntime({
    ...options,
    doctor: true,
    syncGithub: true,
  });
  assert.equal(existsSync(output), false);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(result).includes("private"), false);
  await synchronizeWebRuntime({ ...options, syncGithub: true });
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), canonical);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [
    "secret",
    "set",
    "ATLAS_WEB_RUNTIME_ENV_JSON",
    "--repo",
    "RebuildingAmerica/atlas",
    "--env",
    "production",
  ]);
  assert.deepEqual(JSON.parse(calls[0].input), canonical);
  assert.equal(calls[0].args.join(" ").includes("private"), false);
  await assert.rejects(
    () =>
      synchronizeWebRuntime({ ...options, output: join(root, "public.json") }),
    /\.atlas/,
  );
});

test("unavailable values and provider failures cannot overwrite existing configuration or leak bodies", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-runtime-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, ".atlas/web/runtime.json");
  await synchronizeWebRuntime({ ...input, ...provider(), root, output });
  await assert.rejects(
    () =>
      synchronizeWebRuntime({
        ...input,
        root,
        output,
        fetcher: async () =>
          new Response("private-provider-body", { status: 403 }),
      }),
    (error) => !error.message.includes("private-provider-body"),
  );
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), canonical);
  const p = provider();
  await assert.rejects(
    () =>
      collectWebRuntime({
        ...input,
        ...p,
        fetcher: async (url, init) =>
          new URL(url).pathname.endsWith("/env")
            ? p.fetcher(url, init)
            : Response.json({ value: "ciphertext", decrypted: false }),
      }),
    /not decrypted/,
  );
});
