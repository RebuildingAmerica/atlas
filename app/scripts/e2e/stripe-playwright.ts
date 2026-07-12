import { spawn, type ChildProcessByStdio } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { STRIPE_BILLING_WEBHOOK_EVENTS } from "../../../scripts/bootstrap/config/products";
import { parseEnvFile } from "../../../scripts/bootstrap/lib/env-file";

const appRoot = process.cwd();
const repoRoot = path.join(appRoot, "..");
const billingAcceptancePath = "tests/acceptance/domains/billing/";

interface VideoArtifacts {
  artifactDir: string;
  filename: string;
  rawOutputDir: string;
  timestampsPath: string;
}

function envEntries(filePath: string): Record<string, string> {
  return Object.fromEntries(parseEnvFile(filePath));
}

function mergedEnv(): NodeJS.ProcessEnv {
  const envRoot = process.env.ATLAS_E2E_ENV_ROOT?.trim() || repoRoot;
  return {
    ...envEntries(path.join(envRoot, ".env")),
    ...envEntries(path.join(envRoot, "app", ".env.local")),
    ...process.env,
  };
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Atlas Stripe acceptance tests.`);
  }
  return value;
}

function resolveAppPath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return path.isAbsolute(trimmed) ? trimmed : path.join(appRoot, trimmed);
}

function shouldUseStripe(args: readonly string[]): boolean {
  if (process.env.ATLAS_E2E_STRIPE === "1") {
    return true;
  }
  if (process.env.ATLAS_E2E_STRIPE === "0") {
    return false;
  }
  const positionalArgs = args.filter((arg) => !arg.startsWith("-"));
  return (
    positionalArgs.length === 0 || positionalArgs.some((arg) => arg.includes(billingAcceptancePath))
  );
}

function waitForStripeSecret(
  listener: ChildProcessByStdio<null, Readable, Readable>,
  logPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Stripe listener signing secret."));
    }, 45_000);

    function inspect(chunk: Buffer): void {
      const text = chunk.toString();
      mkdirSync(path.dirname(logPath), { recursive: true });
      writeFileSync(logPath, text, { flag: "a" });
      const match = /whsec_[A-Za-z0-9_]+/.exec(text);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    }

    listener.stdout.on("data", inspect);
    listener.stderr.on("data", inspect);
    listener.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Stripe listener exited before it was ready: ${code ?? "signal"}.`));
    });
  });
}

function runPlaywright(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "playwright", "test", ...args], {
      cwd: appRoot,
      env,
      stdio: "inherit",
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`playwright test exited with ${code ?? "a signal"}.`));
    });
  });
}

function findWebmFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return findWebmFiles(entryPath);
    }
    return entry.name.endsWith(".webm") ? [entryPath] : [];
  });
}

function copyLargestVideo(
  rawOutputDir: string,
  artifactDir: string,
  filename: string,
): string | null {
  const videos = findWebmFiles(rawOutputDir).sort(
    (left, right) => statSync(right).size - statSync(left).size,
  );
  if (videos.length === 0) {
    return null;
  }

  const source = videos[0];
  if (!source) {
    return null;
  }

  const destination = path.join(artifactDir, filename);
  copyFileSync(source, destination);
  return destination;
}

function prepareVideoArtifacts(artifacts: VideoArtifacts): void {
  mkdirSync(artifacts.artifactDir, { recursive: true });
  writeFileSync(artifacts.timestampsPath, "# Atlas acceptance video timestamps\n\n");
  rmSync(artifacts.rawOutputDir, { force: true, recursive: true });
}

async function runPlaywrightWithArtifacts(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  artifacts: VideoArtifacts | null,
): Promise<void> {
  const playwrightArgs = artifacts ? [...args, "--output", artifacts.rawOutputDir] : args;
  await runPlaywright(playwrightArgs, {
    ...env,
    ...(artifacts ? { ATLAS_E2E_STEP_TIMESTAMPS_PATH: artifacts.timestampsPath } : {}),
  });

  if (!artifacts) {
    return;
  }

  const videoPath = copyLargestVideo(
    artifacts.rawOutputDir,
    artifacts.artifactDir,
    artifacts.filename,
  );
  if (!videoPath) {
    throw new Error("Playwright finished without producing an acceptance .webm video.");
  }
  process.stdout.write(`Acceptance video: ${videoPath}\n`);
  process.stdout.write(`Acceptance timestamps: ${artifacts.timestampsPath}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const env = mergedEnv();
  const listingOnly = args.includes("--list");
  const videoMode = env.ATLAS_E2E_VIDEO === "1" && !listingOnly;
  const videoArtifactDir = resolveAppPath(
    env.ATLAS_E2E_VIDEO_ARTIFACT_DIR,
    path.join(appRoot, "test-results", "acceptance-video"),
  );
  const videoFilename = env.ATLAS_E2E_VIDEO_NAME?.trim() || "atlas-acceptance.webm";
  const rawOutputDir = path.join(videoArtifactDir, "raw");
  const timestampsPath = resolveAppPath(
    env.ATLAS_E2E_STEP_TIMESTAMPS_PATH,
    path.join(videoArtifactDir, "acceptance-timestamps.md"),
  );
  const videoArtifacts = videoMode
    ? {
        artifactDir: videoArtifactDir,
        filename: videoFilename,
        rawOutputDir,
        timestampsPath,
      }
    : null;
  const listenerLogPath = resolveAppPath(
    env.ATLAS_E2E_STRIPE_LOG_PATH,
    path.join(appRoot, "test-results", "stripe", "listener.log"),
  );
  if (videoArtifacts) {
    prepareVideoArtifacts(videoArtifacts);
  }

  if (!shouldUseStripe(args)) {
    await runPlaywrightWithArtifacts(args, env, videoArtifacts);
    return;
  }

  requireValue(env, "STRIPE_API_KEY");
  requireValue(env, "STRIPE_ATLAS_CATALOG");

  mkdirSync(path.dirname(listenerLogPath), { recursive: true });
  writeFileSync(listenerLogPath, "");

  const appUrl = requireValue(env, "ATLAS_E2E_APP_URL");
  const listener = spawn(
    "stripe",
    [
      "listen",
      "--skip-verify",
      "--events",
      STRIPE_BILLING_WEBHOOK_EVENTS.join(","),
      "--forward-to",
      new URL("/api/stripe/webhook", appUrl).toString(),
    ],
    { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    const webhookSecret = await waitForStripeSecret(listener, listenerLogPath);
    await runPlaywrightWithArtifacts(
      args,
      {
        ...env,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      },
      videoArtifacts,
    );
    process.stdout.write(`Stripe listener log: ${listenerLogPath}\n`);
  } finally {
    listener.kill("SIGTERM");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
