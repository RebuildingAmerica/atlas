#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// Keep Wrangler's binding inference without augmenting the browser/Node globals
// used by the TanStack application and its tests.
for (const [directory, name, binding] of [
  ["app", "AtlasWorkerEnv", "Hyperdrive"],
  ["services/web-edge", "AtlasEdgeEnv", "Fetcher"],
]) {
  const file = `${directory}/worker-configuration.d.ts`;
  const before = process.argv.includes("--check")
    ? readFileSync(file, "utf8")
    : null;
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "types",
      file,
      "--config",
      `${directory}/wrangler.jsonc`,
      "--env-interface",
      name,
      "--include-runtime",
      "false",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  const generated = readFileSync(file, "utf8");
  const module = `import type { ${binding} } from '@cloudflare/workers-types';\n${generated}\nexport type { ${name} };\n`;
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
