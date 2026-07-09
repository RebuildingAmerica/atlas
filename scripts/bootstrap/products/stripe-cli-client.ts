import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { runCommand } from "../lib/shell.js";
import { parseEnvFile } from "../lib/env-file.js";
import { isPlaceholder } from "../lib/secret.js";
import type { CommandResult } from "../lib/shell.js";

export interface StripeCliProfile {
  sectionName: string;
  values: Map<string, string>;
}

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

function unquoteTomlValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeProfileName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function sectionNameFromHeader(header: string): string {
  const rawName = header.trim().slice(1, -1).trim();
  return unquoteTomlValue(rawName);
}

export function parseStripeCliProfiles(content: string): StripeCliProfile[] {
  const profiles: StripeCliProfile[] = [];
  let current: StripeCliProfile | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      current = {
        sectionName: sectionNameFromHeader(trimmed),
        values: new Map(),
      };
      profiles.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = unquoteTomlValue(trimmed.slice(eqIndex + 1));
    current.values.set(key, value);
  }

  return profiles;
}

function readActiveStripeCliProfileName(): string | null {
  const result = runCommand("stripe login list 2>/dev/null");
  if (!result.ok) {
    return null;
  }

  for (const line of result.stdout.split("\n")) {
    const match = /^\s*\*\s+(.+?)(?:\s+\(active\))?\s*$/.exec(line);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function findProfileByName(
  profiles: StripeCliProfile[],
  profileName: string,
): StripeCliProfile | null {
  const normalizedTarget = normalizeProfileName(profileName);
  const explicitProfile =
    profiles.find((profile) =>
      [profile.sectionName, profile.values.get("profile_name") ?? ""].some(
        (candidate) =>
          candidate.length > 0 &&
          normalizeProfileName(candidate) === normalizedTarget,
      ),
    ) ?? null;
  if (explicitProfile) {
    return explicitProfile;
  }

  return (
    profiles.find(
      (profile) =>
        normalizeProfileName(profile.values.get("display_name") ?? "") ===
        normalizedTarget,
    ) ?? null
  );
}

export function selectStripeCliProfileKey(
  profiles: StripeCliProfile[],
  activeProfileName: string | null,
  live: boolean,
): string | null {
  const keyName = live ? "live_mode_api_key" : "test_mode_api_key";
  const activeProfile = activeProfileName
    ? findProfileByName(profiles, activeProfileName)
    : null;
  const defaultProfile =
    profiles.find(
      (profile) => normalizeProfileName(profile.sectionName) === "default",
    ) ?? null;
  const candidates = [activeProfile, defaultProfile, ...profiles];

  for (const profile of candidates) {
    const value = profile?.values.get(keyName)?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function usableStripeApiKey(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (
    !trimmed ||
    trimmed.includes("*") ||
    isPlaceholder(trimmed) ||
    /replace[_-]with/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function isRedactedStripeApiKey(value: string | undefined): boolean {
  return Boolean(value?.trim().includes("*"));
}

export function stripeApiKeyResolutionNotes(
  projectRoot: string,
  live: boolean,
  envFilePaths: string[] = [],
): string[] {
  const notes: string[] = [];

  for (const envFilePath of envFilePaths) {
    const value = parseEnvFile(envFilePath).get("STRIPE_API_KEY");
    if (isRedactedStripeApiKey(value)) {
      notes.push(
        `STRIPE_API_KEY in ${path.relative(projectRoot, envFilePath)} is redacted. Replace it with a full Stripe key or remove it so bootstrap can fall back.`,
      );
    }
  }

  if (live && isRedactedStripeApiKey(readStripeApiKeyFromCliConfig(true))) {
    notes.push(
      "Stripe CLI has a redacted live key. Bootstrap cannot use redacted CLI keys with the Stripe SDK; pass a Dashboard-created live restricted key as STRIPE_API_KEY.",
    );
  }

  return notes;
}

/**
 * Read the Stripe secret API key directly from the Stripe CLI config file
 * (~/.config/stripe/config.toml). The CLI stores keys per profile; this reads
 * the active CLI profile first, then falls back to the default profile.
 *
 * Returns `null` if the file doesn't exist or the key isn't found.
 */
export function readStripeApiKeyFromCliConfig(live: boolean): string | null {
  const configPath = path.join(homedir(), ".config", "stripe", "config.toml");
  if (!existsSync(configPath)) return null;

  const content = readFileSync(configPath, "utf8");
  return selectStripeCliProfileKey(
    parseStripeCliProfiles(content),
    readActiveStripeCliProfileName(),
    live,
  );
}

/**
 * Resolve the Stripe API key from multiple sources, in priority order:
 *
 * 1. STRIPE_API_KEY environment variable
 * 2. Target env files, such as .env.production or .env.staging
 * 3. Stripe CLI config file (~/.config/stripe/config.toml), test mode only
 * 4. Root .env file in the project, test mode only
 *
 * Production bootstrap intentionally skips Stripe CLI config and root `.env`
 * fallback state. The hosted app needs a Dashboard-created live restricted key
 * at runtime, and CLI live OAuth keys can be accepted by the CLI while still
 * being rejected by the Stripe SDK.
 *
 * Returns `null` if no key could be resolved.
 */
export function resolveStripeApiKey(
  projectRoot: string,
  live: boolean,
  envFilePaths: string[] = [],
): string | null {
  // 1. Try explicit environment variable
  const envKey = usableStripeApiKey(process.env.STRIPE_API_KEY);
  if (envKey) return envKey;

  // 2. Try target env files
  for (const envFilePath of envFilePaths) {
    const fileKey = usableStripeApiKey(
      parseEnvFile(envFilePath).get("STRIPE_API_KEY"),
    );
    if (fileKey) return fileKey;
  }

  if (live) {
    return null;
  }

  // 3. Try Stripe CLI config
  const cliKey = usableStripeApiKey(readStripeApiKeyFromCliConfig(false));
  if (cliKey) return cliKey;

  // 4. Try root .env file
  const envFilePath = path.join(projectRoot, ".env");
  const envEntries = parseEnvFile(envFilePath);
  const fileKey = usableStripeApiKey(envEntries.get("STRIPE_API_KEY"));
  if (fileKey) return fileKey;

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
