#!/usr/bin/env node
import { spawn } from "node:child_process";

const PORTLESS_NAME = "docs.atlas";
const PORTLESS_PORT = process.env.PORTLESS_PORT || "1355";
const LOCAL_PREVIEW_PATTERN = /local\s+.*?http:\/\/localhost:(\d+)/i;

let activeAliasPort = null;
let child = null;
let shuttingDown = false;

function stripAnsi(value) {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(command, args, {
      stdio: options.stdio ?? "pipe",
      env: process.env,
    });

    let stderr = "";
    processHandle.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    processHandle.on("error", reject);
    processHandle.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`),
      );
    });
  });
}

async function ensureProxy() {
  await run(
    "pnpm",
    ["exec", "portless", "proxy", "start", "--port", PORTLESS_PORT, "--https"],
    {
      stdio: "ignore",
    },
  );
}

async function registerAlias(port) {
  if (activeAliasPort === port) {
    return;
  }

  await run(
    "pnpm",
    ["exec", "portless", "alias", PORTLESS_NAME, port, "--force"],
    {
      stdio: "ignore",
    },
  );
  activeAliasPort = port;
  process.stdout.write(
    `[portless-docs] https://${PORTLESS_NAME}.localhost:${PORTLESS_PORT} -> localhost:${port}\n`,
  );
}

async function removeAlias() {
  if (!activeAliasPort) {
    return;
  }

  try {
    await run(
      "pnpm",
      ["exec", "portless", "alias", "--remove", PORTLESS_NAME],
      {
        stdio: "ignore",
      },
    );
  } catch {
    // The proxy may already be gone during shutdown.
  }
}

function handleOutput(chunk, stream) {
  stream.write(chunk);

  const clean = stripAnsi(chunk.toString());
  const match = clean.match(LOCAL_PREVIEW_PATTERN);
  const port = match?.[1];
  if (port) {
    void registerAlias(port).catch((error) => {
      process.stderr.write(`[portless-docs] ${error.message}\n`);
    });
  }
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (child && !child.killed) {
    child.kill(signal);
  }

  await removeAlias();
}

async function main() {
  if (process.env.PORTLESS === "0") {
    child = spawn("mint", ["dev", ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
    });
  } else {
    await ensureProxy();
    child = spawn("mint", ["dev", ...process.argv.slice(2)], {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
    });
    child.stdout.on("data", (chunk) => {
      handleOutput(chunk, process.stdout);
    });
    child.stderr.on("data", (chunk) => {
      handleOutput(chunk, process.stderr);
    });
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  child.on("close", async (code, signal) => {
    await removeAlias();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
