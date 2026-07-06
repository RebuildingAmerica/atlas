import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { expect, type Page } from "@playwright/test";

export interface ScoutHome {
  cleanup: () => Promise<void>;
  configPath: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  sessionPath: string;
}

export interface ScoutSessionFile {
  access_token: string;
  atlas_url: string;
  default_upload_target: "public" | "workspace";
  user_email: string;
  user_id: string;
  worker_id: string;
  worker_name: string | null;
  workspace_id: string | null;
}

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

export interface FixtureServer {
  close: () => Promise<void>;
  url: string;
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

interface OllamaMessage {
  content?: unknown;
  role?: unknown;
}

interface OllamaChatRequest {
  messages?: OllamaMessage[];
}

interface ScoutCommand {
  args: string[];
  command: string;
}

interface DeviceStatusResponse {
  status: "approved" | "denied" | "pending";
  user_code: string;
}

interface ScoutCredentialFile {
  "session-token"?: unknown;
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

function configDir(homeDir: string): string {
  if (process.platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "atlas-scout");
  }
  if (process.platform === "win32") {
    return path.join(homeDir, "AppData", "Roaming", "atlas-scout");
  }
  return path.join(homeDir, ".config", "atlas-scout");
}

function scoutEnv(homeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATLAS_SCOUT_E2E_FILE_CREDENTIAL_STORE: "1",
    HOME: homeDir,
    NO_COLOR: "1",
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    XDG_DATA_HOME: path.join(homeDir, ".local", "share"),
  };
  delete env.FORCE_COLOR;
  return env;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  return value;
}

function assertNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null.`);
  }
  return value;
}

function parseScoutSession(payload: unknown, accessToken: string): ScoutSessionFile {
  if (!payload || typeof payload !== "object") {
    throw new Error("Scout session file must be an object.");
  }
  const record = payload as Record<string, unknown>;
  const target = assertString(record.default_upload_target, "default_upload_target");
  if (target !== "public" && target !== "workspace") {
    throw new Error("default_upload_target must be public or workspace.");
  }
  return {
    access_token: accessToken,
    atlas_url: assertString(record.atlas_url, "atlas_url"),
    default_upload_target: target,
    user_email: assertString(record.user_email, "user_email"),
    user_id: assertString(record.user_id, "user_id"),
    worker_id: assertString(record.worker_id, "worker_id"),
    worker_name: assertNullableString(record.worker_name, "worker_name"),
    workspace_id: assertNullableString(record.workspace_id, "workspace_id"),
  };
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, payload: unknown): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function expectJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  return JSON.parse(body) as T;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Fixture server did not expose a TCP address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function allMessageContent(request: OllamaChatRequest): string {
  const messages = request.messages ?? [];
  return messages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");
}

function ollamaContentFor(request: OllamaChatRequest): string {
  if (allMessageContent(request).includes("IDENTIFIED ENTITIES")) {
    return JSON.stringify({
      discovery_leads: [],
      entries: [
        {
          affiliated_org: null,
          city: "Austin",
          description: "Organizes tenants locally in Austin.",
          email: "hello@tenant.example",
          extraction_context: "Tenant Defense Collective organizes tenants locally in Austin.",
          geo_specificity: "local",
          issue_areas: ["housing_affordability"],
          name: "Tenant Defense Collective",
          social_media: {},
          state: "TX",
          type: "organization",
          website: "https://tenant.example",
        },
      ],
    });
  }

  return JSON.stringify([
    {
      name: "Tenant Defense Collective",
      quote: "Tenant Defense Collective organizes tenants locally in Austin.",
      type: "organization",
    },
  ]);
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

export async function createScoutHome(ollamaUrl: string): Promise<ScoutHome> {
  const homeDir = await mkdtemp(path.join(tmpdir(), "atlas-scout-e2e-"));
  const configPath = path.join(homeDir, "worker.toml");
  const dbPath = path.join(homeDir, "scout.db");
  const sessionPath = path.join(configDir(homeDir), "session.json");
  await writeFile(
    configPath,
    [
      "[llm]",
      'provider = "ollama"',
      'model = "atlas-e2e"',
      `ollama_base_url = "${ollamaUrl}"`,
      "max_concurrent = 1",
      "timeout_seconds = 10",
      "",
      "[scraper]",
      "follow_links = false",
      "max_concurrent_fetches = 1",
      "max_link_depth = 0",
      "max_pages_per_seed = 1",
      "request_delay_ms = 0",
      "",
      "[pipeline]",
      "iterative_deepening = false",
      "min_entry_score = 0.0",
      "",
      "[store]",
      `path = "${dbPath}"`,
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    cleanup: async () => {
      if (process.env.ATLAS_E2E_KEEP_SCOUT_HOME === "1") {
        process.stderr.write(`Preserved Scout E2E home: ${homeDir}\n`);
        return;
      }
      await rm(homeDir, { force: true, recursive: true });
    },
    configPath,
    env: scoutEnv(homeDir),
    homeDir,
    sessionPath,
  };
}

export async function startSeedPageServer(): Promise<FixtureServer> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`
      <html>
        <head><title>Tenant organizing in Austin</title></head>
        <body>
          <main>
            <h1>Tenant Defense Collective</h1>
            <p>
              Tenant Defense Collective organizes tenants locally in Austin.
              The member-led organization helps renters document repair
              problems, understand eviction notices, and negotiate with
              property managers before displacement becomes unavoidable.
            </p>
            <p>
              The group works on housing affordability and tenant defense
              across several central Texas neighborhoods. Volunteers host
              weekly clinics, publish plain-language guides, and coordinate
              outreach with legal aid partners when residents need help finding
              source-backed information about their rights.
            </p>
          </main>
        </body>
      </html>
    `);
  });
  const url = await listen(server);
  return {
    close: () => closeServer(server),
    url: `${url}/seed`,
  };
}

export async function startFixtureOllamaServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/api/tags") {
      sendJson(response, {
        models: [{ name: "atlas-e2e" }],
      });
      return;
    }

    if (request.method !== "POST" || request.url !== "/api/chat") {
      response.writeHead(404);
      response.end();
      return;
    }
    void readBody(request)
      .then((body) => {
        const payload = JSON.parse(body) as OllamaChatRequest;
        sendJson(response, {
          eval_count: 1,
          message: {
            content: ollamaContentFor(payload),
            role: "assistant",
          },
          prompt_eval_count: 1,
        });
      })
      .catch((error: unknown) => {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end(error instanceof Error ? error.message : "fixture server failed");
      });
  });
  const url = await listen(server);
  return {
    close: () => closeServer(server),
    url,
  };
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
  const userCode = extractScoutUserCode(match.input ?? "");
  await page.goto(approvalUrl);
  await expect(page.getByRole("heading", { name: "Approve device" })).toBeVisible();
  const deviceCodeInput = page.getByRole("textbox", { name: "Device code" });
  if (!(await deviceCodeInput.inputValue())) {
    await deviceCodeInput.fill(userCode);
  }
  await page.getByRole("button", { name: "Approve device" }).click();
  await page.waitForURL((url) => url.pathname === "/device/approved");
  await expect(page.getByRole("heading", { name: "Device approved" })).toBeVisible();
  const statusResponse = await page.request.get(
    `/device/status?user_code=${encodeURIComponent(userCode)}`,
  );
  expect(statusResponse.ok(), await statusResponse.text()).toBe(true);
  const status = (await statusResponse.json()) as DeviceStatusResponse;
  expect(status.status).toBe("approved");

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
