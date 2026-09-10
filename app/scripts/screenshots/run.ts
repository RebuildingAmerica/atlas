import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  IMAGE_DIR,
  OUTPUT_DIR,
  RESULT_DIR,
  imagePath,
} from "../../tests/screenshots/capture-result";
import type { CaptureResult, ScreenshotMode } from "../../tests/screenshots/manifest-types";
import { CAPTURE_ROUTES } from "../../tests/screenshots/route-manifest";

const MODES: readonly ScreenshotMode[] = ["local", "session"];

interface ParsedArgs {
  modes: readonly ScreenshotMode[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const modeIndex = argv.indexOf("--mode");
  if (modeIndex === -1) {
    return { modes: MODES };
  }

  const requested = argv[modeIndex + 1];
  if (requested !== "local" && requested !== "session") {
    throw new Error('--mode must be either "local" or "session".');
  }

  return { modes: [requested] };
}

function report(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Every port the audit binds, across both passes.
 *
 * The local pass uses the base ports and the session pass the next one up, so the two passes
 * cannot collide with each other.
 */
const AUDIT_PORTS: readonly number[] = [3200, 3201, 38200, 38201, 8225, 8226];

const appDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cacheDir = resolvePath(appDir, "node_modules", ".cache", "screenshots");

/**
 * Clears a pass's databases so it starts from a known-empty state.
 *
 * Better Auth encrypts a key with the internal secret and stores it in the auth database, so a
 * database left behind by an earlier run makes every authenticated page 500 with a decryption
 * failure. This has to happen here rather than in the Playwright config: Playwright
 * re-evaluates the config in each worker process, and wiping there deletes the database out
 * from under the running API mid-run.
 */
async function clearDatabases(mode: ScreenshotMode): Promise<void> {
  const bases = [
    resolvePath(cacheDir, `atlas-api-${mode}.sqlite`),
    resolvePath(cacheDir, `atlas-auth-${mode}.sqlite`),
    resolvePath(cacheDir, `mailbox-${mode}.json`),
  ];
  for (const base of bases) {
    for (const suffix of ["", "-shm", "-wal", "-journal"]) {
      await rm(`${base}${suffix}`, { force: true });
    }
  }
}

function sh(command: string): Promise<string> {
  return new Promise((done) => {
    const child = spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("close", () => {
      done(out.trim());
    });
  });
}

async function listenersOn(port: number): Promise<string[]> {
  const out = await sh(`lsof -ti tcp:${port} 2>/dev/null`);
  return out === "" ? [] : out.split("\n");
}

/**
 * Frees the audit's ports, killing whatever still holds them.
 *
 * Turbo orphans the API process it spawns, so a killed or crashed run leaves a server
 * listening. Left alone it answers the next run from a stale database and every page captures
 * cleanly against the wrong data -- an audit that quietly lies is worse than one that fails.
 *
 * Each listener is killed by process group: the API runs under uvicorn's reloader, which
 * immediately respawns a worker killed on its own. The ports are the audit's own, so
 * reclaiming them is safe.
 */
async function reclaimPorts(): Promise<void> {
  const held = new Map<number, string[]>();
  for (const port of AUDIT_PORTS) {
    const pids = await listenersOn(port);
    if (pids.length > 0) {
      held.set(port, pids);
    }
  }

  if (held.size === 0) {
    return;
  }

  report(`Reclaiming ports held by a previous run: ${[...held.keys()].join(", ")}`);
  for (const pids of held.values()) {
    for (const pid of pids) {
      // Kill the whole group so uvicorn's reloader goes down with its worker.
      await sh(`PGID=$(ps -o pgid= -p ${pid} | tr -d ' '); [ -n "$PGID" ] && kill -9 -"$PGID"`);
      await sh(`kill -9 ${pid} 2>/dev/null`);
    }
  }

  await new Promise((wake) => setTimeout(wake, 2000));

  const stillHeld: number[] = [];
  for (const port of AUDIT_PORTS) {
    if ((await listenersOn(port)).length > 0) {
      stillHeld.push(port);
    }
  }

  if (stillHeld.length > 0) {
    throw new Error(
      `Ports still in use after cleanup: ${stillHeld.join(", ")}. Stop whatever owns them ` +
        `before running the audit.`,
    );
  }
}

function runPass(mode: ScreenshotMode): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(
      "pnpm",
      ["exec", "playwright", "test", "--config", "playwright.screenshots.config.ts"],
      {
        env: { ...process.env, ATLAS_SCREENSHOTS_MODE: mode },
        stdio: "inherit",
      },
    );
    child.on("close", (code) => {
      resolveExit(code ?? 1);
    });
  });
}

