#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { loadWebRuntime, runtimeInput } from "./web-candidate.mjs";
const separator = process.argv.indexOf("--");
if (separator < 0 || !process.argv[separator + 1])
  throw new Error("Supply a command after --.");
let runtime;
try {
  runtime = loadWebRuntime(runtimeInput());
} catch {
  console.error(
    "Managed runtime JSON is missing or invalid; no credential values were printed.",
  );
  process.exit(1);
}
const result = spawnSync(
  process.argv[separator + 1],
  process.argv.slice(separator + 2),
  { env: { ...process.env, ...runtime }, stdio: "inherit" },
);
process.exit(result.status ?? 1);
