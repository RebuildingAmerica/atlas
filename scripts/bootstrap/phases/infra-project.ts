import path from "node:path";
import { log, select, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import { parseEnvFile } from "../lib/env-file.js";
import { commandOutput, runCommand } from "../lib/shell.js";
import { logSubline, promptConfirm, promptOrExit } from "../lib/ui.js";

export interface ProjectInfo {
  projectId: string;
  projectNumber: string;
}

export interface ProjectChoice {
  mode: "existing" | "manual" | "new";
  projectId?: string;
}

export function readPersistedInfraConfig(projectRoot: string): {
  projectId?: string;
  region?: string;
} {
  const prodEnv = parseEnvFile(path.join(projectRoot, ".env.production"));

  const projectId = prodEnv.get("GCP_PROJECT_ID")?.trim();
  const region = prodEnv.get("GCP_REGION")?.trim();

  return {
    projectId: projectId || undefined,
    region: region || undefined,
  };
}

export async function setupProject(
  doctorMode: boolean,
  followUpItems: string[],
  persistedProjectId?: string,
): Promise<ProjectInfo> {
  if (persistedProjectId) {
    const persistedProject = await reusePersistedProject(
      doctorMode,
      followUpItems,
      persistedProjectId,
    );
    if (persistedProject) {
      return persistedProject;
    }
  }

  const activeProjectId = getActiveProjectId();
  const projects = listAccessibleProjects();
  if (projects.length > 0) {
    logSubline(`Found ${projects.length} existing project(s)`);
  }
  if (activeProjectId) {
    logSubline(`Active gcloud project: ${pc.cyan(activeProjectId)}`);
  }

  logSubline(
    pc.dim(
      "Atlas needs a GCP project for Cloud Run hosting. You can use an existing project or create a new one. Project IDs are globally unique (e.g., 'atlas-prod-123').",
    ),
  );

  const projectChoice = (await promptOrExit(
    select({
      message: "GCP project",
      options: buildProjectOptions(activeProjectId, projects),
    }),
  )) as ProjectChoice;

  const creatingNew = projectChoice.mode === "new";
  const projectId =
    projectChoice.mode === "existing" && projectChoice.projectId
      ? projectChoice.projectId
      : ((await promptOrExit(
          text({
            message: creatingNew
              ? "New GCP project ID (globally unique, lowercase, hyphens allowed)"
              : "Existing GCP project ID",
            placeholder: "atlas-prod",
          }),
        )) as string);

  if (doctorMode) {
    const describeResult = describeProject(projectId);
    if (!describeResult.ok) {
      handleProjectLookupFailure(projectId, describeResult, followUpItems);
      return { projectId: "", projectNumber: "" };
    }
    const numResult = runCommand(
      `gcloud projects describe "${projectId}" --format="value(projectNumber)"`,
    );
    log.success(`Project '${projectId}' exists`);
    return { projectId, projectNumber: numResult.stdout };
  }

  const describeResult = describeProject(projectId);

  if (describeResult.ok) {
    log.success(`Project '${projectId}' exists`);
  } else {
    if (isGcloudAuthFailure(describeResult)) {
      handleProjectLookupFailure(projectId, describeResult, followUpItems);
      return { projectId: "", projectNumber: "" };
    }

    if (!creatingNew) {
      const shouldCreate = await promptConfirm(
        `Project '${projectId}' does not exist. Create it?`,
        true,
      );
      if (!shouldCreate) {
        log.error("Cannot proceed without a valid GCP project.");
        followUpItems.push(`Create GCP project: ${projectId}`);
        return { projectId: "", projectNumber: "" };
      }
    }

    const s = spinner();
    s.start(`Creating project '${projectId}'...`);
    const createResult = runCommand(`gcloud projects create "${projectId}"`);
    if (!createResult.ok) {
      s.stop(`Failed to create project '${projectId}'`);
      log.error(commandOutput(createResult));
      followUpItems.push(`Create GCP project manually: ${projectId}`);
      return { projectId: "", projectNumber: "" };
    }
    s.stop(`Project '${projectId}' created`);
  }

  runCommand(`gcloud config set project "${projectId}" --quiet`);

  const numResult = runCommand(
    `gcloud projects describe "${projectId}" --format="value(projectNumber)"`,
  );
  if (!numResult.ok) {
    log.error("Failed to get project number.");
    followUpItems.push("Retrieve GCP project number");
    return { projectId: "", projectNumber: "" };
  }
  const projectNumber = numResult.stdout;
  logSubline(`Project number: ${pc.dim(projectNumber)}`);

  const billingResult = runCommand(
    `gcloud billing projects describe "${projectId}" --format="value(billingAccountName)" 2>/dev/null`,
  );
  const billingAccount = billingResult.ok ? billingResult.stdout : "";

  if (!billingAccount) {
    log.warn("No billing account linked to this project.");
    logSubline(
      `Link one at: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`,
    );
    const billingReady = await promptConfirm("Is billing now enabled?", false);
    if (!billingReady) {
      log.error("Cloud Run requires billing. Cannot proceed.");
      followUpItems.push(`Enable billing for GCP project: ${projectId}`);
      return { projectId: "", projectNumber: "" };
    }
  } else {
    logSubline("Billing enabled");
  }

  return { projectId, projectNumber };
}

async function reusePersistedProject(
  doctorMode: boolean,
  followUpItems: string[],
  projectId: string,
): Promise<ProjectInfo | undefined> {
  const describeResult = describeProject(projectId);
  if (!describeResult.ok) {
    handleProjectLookupFailure(projectId, describeResult, followUpItems, true);
    return undefined;
  }

  log.success(`GCP_PROJECT_ID already configured (${projectId})`);

  if (!doctorMode) {
    const action = (await promptOrExit(
      select({
        message: "GCP project",
        options: [
          { value: "keep", label: `Keep ${projectId}` },
          { value: "change", label: "Choose a different project" },
        ],
      }),
    )) as string;

    if (action === "change") {
      return undefined;
    }
  }

  const numResult = runCommand(
    `gcloud projects describe "${projectId}" --format="value(projectNumber)"`,
  );
  if (!numResult.ok) {
    log.error("Failed to get project number.");
    followUpItems.push("Retrieve GCP project number");
    return { projectId: "", projectNumber: "" };
  }

  runCommand(`gcloud config set project "${projectId}" --quiet`);
  return { projectId, projectNumber: numResult.stdout };
}

export async function chooseRegion(
  doctorMode: boolean,
  persistedRegion?: string,
): Promise<string> {
  if (persistedRegion) {
    log.success(`GCP_REGION already configured (${persistedRegion})`);

    if (!doctorMode) {
      const action = (await promptOrExit(
        select({
          message: "GCP region",
          options: [
            { value: "keep", label: `Keep ${persistedRegion}` },
            { value: "change", label: "Choose a different region" },
          ],
        }),
      )) as string;

      if (action === "keep") {
        return persistedRegion;
      }
    } else {
      return persistedRegion;
    }
  }

  return (await promptOrExit(
    text({
      message: "GCP region",
      initialValue: persistedRegion || "us-central1",
    }),
  )) as string;
}

function describeProject(projectId: string) {
  return runCommand(
    `gcloud projects describe "${projectId}" --format="value(projectId)" 2>&1`,
  );
}

function isGcloudAuthFailure(result: ReturnType<typeof runCommand>): boolean {
  const output = commandOutput(result).toLowerCase();
  return (
    output.includes("reauthentication required") ||
    output.includes("please enter your password") ||
    output.includes("you do not currently have an active account") ||
    (output.includes("please run") && output.includes("gcloud auth login")) ||
    output.includes("permission denied") ||
    output.includes("forbidden")
  );
}

function handleProjectLookupFailure(
  projectId: string,
  result: ReturnType<typeof runCommand>,
  followUpItems: string[],
  persisted = false,
): void {
  if (isGcloudAuthFailure(result)) {
    log.error(
      `gcloud needs to reauthenticate before Atlas can verify project '${projectId}'. Run 'gcloud auth login' and then re-run bootstrap.`,
    );
    followUpItems.push("Reauthenticate gcloud: gcloud auth login");
    return;
  }

  if (persisted) {
    log.warn(`Saved GCP project '${projectId}' is no longer accessible`);
    followUpItems.push(`Verify saved GCP project: ${projectId}`);
    return;
  }

  log.warn(`Project '${projectId}' does not exist or is inaccessible`);
  followUpItems.push(`Create or verify GCP project: ${projectId}`);
}

function getActiveProjectId(): string | undefined {
  const result = runCommand("gcloud config get-value project 2>/dev/null");
  const projectId = result.ok ? result.stdout.trim() : "";
  if (!projectId || projectId === "(unset)") {
    return undefined;
  }

  return projectId;
}

function listAccessibleProjects(): string[] {
  const listResult = runCommand(
    'gcloud projects list --format="value(projectId)" --limit=20',
  );
  if (!listResult.ok || !listResult.stdout) {
    return [];
  }

  return listResult.stdout
    .split("\n")
    .map((projectId) => projectId.trim())
    .filter(Boolean);
}

function buildProjectOptions(
  activeProjectId: string | undefined,
  projects: string[],
): { value: ProjectChoice; label: string; hint?: string }[] {
  const options: { value: ProjectChoice; label: string; hint?: string }[] = [];
  const seen = new Set<string>();

  if (activeProjectId) {
    options.push({
      value: { mode: "existing", projectId: activeProjectId },
      label: `Use active gcloud project (${activeProjectId})`,
      hint: "Recommended when this is the project you already deploy into.",
    });
    seen.add(activeProjectId);
  }

  for (const projectId of projects) {
    if (seen.has(projectId)) {
      continue;
    }

    options.push({
      value: { mode: "existing", projectId },
      label: projectId,
      hint: "Existing accessible GCP project",
    });
    seen.add(projectId);
  }

  options.push({
    value: { mode: "manual" },
    label: "Enter an existing project ID manually",
  });
  options.push({
    value: { mode: "new" },
    label: "Create a new project",
  });

  return options;
}
