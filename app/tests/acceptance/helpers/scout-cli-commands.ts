import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import {
  assertString,
  expectJsonResponse,
  jsonHeaders,
  parseScoutSession,
  type ScoutSessionFile,
} from "./scout-cli-core";
import { type ScoutHome } from "./scout-cli-fixtures";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

export interface ScoutCommandResult {
  exitCode: number | null;
  output: string;
  stderr: string;
  stdout: string;
}

interface ScoutProcess {
  kill: () => void;
  waitForExit: (timeoutMs?: number) => Promise<ScoutCommandResult>;
  waitForOutput: (pattern: RegExp, timeoutMs?: number) => Promise<RegExpMatchArray>;
}

interface ScoutCommand {
  args: string[];
  command: string;
}

function scoutCommand(): ScoutCommand {
  const override = process.env.ATLAS_E2E_SCOUT_BIN?.trim();
  if (override) {
    return { args: [], command: override };
  }

  return {
    args: ["--directory", path.join(process.cwd(), "..", "scout"), "run", "scout"],
    command: "uv",
  };
}

function spawnScout(args: string[], env: NodeJS.ProcessEnv): ScoutProcess {
  const command = scoutCommand();
  const child = spawn(command.command, [...command.args, ...args], {
    cwd: path.join(process.cwd(), ".."),
    env,
    stdio: "pipe",
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const output = () => `${stdout}${stderr}`;
  const closePromise = new Promise<ScoutCommandResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({
        exitCode,
        output: output(),
        stderr,
        stdout,
      });
    });
  });

  return {
    kill: () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
    waitForExit: (timeoutMs = 30_000) => waitForExit(child, closePromise, timeoutMs),
    waitForOutput: (pattern: RegExp, timeoutMs = 15_000) =>
      waitForOutput(child, output, pattern, timeoutMs),
  };
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  closePromise: Promise<ScoutCommandResult>,
  timeoutMs: number,
): Promise<ScoutCommandResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<ScoutCommandResult>((_, reject) => {
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      void closePromise
        .then((result) => {
          reject(
            new Error(
              `Scout command timed out after ${timeoutMs}ms. Output before termination:\n${result.output}`,
            ),
          );
        })
        .catch(() => {
          reject(new Error(`Scout command timed out after ${timeoutMs}ms.`));
        });
    }, timeoutMs);
  });
  return Promise.race([closePromise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  output: () => string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const match = stripVTControlCharacters(output()).match(pattern);
      if (match) {
        cleanup();
        resolve(match);
      }
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      cleanup();
      reject(
        new Error(`Timed out waiting for Scout output matching ${pattern}. Output:\n${output()}`),
      );
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", check);
      child.stderr.off("data", check);
      child.off("close", onClose);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Scout exited before output matched ${pattern}. Output:\n${output()}`));
    };
    child.stdout.on("data", check);
    child.stderr.on("data", check);
    child.once("close", onClose);
    check();
  });
}

interface ScoutCredentialFile {
  "session-token"?: unknown;
}

export interface ScoutApiTokenResponse {
  token: string;
  user: {
    email: string;
    id: string;
  };
  worker_id: string;
  workspace_id: string | null;
}

export interface DiscoveryRunCreateResponse {
  id: string;
}

export interface DiscoveryJobResponse {
  completed_at: string | null;
  id: string;
  progress: Record<string, unknown> | null;
  run_id: string;
  status: string;
}

export interface DiscoveryRunResponse {
  entries_confirmed: number;
  id: string;
  research_summary: {
    ranked_leads: { name: string }[];
  } | null;
  status: string;
}

export async function approveScoutLogin(
  page: Page,
  scoutHome: ScoutHome,
  appUrl: string,
): Promise<ScoutSessionFile> {
  const login = spawnScout(["login", "--atlas-url", appUrl, "--no-browser"], scoutHome.env);
  const match = await login.waitForOutput(
    /https?:\/\/\S+[\s\S]*\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/,
    45_000,
  );
  const approvalUrl = extractScoutApprovalUrl(match.input ?? "");
  const userCode =
    extractScoutUserCodeFromUrl(approvalUrl) ?? extractScoutUserCode(match.input ?? "");
  await page.goto(approvalUrl);
  await expect(page.getByRole("heading", { name: "Approve device" })).toBeVisible();
  const deviceCodeInput = page.getByRole("textbox", { name: "Device code" });
  if (!(await deviceCodeInput.inputValue())) {
    await deviceCodeInput.fill(userCode);
  }
  await page.getByRole("button", { name: "Approve device" }).click();
  await page.waitForURL((url) => url.pathname === "/device/approved");
  await expect(page.getByRole("heading", { name: "Device approved" })).toBeVisible();

  const result = await login.waitForExit(90_000);
  expect(result.exitCode, result.output).toBe(0);
  return readScoutSession(scoutHome.sessionPath);
}

function extractScoutApprovalUrl(output: string): string {
  const urls = output.match(/https?:\/\/\S+/g) ?? [];
  const approvalUrl = urls.find((url) => {
    if (!url.includes("user_code=")) {
      return false;
    }
    try {
      return new URL(url).pathname === "/device";
    } catch {
      return false;
    }
  });
  if (approvalUrl) {
    return approvalUrl;
  }
  const fallbackApprovalUrl = urls.find((url) => {
    if (url.includes("user_code=")) {
      return false;
    }
    try {
      return new URL(url).pathname === "/device";
    } catch {
      return false;
    }
  });
  return assertString(fallbackApprovalUrl, "approval URL");
}

function extractScoutUserCodeFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("user_code");
  } catch {
    return null;
  }
}

function extractScoutUserCode(output: string): string {
  const match = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/.exec(output);
  return assertString(match?.[0], "user code");
}

export async function readScoutSession(sessionPath: string): Promise<ScoutSessionFile> {
  const credentialPath = sessionPath.replace(/\.json$/, ".credentials.json");
  const credentials = JSON.parse(await readFile(credentialPath, "utf8")) as ScoutCredentialFile;
  const accessToken = assertString(credentials["session-token"], "session-token");
  return parseScoutSession(JSON.parse(await readFile(sessionPath, "utf8")), accessToken);
}

export async function exchangeScoutApiToken(
  appUrl: string,
  session: ScoutSessionFile,
): Promise<ScoutApiTokenResponse> {
  const response = await fetch(`${appUrl}/api/auth/scout/token`, {
    body: JSON.stringify({
      default_upload_target: "public",
      search_key_configured: false,
      worker_id: session.worker_id,
      worker_name: session.worker_name ?? "Atlas Scout E2E",
      workspace_id: null,
    }),
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  return expectJsonResponse<ScoutApiTokenResponse>(response);
}

export async function queueDirectUrlJob(
  apiUrl: string,
  token: string,
  seedUrl: string,
): Promise<DiscoveryRunCreateResponse> {
  const response = await fetch(`${apiUrl}/api/discovery-runs`, {
    body: JSON.stringify({
      direct_urls: [seedUrl],
      execution_mode: "direct_url",
      issue_areas: ["housing_affordability"],
      location_query: "Austin, TX",
      research_goal: "landscape_scan",
      state: "TX",
    }),
    headers: jsonHeaders(token),
    method: "POST",
  });
  return expectJsonResponse<DiscoveryRunCreateResponse>(response);
}

export async function findQueuedJob(
  apiUrl: string,
  token: string,
  runId: string,
): Promise<DiscoveryJobResponse> {
  const response = await fetch(`${apiUrl}/api/discovery-runs/jobs?limit=25`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await expectJsonResponse<{ items: DiscoveryJobResponse[] }>(response);
  const job = payload.items.find((item) => item.run_id === runId);
  if (!job) {
    throw new Error(`Queued job for run ${runId} was not visible in the job queue.`);
  }
  return job;
}

export async function getJob(
  apiUrl: string,
  token: string,
  jobId: string,
): Promise<DiscoveryJobResponse> {
  const response = await fetch(`${apiUrl}/api/discovery-runs/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return expectJsonResponse<DiscoveryJobResponse>(response);
}

export async function getRun(
  apiUrl: string,
  token: string,
  runId: string,
): Promise<DiscoveryRunResponse> {
  const response = await fetch(`${apiUrl}/api/discovery-runs/${runId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return expectJsonResponse<DiscoveryRunResponse>(response);
}

export function startScoutWorker(
  scoutHome: ScoutHome,
  appUrl: string,
): Promise<ScoutCommandResult> {
  return spawnScout(
    [
      "--config",
      scoutHome.configPath,
      "worker",
      "start",
      "--atlas-url",
      appUrl,
      "--interval",
      "1",
      "--lease-seconds",
      "30",
    ],
    scoutHome.env,
  ).waitForExit();
}

export function stopScoutWorker(scoutHome: ScoutHome): Promise<ScoutCommandResult> {
  return spawnScout(
    ["--config", scoutHome.configPath, "worker", "stop"],
    scoutHome.env,
  ).waitForExit();
}
