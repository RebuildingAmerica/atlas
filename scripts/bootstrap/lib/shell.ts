import { spawnSync } from "node:child_process";
import type { CommandResult } from "./types.js";

function resolveShell(): string {
  return process.env.SHELL ?? "sh";
}

export function runCommand(command: string): CommandResult {
  const result = spawnSync(resolveShell(), ["-c", command], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function commandOutput(result: CommandResult): string {
  if (result.stdout.length > 0) return result.stdout;
  if (result.stderr.length > 0) return result.stderr;
  return "no output";
}

export function summarizeOutputLine(result: CommandResult): string {
  return commandOutput(result).split("\n")[0].trim();
}

export function runInteractiveCommand(command: string): boolean {
  const result = spawnSync(resolveShell(), ["-c", command], {
    stdio: "inherit",
    env: process.env,
  });
  return result.status === 0;
}
