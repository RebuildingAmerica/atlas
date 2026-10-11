import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

/** Report only token format, so failed CI saves can be diagnosed without disclosure. */
export function cloudflareCredentialKind(token) {
  if (!token?.trim()) return "missing";
  if (/^cf(?:at|ut)_/.test(token)) {
    if (!/^cf(?:at|ut)_[A-Za-z0-9_-]{48}$/.test(token))
      return "invalid-scannable";
    return token.startsWith("cfat_") ? "account-scannable" : "user-scannable";
  }
  return "legacy";
}

/** Expose a closed set of diagnostic categories, never arbitrary provider messages. */
export class CloudflareCommandError extends Error {
  constructor(command, failure) {
    super(
      `cf ${command.slice(0, 2).join(" ")} failed (${failure}); provider output suppressed.`,
    );
    this.failure = failure;
  }
}

function failureCategory(result) {
  if (result.error?.code === "ENOENT") return "executable-not-found";
  if (result.error) return "process-error";
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/(?:status(?:\s+code|Code)?[\s":=]+|HTTP\s+)401\b/i.test(output))
    return "authentication";
  if (/(?:status(?:\s+code|Code)?[\s":=]+|HTTP\s+)403\b/i.test(output))
    return "permission-denied";
  return "nonzero-exit";
}

/** Keep Atlas account selection explicit and credentials out of argv and errors. */
export function cloudflareCommand(
  command,
  { body, env = process.env, runner = spawnSync, cwd = ROOT } = {},
) {
  if (!env.CLOUDFLARE_ACCOUNT_ID?.trim())
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required.");
  if (!env.CLOUDFLARE_API_TOKEN?.trim() && !env.ATLAS_CF_PROFILE?.trim())
    throw new Error("CLOUDFLARE_API_TOKEN or ATLAS_CF_PROFILE is required.");
  const args = ["exec", "cf", ...command];
  if (!env.CLOUDFLARE_API_TOKEN?.trim())
    args.push("--profile", env.ATLAS_CF_PROFILE);
  const temp =
    body === undefined ? null : mkdtempSync(join(tmpdir(), "atlas-cf-body-"));
  try {
    if (temp) {
      const file = join(temp, "body.json");
      writeFileSync(file, JSON.stringify(body), { mode: 0o600 });
      args.push("--body", `@${file}`);
    }
    const result = runner("pnpm", args, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new CloudflareCommandError(command, failureCategory(result));
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new CloudflareCommandError(command, "invalid-json");
    }
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}
