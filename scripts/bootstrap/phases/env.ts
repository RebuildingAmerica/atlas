import { existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { log, note, text, password } from "@clack/prompts";
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

interface EnvKeyConfig {
  prompt: string;
  sensitive: boolean;
  hint: string;
  required: boolean;
  localOnly: boolean;
}

const PROMPTED_KEYS: Record<string, EnvKeyConfig> = {
  ANTHROPIC_API_KEY: {
    prompt: "Anthropic API key",
    sensitive: true,
    hint: "Create one at https://console.anthropic.com/settings/keys — you need a key with Claude API access.",
    required: true,
    localOnly: true,
  },
  ATLAS_EMAIL_RESEND_API_KEY: {
    prompt: "Resend API key",
    sensitive: true,
    hint: "Sign up at https://resend.com and create an API key. This is used to send magic-link sign-in emails. Leave blank to use the local email capture provider instead.",
    required: false,
    localOnly: false,
  },
  SEARCH_API_KEY: {
    prompt: "Search API key (Brave Search)",
    sensitive: true,
    hint: "Get a free key at https://brave.com/search/api/ — used by the discovery pipeline to find local civic actors. Leave blank to skip (discovery will still work but with fewer sources).",
    required: false,
    localOnly: false,
  },
  OPENSTATUS_API_KEY: {
    prompt: "OpenStatus API key",
    sensitive: true,
    hint: "Get your API key from Settings → API Token at https://www.openstatus.dev/app/settings. Used to run synthetic monitors after every deploy via GitHub Actions. Leave blank to skip.",
    required: false,
    localOnly: false,
  },
};

interface EnvFileSpec {
  target: string;
  example: string;
  label: string;
}

function normalizeDocsOrigin(value: string): string {
  const candidate = value.trim();
  const normalizedCandidate = /^https?:\/\//.test(candidate)
    ? candidate
    : `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(normalizedCandidate);
  } catch {
    throw new Error("Enter a valid Mintlify hostname or URL.");
  }

  if (!/^https?:$/.test(url.protocol) || !url.hostname) {
    throw new Error("Enter a valid Mintlify hostname or URL.");
  }

  return url.origin;
}

export async function runEnvPhase(
  projectRoot: string,
  doctorMode: boolean,
  state: ReadinessState,
  configureHostedDeployment: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  const rootEnvPath = path.join(projectRoot, ".env");
  const prodEnvPath = path.join(projectRoot, ".env.production");

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

  // Step 3: Prompt for keys that need user input
  for (const [key, config] of Object.entries(PROMPTED_KEYS)) {
    const current = rootEnv.get(key);
    if (current && !isPlaceholder(current)) continue;

    note(config.hint, config.prompt);

    const value = await promptOrExit(
      config.sensitive
        ? password({
            message: `Paste your ${config.prompt}${config.required ? "" : " (or leave blank to skip)"}`,
            validate: (v) => {
              if (config.required && !v.trim()) {
                return `${config.prompt} is required.`;
              }
            },
          })
        : text({
            message: `Enter your ${config.prompt}${config.required ? "" : " (or leave blank to skip)"}`,
            validate: (v) => {
              if (config.required && !v.trim()) {
                return `${config.prompt} is required.`;
              }
            },
          }),
    );

    if (typeof value === "string" && value.trim()) {
      updates.set(key, value.trim());
    } else if (config.required) {
      followUpItems.push(`Set ${key} in .env — ${config.hint}`);
    }
  }

  if (configureHostedDeployment) {
    await ensureProductionRoutingConfig(prodEnvPath, followUpItems);
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
  if (
    configureHostedDeployment &&
    state.capabilities["deploy-vercel"]?.status === "ready"
  ) {
    const appDir = path.join(projectRoot, "app");
    await detectAndLink(appDir);

    const scope = getVercelScope(appDir);
    if (scope) {
      const mergedEnv = getMergedEnv(rootEnvPath, prodEnvPath);
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

function getMergedEnv(
  rootEnvPath: string,
  prodEnvPath: string,
): Map<string, string> {
  const merged = parseEnvFile(rootEnvPath);
  for (const [key, value] of parseEnvFile(prodEnvPath)) {
    merged.set(key, value);
  }
  return merged;
}

async function ensureProductionRoutingConfig(
  prodEnvPath: string,
  followUpItems: string[],
): Promise<void> {
  const prodEnv = parseEnvFile(prodEnvPath);
  const updates = new Map<string, string>();

  const publicUrl = prodEnv.get("ATLAS_PUBLIC_URL")?.trim();
  if (!publicUrl) {
    note(
      "Atlas needs its public production origin so Vercel, Cloud Run, auth, and Mintlify all agree on the same site URL.",
      "Production app URL",
    );
    const value = (await promptOrExit(
      text({
        message: "Production Atlas URL",
        placeholder: "https://atlas.rebuildingus.org",
        validate: (input) => {
          if (!input.trim()) return "The production Atlas URL is required.";
          if (!/^https?:\/\//.test(input.trim())) {
            return "Use an absolute URL starting with https://";
          }
        },
      }),
    )) as string;
    updates.set("ATLAS_PUBLIC_URL", value.trim().replace(/\/+$/, ""));
  }

  const docsUrl = prodEnv.get("ATLAS_DOCS_URL")?.trim();
  const normalizedDocsUrl = docsUrl ? normalizeDocsOrigin(docsUrl) : undefined;
  if (normalizedDocsUrl && normalizedDocsUrl !== docsUrl) {
    updates.set("ATLAS_DOCS_URL", normalizedDocsUrl);
  }

  if (!normalizedDocsUrl) {
    note(
      "Mintlify's Vercel subpath setup needs the Mintlify deployment origin, usually https://<subdomain>.mintlify.dev. Bootstrap will sync this to Vercel, but you still need to enable Mintlify's 'Host at /docs' setting in the dashboard.",
      "Mintlify docs origin",
    );
    const value = (await promptOrExit(
      text({
        message: "Mintlify docs origin",
        placeholder: "https://your-subdomain.mintlify.dev",
        validate: (input) => {
          if (!input.trim()) return "The Mintlify docs origin is required.";
          try {
            normalizeDocsOrigin(input);
          } catch (error) {
            return error instanceof Error
              ? error.message
              : "Enter a valid Mintlify hostname or URL.";
          }
        },
      }),
    )) as string;
    updates.set("ATLAS_DOCS_URL", normalizeDocsOrigin(value));
  }

  if (updates.size > 0) {
    mergeEnvFile(prodEnvPath, updates);
    log.success(`Updated ${prodEnvPath} with production routing values`);
  }

  followUpItems.push(
    "In Mintlify, enable 'Host at /docs' for the Atlas domain so Vercel rewrites can proxy /docs correctly.",
  );
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
  add("ATLAS_DOCS_URL", get("ATLAS_DOCS_URL"), prod);
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
