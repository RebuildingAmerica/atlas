#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadWebRuntime } from "./web-candidate.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const RUNTIME_KEY =
  /^(?:ATLAS_[A-Z0-9_]+|STRIPE_[A-Z0-9_]+|DATABASE_URL|DATABASE_BACKEND|NODE_ENV)$/;

/** Preserve every configured feature and identity value; unreadable secrets never become defaults. */
export async function collectWebRuntime({
  target,
  project,
  team,
  token,
  customEnvironmentId,
  existing = {},
  additional = {},
  fetcher = fetch,
}) {
  if (
    !["staging", "production"].includes(target) ||
    !/^prj_[\w]+$/.test(project ?? "") ||
    !/^team_[\w]+$/.test(team ?? "") ||
    !token?.trim()
  )
    throw new Error(
      "Explicit target, Vercel project, team and authentication are required.",
    );
  if (target === "staging" && !/^env_[\w]+$/.test(customEnvironmentId ?? ""))
    throw new Error(
      "Staging requires its explicit Vercel custom environment ID.",
    );
  if (target === "production" && customEnvironmentId)
    throw new Error("Production cannot select a custom environment.");
  if (
    [existing, additional].some(
      (settings) =>
        !settings ||
        typeof settings !== "object" ||
        Array.isArray(settings) ||
        Object.entries(settings).some(
          ([key, value]) => !RUNTIME_KEY.test(key) || typeof value !== "string",
        ),
    )
  )
    throw new Error(
      "Existing runtime must contain only application configuration strings.",
    );
  async function read(path, custom = false) {
    const url = new URL(path, "https://api.vercel.com");
    url.searchParams.set("teamId", team);
    if (custom && customEnvironmentId)
      url.searchParams.set("customEnvironmentId", customEnvironmentId);
    const response = await fetcher(url.href, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `Vercel runtime read failed with HTTP ${response.status}.`,
      );
    return response.json();
  }
  const inventory = await read(`/v10/projects/${project}/env`, true);
  const rows = Array.isArray(inventory) ? inventory : inventory.envs;
  if (!Array.isArray(rows) || inventory.pagination?.next)
    throw new Error("Complete Vercel environment inventory is required.");
  const selected = rows.filter(
    (row) =>
      RUNTIME_KEY.test(row.key ?? "") &&
      (target === "production"
        ? row.target?.includes("production") && !row.gitBranch
        : row.customEnvironmentIds?.includes(customEnvironmentId)),
  );
  if (!selected.length)
    throw new Error(
      "No application configuration found for the exact environment.",
    );
  // This command migrates the managed service specified by the release plan.
  // Make its account/workspace mode explicit even on older implicit-mode hosts.
  const values = { ATLAS_MANAGED: "true", ATLAS_MULTI_USER: "true" },
    missing = [];
  for (const row of selected) {
    if (selected.filter((item) => item.key === row.key).length !== 1)
      throw new Error(`Duplicate configuration for ${row.key}.`);
    if (
      !["plain", "encrypted", "sensitive", "secret"].includes(row.type) ||
      !/^[\w-]+$/.test(row.id ?? "")
    )
      throw new Error(`Unsupported provider configuration for ${row.key}.`);
    // Vercel write-only secrets cannot be recovered through its API. Only the
    // operator's existing secret-store export can supply those exact values.
    if (
      row.type === "sensitive" ||
      row.type === "secret" ||
      row.visibility === "secret"
    ) {
      if (
        !Object.hasOwn(existing, row.key) &&
        !Object.hasOwn(additional, row.key)
      )
        missing.push(row.key);
      else values[row.key] = existing[row.key] ?? additional[row.key];
      continue;
    }
    const variable = await read(`/v1/projects/${project}/env/${row.id}`);
    if (
      variable.key !== row.key ||
      typeof variable.value !== "string" ||
      (row.type === "encrypted" && variable.decrypted !== true)
    )
      throw new Error(
        `Value for ${row.key} was not decrypted or did not match its inventory.`,
      );
    if (
      Object.hasOwn(existing, row.key) &&
      existing[row.key] !== variable.value
    )
      throw new Error(`Existing value conflict for ${row.key}.`);
    values[row.key] = variable.value;
  }
  if (missing.length)
    throw new Error(
      `Existing write-only values are required for: ${missing.sort().join(", ")}.`,
    );
  // Explicit release configuration may add split credentials and operator roles
  // introduced after the old deployment. It cannot replace a retained identity,
  // enterprise setting, price, or signing secret with a different value.
  for (const [key, value] of Object.entries(additional)) {
    if (Object.hasOwn(values, key) && values[key] !== value)
      throw new Error(`Existing value conflict for ${key}.`);
    values[key] = value;
  }
  for (const key of Object.keys(existing))
    if (!Object.hasOwn(values, key))
      throw new Error(
        `Existing configuration ${key} is absent from the selected provider environment.`,
      );
    else if (existing[key] !== values[key])
      throw new Error(`Existing value conflict for ${key}.`);
  return loadWebRuntime(JSON.stringify(values));
}