async function readResults(): Promise<CaptureResult[]> {
  if (!existsSync(RESULT_DIR)) {
    return [];
  }

  const files = (await readdir(RESULT_DIR)).filter((file) => file.endsWith(".json"));
  const results: CaptureResult[] = [];
  for (const file of files) {
    const raw = await readFile(resolve(RESULT_DIR, file), "utf8");
    results.push(JSON.parse(raw) as CaptureResult);
  }
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

function areaOf(result: CaptureResult): string {
  const path = result.routeId;
  if (path.startsWith("/admin")) {
    return "Admin";
  }
  if (
    ["/setup", "/sign-in", "/sign-up", "/device", "/oauth", "/accept-invitation"].some((p) =>
      path.startsWith(p),
    )
  ) {
    return "Auth";
  }
  if (
    ["/account", "/organization", "/checkout-complete", "/onboarding", "/pricing"].some((p) =>
      path.startsWith(p),
    )
  ) {
    return "Account & billing";
  }
  if (
    ["/home", "/discovery", "/coverage", "/briefs", "/lists", "/watching", "/feed", "/manage"].some(
      (p) => path.startsWith(p),
    )
  ) {
    return "Workspace";
  }
  return "Public";
}

function renderIndex(results: readonly CaptureResult[]): string {
  const byArea = new Map<string, CaptureResult[]>();
  for (const result of results) {
    const area = areaOf(result);
    byArea.set(area, [...(byArea.get(area) ?? []), result]);
  }

  const lines = [
    "# Atlas full-app screenshot audit",
    "",
    `Captured ${results.length} pages at 1440px, light theme.`,
    "",
  ];

  for (const [area, entries] of [...byArea.entries()].sort()) {
    lines.push(`## ${area}`, "");
    lines.push("| Page | Route | Status | Notes |", "| --- | --- | --- | --- |");
    for (const entry of entries) {
      const notes = [
        entry.note,
        entry.error === null ? null : `Error: ${entry.error}`,
        entry.pageErrors.length > 0 ? `${entry.pageErrors.length} page error(s)` : null,
        entry.consoleErrors.length > 0 ? `${entry.consoleErrors.length} console error(s)` : null,
        entry.fontsLoaded ? null : "Webfont did not load",
      ]
        .filter((value): value is string => value !== null)
        .join(" — ");
      lines.push(
        `| [${entry.name}](desktop-light/${entry.name}.png) | \`${entry.routeId}\` | ${entry.status} | ${notes || "—"} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const { modes } = parseArgs(process.argv.slice(2));
  await reclaimPorts();

  if (modes.length === MODES.length) {
    await rm(OUTPUT_DIR, { force: true, recursive: true });
  }
  await mkdir(IMAGE_DIR, { recursive: true });

  for (const mode of modes) {
    report(`\n=== Capturing ${mode} pass ===\n`);
    await clearDatabases(mode);
    await runPass(mode);
    // The passes use different ports, but a leaked server would still outlive the whole run.
    await reclaimPorts();
  }

  const results = await readResults();
  await writeFile(
    resolve(OUTPUT_DIR, "report.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8",
  );
  await writeFile(resolve(OUTPUT_DIR, "index.md"), renderIndex(results), "utf8");

  const expected = CAPTURE_ROUTES.filter((route) => modes.includes(route.mode));
  const missing = expected.filter((route) => !existsSync(imagePath(route.name)));

  const byStatus = new Map<string, number>();
  for (const result of results) {
    byStatus.set(result.status, (byStatus.get(result.status) ?? 0) + 1);
  }

  report("\n=== Screenshot audit summary ===");
  for (const [status, count] of [...byStatus.entries()].sort()) {
    report(`  ${status.padEnd(11)} ${count}`);
  }
  report(`  ${"images".padEnd(11)} ${expected.length - missing.length}/${expected.length}`);
  report(`\nReport: ${resolve(OUTPUT_DIR, "index.md")}`);

  for (const result of results.filter((entry) => entry.status !== "ok")) {
    report(`  ! ${result.name} (${result.status}) ${result.error ?? ""}`);
  }

  if (missing.length > 0) {
    process.stderr.write(`\nMissing captures: ${missing.map((route) => route.name).join(", ")}\n`);
    process.exitCode = 1;
  }
}

await main();
