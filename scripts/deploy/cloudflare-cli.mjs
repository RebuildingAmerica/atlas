import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

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
      throw new Error(
        `cf ${command.slice(0, 3).join(" ")} failed; provider output was suppressed to protect credentials.`,
      );
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(
        "cf returned an invalid JSON result; provider output was suppressed.",
      );
    }
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}
