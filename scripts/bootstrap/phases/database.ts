import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { log, spinner, text, select } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../state.js";
import { runCommand, commandOutput } from "../lib/shell.js";
import { parseEnvFile, mergeEnvFile } from "../lib/env-file.js";
import {
  hostedEnvFilePath,
  type HostedDeployTarget,
} from "../lib/hosted-target.js";
import { promptOrExit, promptConfirm, logSubline } from "../lib/ui.js";
import type { ReadinessState } from "../state.js";
import { getVercelScope, syncEnvVars, type VercelVar } from "../lib/vercel.js";
import { vercelEnvironmentsForTarget } from "./env-routing.js";

const SCHEMA_PARTS_RELATIVE_PATH = "api/atlas/models/schema_parts";

export function formatDatabaseSourcePromptMessage(
  target: HostedDeployTarget,
): string {
  return [
    "Database setup",
    "",
    `Atlas ${target} needs its own PostgreSQL database, separate from the other environment's. Choose how bootstrap should get DATABASE_URL.`,
    "1. Use neonctl if you want bootstrap to create the Neon project for you.",
    "2. Choose manual if the database already exists or another teammate created it.",
    "3. Bootstrap validates the connection and runs the schema migration after this step.",
  ].join("\n");
}

export function formatExistingDatabasePromptMessage(
  target: HostedDeployTarget,
): string {
  return [
    "Existing DATABASE_URL found",
    "",
    `Bootstrap found a PostgreSQL connection string already in .env.${target === "production" ? "production" : "staging"}.`,
    `1. Keep it if this is the Atlas ${target} database.`,
    `2. Replace it if it actually points to the ${target === "production" ? "staging" : "production"} database or something else entirely — each environment needs its own.`,
    "3. Bootstrap validates whichever connection you choose before migrating.",
  ].join("\n");
}

export function formatNeonConnectionStringPromptMessage(
  target: HostedDeployTarget,
): string {
  return [
    "Neon PostgreSQL connection string",
    "",
    `Create or open the ${target} database in Neon:`,
    "1. Open https://console.neon.tech.",
    `2. Create or choose the Atlas ${target} project database — not the other environment's.`,
    "3. Copy the pooled PostgreSQL connection string from the dashboard.",
    "4. Make sure it starts with postgresql:// or postgres:// and includes sslmode=require.",
    "",
    `Paste the full connection string here. Bootstrap writes it to .env.${target === "production" ? "production" : "staging"} and Vercel when linked.`,
  ].join("\n");
}

export function formatNeonProjectNamePromptMessage(
  target: HostedDeployTarget,
): string {
  const example = target === "production" ? "atlas" : "atlas-staging";
  return [
    "Neon project name",
    "",
    `Name the Neon project bootstrap should create for Atlas ${target}.`,
    `Use \`${example}\` unless you have another naming convention in place.`,
    `Do not reuse the ${target === "production" ? "staging" : "production"} project — each environment needs its own database.`,
    "Bootstrap will ask neonctl to create the project and then read its connection string.",
  ].join("\n");
}

export async function runDatabasePhase(
  projectRoot: string,
  state: ReadinessState,
  doctorMode: boolean,
  target: HostedDeployTarget,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];

  // ── Check for existing DATABASE_URL ───────────────────────────────────────
  // Only this target's own hosted env file — never fall back to the root
  // .env or api/.env. Those are local-dev files; treating them as a source
  // of truth for a hosted database would let one environment's value leak
  // into the other's.
  const hostedEnvPath = hostedEnvFilePath(projectRoot, target);

  let databaseUrl = readDatabaseUrl(hostedEnvPath);

  // Ignore SQLite URLs — they're local dev defaults, not hosted config
  if (databaseUrl?.startsWith("sqlite:")) {
    databaseUrl = undefined;
  }

  if (databaseUrl) {
    log.success(`DATABASE_URL already configured for ${target}`);
    logSubline(pc.dim(redactConnectionString(databaseUrl)));

    if (doctorMode) {
      return validateAndMigrate(
        projectRoot,
        databaseUrl,
        doctorMode,
        followUpItems,
      );
    }

    const action = (await promptOrExit(
      select({
        message: formatExistingDatabasePromptMessage(target),
        options: [
          { value: "keep", label: "Keep existing connection" },
          { value: "replace", label: "Enter a new connection string" },
        ],
      }),
    )) as string;

    if (action === "keep") {
      return validateAndMigrate(
        projectRoot,
        databaseUrl,
        doctorMode,
        followUpItems,
      );
    }

    // Fall through to prompt for new URL
    databaseUrl = undefined;
  }

  // ── Obtain DATABASE_URL ───────────────────────────────────────────────────
  const hasNeonctl = runCommand("command -v neonctl").ok;

  if (hasNeonctl && !doctorMode) {
    const source = (await promptOrExit(
      select({
        message: formatDatabaseSourcePromptMessage(target),
        options: [
          { value: "neonctl", label: "Create a new Neon project with neonctl" },
          { value: "manual", label: "Enter a connection string manually" },
        ],
      }),
    )) as string;

    if (source === "neonctl") {
      databaseUrl = await createNeonProject(target, followUpItems);
    }
  }

  if (!databaseUrl) {
    if (doctorMode) {
      log.warn(`DATABASE_URL is not configured for ${target}`);
      followUpItems.push(
        `Set DATABASE_URL in .env.${target === "production" ? "production" : "staging"}`,
      );
      return { success: false, followUpItems };
    }

    databaseUrl = (await promptOrExit(
      text({
        message: formatNeonConnectionStringPromptMessage(target),
        placeholder:
          "postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/atlas?sslmode=require",
        validate(value) {
          const input = value ?? "";
          if (
            !input.startsWith("postgres://") &&
            !input.startsWith("postgresql://")
          ) {
            return "Must start with postgresql:// or postgres://";
          }
        },
      }),
    )) as string;
  }

  if (!databaseUrl) {
    log.error("No database connection string provided.");
    followUpItems.push("Configure DATABASE_URL");
    return { success: false, followUpItems };
  }

  // ── Validate & Migrate ────────────────────────────────────────────────────
  const result = await validateAndMigrate(
    projectRoot,
    databaseUrl,
    doctorMode,
    followUpItems,
  );

  // ── Write to env files ────────────────────────────────────────────────────
  if (!doctorMode && databaseUrl) {
    writeToEnvFiles(hostedEnvPath, databaseUrl);

    // Sync DATABASE_URL to Vercel if deploy-vercel capability is ready
    if (state.capabilities["deploy-vercel"]?.status === "ready") {
      const appDir = path.join(projectRoot, "app");
      const scope = getVercelScope(appDir);
      if (scope) {
        const vars: VercelVar[] = [
          {
            key: "DATABASE_URL",
            value: databaseUrl,
            environments: vercelEnvironmentsForTarget(target),
          },
        ];
        const synced = await syncEnvVars(vars, scope, { cwd: appDir });
        if (!synced) {
          result.followUpItems.push(
            "DATABASE_URL was not synced to Vercel — re-run bootstrap from a linked app/ directory",
          );
        }
      } else {
        result.followUpItems.push(
          "Vercel project not linked — DATABASE_URL not synced to Vercel",
        );
      }
    }
  }

  return result;
}

