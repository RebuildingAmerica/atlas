#!/usr/bin/env node
// Validate every Turbo task selector (`<package>#<task>` or `//#<task>`)
// referenced in repo config and scripts. Bad selectors silently no-op when
// invoked via `turbo run`, so a stale rename can ship without anyone noticing
// until CI fails. This script extracts selectors and runs them through
// `turbo run --dry=json` so any unresolvable scope or task fails fast.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

// Files most likely to reference selectors. Restrict scope so we don't
// false-match on anchors in markdown or generated artifacts.
const trackedGlobs = [
  "package.json",
  "turbo.json",
  "*/package.json",
  "*/turbo.json",
  "packages/*/package.json",
  ".github/workflows/*.yml",
  ".github/workflows/*.yaml",
  ".githooks/*",
  "scripts/*.sh",
  "scripts/*.mjs",
  "scripts/*.ts",
  "scripts/bootstrap/**/*.ts",
];

const lsFiles = execFileSync(
  "git",
  ["ls-files", "--", ...trackedGlobs],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

// Match: optional opening quote, then `<scope>#<task>` where scope is `//`
// or a npm package name (with optional @scope/), and task may use `:` or `-`.
// Word-ish boundaries on both sides to avoid matching URL fragments.
const SELECTOR = /(?<![A-Za-z0-9._/-])((?:@[\w.-]+\/)?[\w.-]+|\/\/)#([A-Za-z][\w:.-]*)(?![A-Za-z0-9])/g;

// Anything that doesn't make sense as a package: e.g. URL anchors, html ids.
// Heuristic: skip selectors whose scope contains a `.` AND a path-y suffix.
function looksLikePackageName(scope) {
  if (scope === "//") return true;
  if (scope.includes("/") && !scope.startsWith("@")) return false; // a/b#c is a path
  return true;
}

const selectors = new Map(); // selector -> set of "file:line"

for (const rel of lsFiles) {
  const abs = resolve(repoRoot, rel);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(SELECTOR)) {
      const [, scope, task] = m;
      if (!looksLikePackageName(scope)) continue;
      // Skip the "extends": ["//"] hint — that's not a selector.
      if (scope === "//" && task === "extends") continue;
      const sel = `${scope}#${task}`;
      if (!selectors.has(sel)) selectors.set(sel, new Set());
      selectors.get(sel).add(`${rel}:${idx + 1}`);
    }
  });
}

if (selectors.size === 0) {
  console.log("No turbo selectors found.");
  process.exit(0);
}

const sorted = [...selectors.keys()].sort();
console.log(`Validating ${sorted.length} turbo selectors via 'turbo run --dry=json'...`);

// Validate each selector individually so we can report the exact failing one.
// Turbo aborts on first bad selector when batched, which makes batched mode
// less useful for a "show me everything that's broken" report.
const failures = [];
for (const sel of sorted) {
  const result = spawnSync(
    "pnpm",
    ["exec", "turbo", "run", sel, "--dry"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    failures.push({
      selector: sel,
      sites: [...selectors.get(sel)],
      stderr: (result.stderr || result.stdout || "").trim(),
    });
  }
}

if (failures.length === 0) {
  console.log(`All ${sorted.length} selectors resolve.`);
  process.exit(0);
}

console.error(`\nFound ${failures.length} unresolvable turbo selector(s):\n`);
for (const f of failures) {
  console.error(`  ${f.selector}`);
  for (const site of f.sites) console.error(`    referenced at ${site}`);
  const msg = f.stderr.split("\n").slice(0, 3).join("\n      ");
  if (msg) console.error(`    turbo: ${msg}`);
  console.error("");
}
console.error(
  "Fix: rename the selector, the package name, or the task to match the workspace.",
);
process.exit(1);
