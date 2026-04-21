import { existsSync } from "node:fs";
import path from "node:path";
import { log, spinner, text, select } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { runCommand, commandOutput } from "../lib/shell.js";
import { parseEnvFile, mergeEnvFile } from "../lib/env-file.js";
import { promptOrExit, promptConfirm, logSubline } from "../lib/ui.js";
import type { ReadinessState } from "../state.js";

const SCHEMA_RELATIVE_PATH = "api/atlas/models/schema.sql";

export async function runDatabasePhase(
  projectRoot: string,
  state: ReadinessState,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];

  // ── Check for existing DATABASE_URL ───────────────────────────────────────
  const prodEnvPath = path.join(projectRoot, ".env.production");
  const rootEnvPath = path.join(projectRoot, ".env");
  const apiEnvPath = path.join(projectRoot, "api", ".env");

  let databaseUrl = readDatabaseUrl(prodEnvPath) || readDatabaseUrl(rootEnvPath) || readDatabaseUrl(apiEnvPath);

  if (databaseUrl) {
    log.success("DATABASE_URL already configured");
    logSubline(pc.dim(redactConnectionString(databaseUrl)));

    if (doctorMode) {
      return validateAndMigrate(projectRoot, databaseUrl, doctorMode, followUpItems);
    }

    const action = await promptOrExit(
      select({
        message: "A DATABASE_URL is already set. What would you like to do?",
        options: [
          { value: "keep", label: "Keep existing connection" },
          { value: "replace", label: "Enter a new connection string" },
        ],
      }),
    ) as string;

    if (action === "keep") {
      return validateAndMigrate(projectRoot, databaseUrl, doctorMode, followUpItems);
    }

    // Fall through to prompt for new URL
    databaseUrl = undefined;
  }

  // ── Obtain DATABASE_URL ───────────────────────────────────────────────────
  const hasNeonctl = runCommand("command -v neonctl").ok;

  if (hasNeonctl && !doctorMode) {
    const source = await promptOrExit(
      select({
        message: "How would you like to configure the database?",
        options: [
          { value: "neonctl", label: "Create a new Neon project with neonctl" },
          { value: "manual", label: "Enter a connection string manually" },
        ],
      }),
    ) as string;

    if (source === "neonctl") {
      databaseUrl = await createNeonProject(followUpItems);
    }
  }

  if (!databaseUrl) {
    if (doctorMode) {
      log.warn("DATABASE_URL is not configured");
      followUpItems.push("Set DATABASE_URL in .env or .env.production");
      return { success: false, followUpItems };
    }

    databaseUrl = await promptOrExit(
      text({
        message: "Neon connection string (postgresql://...)",
        validate(value) {
          if (!value.startsWith("postgres://") && !value.startsWith("postgresql://")) {
            return "Must start with postgresql:// or postgres://";
          }
        },
      }),
    ) as string;
  }

  if (!databaseUrl) {
    log.error("No database connection string provided.");
    followUpItems.push("Configure DATABASE_URL");
    return { success: false, followUpItems };
  }

  // ── Validate & Migrate ────────────────────────────────────────────────────
  const result = await validateAndMigrate(projectRoot, databaseUrl, doctorMode, followUpItems);

  // ── Write to env files ────────────────────────────────────────────────────
  if (!doctorMode && databaseUrl) {
    writeToEnvFiles(projectRoot, databaseUrl);
  }

  return result;
}

// ── Neon Project Creation ─────────────────────────────────────────────────────

async function createNeonProject(
  followUpItems: string[],
): Promise<string | undefined> {
  const projectName = await promptOrExit(
    text({
      message: "Neon project name",
      initialValue: "atlas",
    }),
  ) as string;

  const s = spinner();
  s.start(`Creating Neon project '${projectName}'...`);

  const result = runCommand(
    `neonctl projects create --name "${projectName}" --output json`,
  );

  if (!result.ok) {
    s.stop("Failed to create Neon project");
    log.error(commandOutput(result));
    followUpItems.push("Create Neon project manually at https://neon.tech");
    return undefined;
  }

  s.stop(`Neon project '${projectName}' created`);

  // Extract connection URI from neonctl output
  try {
    const output = JSON.parse(result.stdout);
    const connectionUri: string | undefined = output.connection_uris?.[0]?.connection_uri;
    if (connectionUri) {
      logSubline(`Connection: ${pc.dim(redactConnectionString(connectionUri))}`);
      return connectionUri;
    }
  } catch {
    // Try extracting with neonctl connection-string
  }

  // Fallback: fetch connection string from neonctl
  const csResult = runCommand(
    `neonctl connection-string --project-id "${projectName}" 2>/dev/null`,
  );
  if (csResult.ok && csResult.stdout.startsWith("postgres")) {
    return csResult.stdout;
  }

  log.warn("Could not extract connection string from neonctl output.");
  followUpItems.push("Copy connection string from Neon dashboard");
  return undefined;
}

