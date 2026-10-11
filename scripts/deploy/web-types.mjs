#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// Keep cf's binding inference without augmenting the browser/Node globals
// used by the TanStack application and its tests.
for (const [directory, name] of [
  ["app", "AtlasWorkerEnv"],
  ["services/web-edge", "AtlasEdgeEnv"],
]) {
  const file = `${directory}/worker-configuration.d.ts`;
  const before = process.argv.includes("--check")
    ? readFileSync(file, "utf8")
    : null;
  const result = spawnSync(
    "pnpm",
    ["exec", "cf", "workers", "types", "--no-include-runtime"],
    { cwd: directory, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  const generated = readFileSync(
    `${directory}/.cloudflare/types/index.d.ts`,
    "utf8",
  ).replaceAll('"../../cloudflare.config"', '"./cloudflare.config"');
  const module = `${generated}\nexport type { Env as ${name} };\n`;
  writeFileSync(file, module);
  const formatted = spawnSync(
    "pnpm",
    [
      "--filter",
      "@rebuildingamerica/atlas-app",
      "exec",
      "prettier",
      "--write",
      new URL("../../" + file, import.meta.url).pathname,
    ],
    { stdio: "inherit" },
  );
  if (formatted.status !== 0) process.exit(formatted.status ?? 1);
  if (before !== null && before !== readFileSync(file, "utf8")) {
    console.error(`${file} is stale; run pnpm web:types.`);
    process.exitCode = 1;
  }
}
