import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { runCommand } from "../lib/shell.js";
import { parseEnvFile } from "../lib/env-file.js";
import type { CommandResult } from "../lib/types.js";

/**
 * Check whether the Stripe CLI is authenticated by hitting the /v1/account
 * endpoint. Returns true when the CLI can reach the API for the requested mode.
 */
export function isStripeCliAuthenticated(live: boolean): boolean {
  const modeFlag = live ? "--live" : "";
  const result = runCommand(
    `stripe get /v1/account ${modeFlag} 2>/dev/null | grep -q '"id"'`,
  );
  return result.ok;
}

/**
 * Read the Stripe secret API key directly from the Stripe CLI config file
 * (~/.config/stripe/config.toml). The CLI stores keys per-project; this reads
 * the default profile.
 *
 * Returns `null` if the file doesn't exist or the key isn't found.
 */
export function readStripeApiKeyFromCliConfig(live: boolean): string | null {
  const configPath = path.join(homedir(), ".config", "stripe", "config.toml");
  if (!existsSync(configPath)) return null;

  const content = readFileSync(configPath, "utf8");

  // The config.toml file has sections like [default] with key = "value" pairs.
  // We look for test_mode_api_key or live_mode_api_key depending on mode.
  const keyName = live ? "live_mode_api_key" : "test_mode_api_key";
  const lines = content.split("\n");

  let inDefaultSection = false;
  for (const line of lines) {
    const trimmed = line.trim();

    // Track which TOML section we're in
    if (trimmed.startsWith("[")) {
      inDefaultSection = trimmed === "[default]";
      continue;
    }

    if (!inDefaultSection) continue;

    if (trimmed.startsWith(keyName)) {
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value.length > 0) return value;
    }
  }

  return null;
}

/**
 * Resolve the Stripe API key from multiple sources, in priority order:
 *
 * 1. Stripe CLI config file (~/.config/stripe/config.toml)
 * 2. STRIPE_API_KEY environment variable
 * 3. Root .env file in the project
 *
 * Returns `null` if no key could be resolved.
 */
export function resolveStripeApiKey(
  projectRoot: string,
  live: boolean,
): string | null {
  // 1. Try Stripe CLI config
  const cliKey = readStripeApiKeyFromCliConfig(live);
  if (cliKey) return cliKey;

  // 2. Try environment variable
  const envKey = process.env.STRIPE_API_KEY;
  if (envKey && envKey.length > 0) return envKey;

  // 3. Try root .env file
  const envFilePath = path.join(projectRoot, ".env");
  const envEntries = parseEnvFile(envFilePath);
  const fileKey = envEntries.get("STRIPE_API_KEY");
  if (fileKey && fileKey.length > 0) return fileKey;

  return null;
}

/**
 * Execute the Stripe CLI with the given arguments. When `live` is true the
 * `--live` flag is appended automatically.
 */
export function runStripeCli(args: string[], live: boolean): CommandResult {
  const modeArgs = live ? [...args, "--live"] : args;
  const command = `stripe ${modeArgs.join(" ")}`;
  return runCommand(command);
}