function privateOutput(output, root) {
  const file = resolve(output),
    privateRoot = resolve(root, ".atlas");
  if (!file.startsWith(privateRoot + sep))
    throw new Error("Runtime output must remain under ignored .atlas/.");
  let path = dirname(file);
  while (path !== root) {
    if (
      existsSync(path) &&
      (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path)
    )
      throw new Error("Runtime output cannot follow directory links.");
    path = dirname(path);
  }
  if (
    existsSync(file) &&
    (lstatSync(file).isSymbolicLink() || lstatSync(file).nlink !== 1)
  )
    throw new Error("Runtime output cannot replace a linked file.");
  return file;
}
function github(binary, args, options) {
  const result = spawnSync(binary, args, {
    ...options,
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "GitHub runtime synchronization failed; provider output was suppressed.",
    );
}

export async function synchronizeWebRuntime({
  root = ROOT,
  output,
  doctor = false,
  syncGithub = false,
  tool = github,
  ...options
}) {
  root = resolve(root);
  const file = privateOutput(output, root);
  const runtime = await collectWebRuntime(options);
  if (!doctor) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = join(dirname(file), `.runtime-${randomUUID()}.json`);
    try {
      writeFileSync(temporary, JSON.stringify(runtime) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    if (syncGithub)
      tool(
        "gh",
        [
          "secret",
          "set",
          "ATLAS_WEB_RUNTIME_ENV_JSON",
          "--repo",
          "RebuildingAmerica/atlas",
          "--env",
          options.target,
        ],
        { input: JSON.stringify(runtime) },
      );
  }
  return {
    target: options.target,
    status: "pass",
    mode: doctor ? "doctor" : "sync",
    keys: Object.keys(runtime).sort(),
    githubSynchronized: !doctor && syncGithub,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (key) =>
    args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const result = await synchronizeWebRuntime({
    target: value("--target"),
    project: value("--project"),
    team: value("--team"),
    token: process.env.VERCEL_TOKEN,
    customEnvironmentId: value("--custom-environment"),
    existing: value("--existing-runtime")
      ? JSON.parse(readFileSync(value("--existing-runtime"), "utf8"))
      : {},
    output: value("--output"),
    doctor: args.includes("--doctor"),
    syncGithub: args.includes("--sync-github"),
  });
  console.log(JSON.stringify(result, null, 2));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error) => {
    // Only these locally constructed diagnostics may include configuration key names.
    const allowed =
      /^(?:Explicit target|Staging requires|Production cannot|Existing runtime|Vercel runtime read failed|Complete Vercel|No application|Duplicate configuration|Unsupported provider configuration|Value for [A-Z_]+ was not decrypted|Existing value conflict|Existing write-only values|Existing configuration|Runtime output|GitHub runtime)/;
    console.error(
      allowed.test(error.message)
        ? error.message
        : "Runtime synchronization failed; values and provider diagnostics were suppressed.",
    );
    process.exitCode = 1;
  });