// ── Neon Project Creation ─────────────────────────────────────────────────────

async function createNeonProject(
  target: HostedDeployTarget,
  followUpItems: string[],
): Promise<string | undefined> {
  const projectName = (await promptOrExit(
    text({
      message: formatNeonProjectNamePromptMessage(target),
      initialValue: target === "production" ? "atlas" : "atlas-staging",
    }),
  )) as string;

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
    const output = JSON.parse(result.stdout) as {
      connection_uris?: { connection_uri?: string }[];
    };
    const connectionUri: string | undefined =
      output.connection_uris?.[0]?.connection_uri;
    if (connectionUri) {
      logSubline(
        `Connection: ${pc.dim(redactConnectionString(connectionUri))}`,
      );
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
        [
          "Database connection validation failed.",
          "",
          "Choose Yes only if the database is temporarily unreachable but the connection string is correct.",
          "Choose No to stop, fix DATABASE_URL, and rerun bootstrap before migration.",
        ].join("\n"),
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
  const schemaPartsDir = path.join(projectRoot, SCHEMA_PARTS_RELATIVE_PATH);

  if (!existsSync(schemaPartsDir)) {
    log.warn(
      `Schema parts directory not found at ${SCHEMA_PARTS_RELATIVE_PATH}`,
    );
    followUpItems.push("Run schema migration manually");
    return { success: followUpItems.length === 0, followUpItems };
  }

  if (doctorMode) {
    logSubline("Schema parts found — migration not run in doctor mode");
    return { success: followUpItems.length === 0, followUpItems };
  }

  if (!hasPsql) {
    logSubline(pc.dim("psql not available — skipping schema migration"));
    followUpItems.push(
      `Run schema migration from ${SCHEMA_PARTS_RELATIVE_PATH}`,
    );
    return { success: true, followUpItems };
  }

  const shouldMigrate = await promptConfirm(
    [
      "Run database schema migration?",
      "",
      `Bootstrap will assemble and apply ${SCHEMA_PARTS_RELATIVE_PATH} to the configured PostgreSQL database.`,
      "Choose Yes for a new or intentionally updated Atlas database.",
      "Choose No only if the schema has already been applied by another process.",
    ].join("\n"),
    true,
  );

  if (!shouldMigrate) {
    followUpItems.push(
      `Run schema migration from ${SCHEMA_PARTS_RELATIVE_PATH}`,
    );
    return { success: true, followUpItems };
  }

  const migrationFile = writePostgresSchemaMigration(schemaPartsDir);
  const s = spinner();
  s.start("Running schema migration...");

  const migrateResult = runCommand(
    `psql "${databaseUrl}" -v ON_ERROR_STOP=1 -f "${migrationFile.path}"`,
  );
  migrationFile.cleanup();

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

function writeToEnvFiles(hostedEnvPath: string, databaseUrl: string): void {
  // Only the target's own hosted env file. Writing a hosted database URL
  // into the root .env or api/.env would let another phase's fallback
  // chain pick it up regardless of which target is actually running.
  mergeEnvFile(hostedEnvPath, new Map([["DATABASE_URL", databaseUrl]]));
  log.success(`DATABASE_URL written to ${path.basename(hostedEnvPath)}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readDatabaseUrl(envPath: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  const env = parseEnvFile(envPath);
  const value = env.get("DATABASE_URL");
  if (!value || value === "" || value.includes("replace-with-"))
    return undefined;
  return value;
}

interface TemporaryMigrationFile {
  path: string;
  cleanup(): void;
}

function writePostgresSchemaMigration(
  schemaPartsDir: string,
): TemporaryMigrationFile {
  const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-postgres-schema-"));
  const migrationPath = path.join(tempDir, "schema.sql");
  const schema = readdirSync(schemaPartsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
    .map((fileName) =>
      readFileSync(path.join(schemaPartsDir, fileName), "utf8"),
    )
    .join("\n\n");

  writeFileSync(migrationPath, `${schema}\n`, "utf8");

  return {
    path: migrationPath,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
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
