import { existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { log, text, password } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { parseEnvFile, mergeEnvFile } from "../lib/env-file.js";
import { generateSecret, isPlaceholder } from "../lib/secret.js";
import { promptOrExit, logSubline } from "../lib/ui.js";
import type { ReadinessState } from "../state.js";
import {
  getVercelScope,
  detectAndLink,
  syncEnvVars,
  type VercelVar,
  type VercelEnvironment,
} from "../lib/vercel.js";

const AUTO_GENERATED_SECRETS = new Set(["ATLAS_AUTH_INTERNAL_SECRET"]);

const REQUIRED_KEYS: Record<string, { prompt: string; sensitive: boolean }> = {
  ANTHROPIC_API_KEY: { prompt: "Anthropic API key", sensitive: true },
};

const OPTIONAL_PROMPTED_KEYS: Record<
  string,
  { prompt: string; sensitive: boolean }
> = {
  ATLAS_EMAIL_RESEND_API_KEY: {
    prompt: "Resend API key (for email delivery, leave blank to skip)",
    sensitive: true,
  },
  SEARCH_API_KEY: {
    prompt: "Search API key (optional, leave blank to skip)",
    sensitive: true,
  },
};

interface EnvFileSpec {
  target: string;
  example: string;
  label: string;
}

export async function runEnvPhase(
  projectRoot: string,
  doctorMode: boolean,
  state: ReadinessState,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];

  const envFiles: EnvFileSpec[] = [
    { target: ".env", example: ".env.example", label: "Root .env" },
    { target: "api/.env", example: "api/.env.example", label: "API .env" },
    {
      target: "app/.env.local",
      example: "app/.env.example",
      label: "App .env.local",
    },
    {
      target: "app/.env.e2e",
      example: "app/.env.e2e.example",
      label: "App .env.e2e",
    },
  ];

  // Step 1: Ensure env files exist from examples
  for (const spec of envFiles) {
    const targetPath = path.join(projectRoot, spec.target);
    const examplePath = path.join(projectRoot, spec.example);

    if (!existsSync(examplePath)) {
      logSubline(pc.dim(`${spec.label}: no .env.example found, skipping`));
      continue;
    }

    if (existsSync(targetPath)) {
      logSubline(`${spec.label}: exists`);
    } else {
      if (doctorMode) {
        log.warn(`${spec.label}: missing (would copy from example)`);
        followUpItems.push(`Copy ${spec.example} to ${spec.target}`);
        continue;
      }
      copyFileSync(examplePath, targetPath);
      log.success(`${spec.label}: created from example`);
    }
  }

  if (doctorMode) {
    return { success: followUpItems.length === 0, followUpItems };
  }

  // Step 2: Auto-generate secrets
  const rootEnvPath = path.join(projectRoot, ".env");
  const rootEnv = parseEnvFile(rootEnvPath);
  const updates = new Map<string, string>();

  for (const key of AUTO_GENERATED_SECRETS) {
    const current = rootEnv.get(key);
    if (!current || isPlaceholder(current)) {
      const secret = generateSecret();
      updates.set(key, secret);
      logSubline(`${key}: auto-generated`);
    }
  }

  // Step 3: Prompt for required keys
  for (const [key, config] of Object.entries(REQUIRED_KEYS)) {
    const current = rootEnv.get(key);
    if (current && !isPlaceholder(current)) continue;

    const value = await promptOrExit(
      config.sensitive
        ? password({ message: config.prompt })
        : text({ message: config.prompt }),
    );

    if (typeof value === "string" && value.trim()) {
      updates.set(key, value.trim());
    } else {
      followUpItems.push(`Set ${key} in .env`);
    }
  }

  // Step 4: Prompt for optional keys
  for (const [key, config] of Object.entries(OPTIONAL_PROMPTED_KEYS)) {
    const current = rootEnv.get(key);
    if (current && !isPlaceholder(current)) continue;

    const value = await promptOrExit(
      config.sensitive
        ? password({ message: config.prompt })
        : text({ message: config.prompt }),
    );

    if (typeof value === "string" && value.trim()) {
      updates.set(key, value.trim());
    }
  }

  // Step 5: Write updates
  if (updates.size > 0) {
    mergeEnvFile(rootEnvPath, updates);
    log.success(`Updated ${rootEnvPath} with ${updates.size} values`);

    // Propagate shared keys to API and app env files
    const sharedKeys = ["ATLAS_AUTH_INTERNAL_SECRET", "ANTHROPIC_API_KEY"];
    for (const envSpec of envFiles.slice(1)) {
      const targetPath = path.join(projectRoot, envSpec.target);
      if (!existsSync(targetPath)) continue;

      const envUpdates = new Map<string, string>();
      for (const key of sharedKeys) {
        const value = updates.get(key);
        if (value) envUpdates.set(key, value);
      }
      if (envUpdates.size > 0) {
        mergeEnvFile(targetPath, envUpdates);
      }
    }
  }

  // Step 6: Sync to Vercel if deploy-vercel capability is ready
  if (state.capabilities["deploy-vercel"]?.status === "ready") {
    const appDir = path.join(projectRoot, "app");
    await detectAndLink(appDir);

    const scope = getVercelScope(appDir);
    if (scope) {
      const mergedEnv = parseEnvFile(rootEnvPath);
      const varsToSync = buildVercelEnvVars(mergedEnv);
      await syncEnvVars(varsToSync, scope);
    } else {
      followUpItems.push(
        "Vercel project not linked — run `vercel link` in app/ then re-run bootstrap",
      );
    }
  }

  return { success: true, followUpItems };
}

function buildVercelEnvVars(env: Map<string, string>): VercelVar[] {
  const all: VercelEnvironment[] = ["production", "preview", "development"];
  const prod: VercelEnvironment[] = ["production"];

  function get(key: string, fallback?: string): string | undefined {
    const v = env.get(key);
    return v !== undefined && !isPlaceholder(v) ? v : fallback;
  }

  const vars: VercelVar[] = [];
  function add(
    key: string,
    value: string | undefined,
    environments: VercelEnvironment[],
  ): void {
    if (value) vars.push({ key, value, environments });
  }

  add("NITRO_PRESET", "vercel", all);
  add("ATLAS_AUTH_BASE_PATH", get("ATLAS_AUTH_BASE_PATH", "/api/auth"), all);
  add("ATLAS_DEPLOY_MODE", "local", ["preview"]);
  add("ATLAS_PUBLIC_URL", get("ATLAS_PUBLIC_URL"), prod);
  add("ATLAS_API_AUDIENCE", get("ATLAS_API_AUDIENCE"), prod);
  add("ATLAS_EMAIL_PROVIDER", get("ATLAS_EMAIL_PROVIDER", "resend"), prod);
  add("ATLAS_AUTH_INTERNAL_SECRET", get("ATLAS_AUTH_INTERNAL_SECRET"), prod);
  add("ATLAS_EMAIL_RESEND_API_KEY", get("ATLAS_EMAIL_RESEND_API_KEY"), prod);
  add("ATLAS_EMAIL_FROM", get("ATLAS_EMAIL_FROM"), prod);
  add("ATLAS_AUTH_ALLOWED_EMAILS", get("ATLAS_AUTH_ALLOWED_EMAILS"), prod);
  add(
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
    get("ATLAS_AUTH_API_KEY_INTROSPECTION_URL"),
    prod,
  );

  return vars;
}
