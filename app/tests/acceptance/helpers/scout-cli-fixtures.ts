import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeScoutHome } from "./scout-cli-core";

export interface ScoutHome {
  cleanup: () => Promise<void>;
  configPath: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  sessionPath: string;
}

export interface FixtureServer {
  close: () => Promise<void>;
  url: string;
}

interface OllamaMessage {
  content?: unknown;
  role?: unknown;
}

interface OllamaChatRequest {
  messages?: OllamaMessage[];
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
      await removeScoutHome(homeDir);
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