// ── Validate & Migrate ──────────────────────────────────────────────────────

async function validateAndMigrate(
  projectRoot: string,
  databaseUrl: string,
  doctorMode: boolean,
  followUpItems: string[],
): Promise<PhaseResult> {
  const hasPsql = runCommand("command -v psql").ok;

  // Validate connection
  if (hasPsql) {
    const s = spinner();
    s.start("Validating database connection...");

    const validateResult = runCommand(
      `psql "${databaseUrl}" -c "SELECT 1" 2>/dev/null`,
    );

    if (validateResult.ok) {
      s.stop("Database connection successful");
    } else {
      s.stop("Database connection failed");
      log.warn("Could not connect to database. Check your connection string.");
      if (doctorMode) {
        followUpItems.push("Fix DATABASE_URL — connection test failed");
        return { success: false, followUpItems };
      }

      const shouldContinue = await promptConfirm(
        "Continue anyway?",
        false,
      );
      if (!shouldContinue) {
        followUpItems.push("Fix DATABASE_URL and re-run");
        return { success: false, followUpItems };
      }
    }
  } else {
    logSubline(pc.dim("psql not available — skipping connection validation"));
  }

  // Run schema migration
  const schemaPath = path.join(projectRoot, SCHEMA_RELATIVE_PATH);

  if (!existsSync(schemaPath)) {
    log.warn(`Schema file not found at ${SCHEMA_RELATIVE_PATH}`);
    followUpItems.push("Run schema migration manually");
    return { success: followUpItems.length === 0, followUpItems };
  }

  if (doctorMode) {
    logSubline("Schema file found — migration not run in doctor mode");
    return { success: followUpItems.length === 0, followUpItems };
  }

  if (!hasPsql) {
    logSubline(pc.dim("psql not available — skipping schema migration"));
    followUpItems.push(`Run schema migration: psql $DATABASE_URL -f ${SCHEMA_RELATIVE_PATH}`);
    return { success: true, followUpItems };
  }

  const shouldMigrate = await promptConfirm(
    `Run schema migration (${SCHEMA_RELATIVE_PATH})?`,
    true,
  );

  if (!shouldMigrate) {
    followUpItems.push(`Run schema migration: psql $DATABASE_URL -f ${SCHEMA_RELATIVE_PATH}`);
    return { success: true, followUpItems };
  }

  const s = spinner();
  s.start("Running schema migration...");

  const migrateResult = runCommand(
    `psql "${databaseUrl}" -f "${schemaPath}"`,
  );

  if (migrateResult.ok) {
    s.stop("Schema migration complete");
  } else {
    s.stop("Schema migration failed");
    log.error(commandOutput(migrateResult));
    followUpItems.push("Fix schema migration errors and re-run");
  }

  return { success: followUpItems.length === 0, followUpItems };
}

// ── Write Env Files ─────────────────────────────────────────────────────────

function writeToEnvFiles(projectRoot: string, databaseUrl: string): void {
  const updates = new Map([["DATABASE_URL", databaseUrl]]);

  const envTargets = [
    ".env",
    ".env.production",
    "api/.env",
  ];

  for (const target of envTargets) {
    const targetPath = path.join(projectRoot, target);
    if (existsSync(targetPath)) {
      mergeEnvFile(targetPath, updates);
      logSubline(`Updated ${target}`);
    }
  }

  log.success("DATABASE_URL written to env files");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readDatabaseUrl(envPath: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  const env = parseEnvFile(envPath);
  const value = env.get("DATABASE_URL");
  if (!value || value === "" || value.includes("replace-with-")) return undefined;
  return value;
}

function redactConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return url.replace(/:[^@/]+@/, ":****@");
  }
}
