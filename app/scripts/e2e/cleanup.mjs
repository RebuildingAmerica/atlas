import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ports = [3100, 38000, 8025];
const e2eDir = path.join(process.cwd(), "node_modules", ".cache", "e2e");

async function runCommand(command, args) {
  const { spawn } = await import("node:child_process");

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
        return;
      }

      resolve(stdout);
    });
  });
}

async function listPortPids(port) {
  const output = await runCommand("lsof", ["-ti", `tcp:${port}`]);
  return output
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function killPort(port) {
  const pids = await listPortPids(port);
  if (pids.length === 0) {
    return;
  }

  await runCommand("kill", pids);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await listPortPids(port)).length === 0) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for port ${port} to be released.`);
}

for (const port of ports) {
  await killPort(port);
}

rmSync(e2eDir, { force: true, recursive: true });
mkdirSync(e2eDir, { recursive: true });
