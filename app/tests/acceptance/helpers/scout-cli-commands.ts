import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import {
  assertString,
  expectJsonResponse,
  jsonHeaders,
  parseScoutSession,
  spawnScout,
} from "./scout-cli";
import type {
  DiscoveryJobResponse,
  DiscoveryRunCreateResponse,
  DiscoveryRunResponse,
  ScoutApiTokenResponse,
  ScoutCommandResult,
  ScoutHome,
  ScoutSessionFile,
} from "./scout-cli";

interface ScoutCredentialFile {
  "session-token"?: unknown;
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

export async function startScoutWorker(
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

export async function stopScoutWorker(scoutHome: ScoutHome): Promise<ScoutCommandResult> {
  return spawnScout(
    ["--config", scoutHome.configPath, "worker", "stop"],
    scoutHome.env,
  ).waitForExit();
}
