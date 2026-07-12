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

export function formatGcpProjectChoicePromptMessage(): string {
  return [
    "GCP project",
    "",
    "Atlas uses one Google Cloud project for Cloud Run, Artifact Registry, Scheduler, and deploy identities.",
    "1. Choose the active project if it is the production Atlas project.",
    "2. Choose an existing project if another project already owns production infra.",
    "3. Choose manual if the project is not listed.",
    "4. Choose new only if bootstrap should create the project.",
    "",
    "Bootstrap will set gcloud to the chosen project before continuing.",
  ].join("\n");
}

export function formatGcpProjectIdPromptMessage(creatingNew: boolean): string {
  if (creatingNew) {
    return [
      "New GCP project ID",
      "",
      "Choose the globally unique Google Cloud project ID bootstrap should create.",
      "1. Use lowercase letters, numbers, and hyphens.",
      "2. Keep it recognizable, for example atlas-prod or atlas-production.",
      "3. Do not use a personal or throwaway project for production.",
      "",
      "Paste the project ID here. Bootstrap will create it with gcloud.",
    ].join("\n");
  }

  return [
    "Existing GCP project ID",
    "",
    "Enter the Google Cloud project ID that already owns Atlas infrastructure.",
    "1. Open https://console.cloud.google.com/cloud-resource-manager if you need to confirm it.",
    "2. Copy the Project ID column, not the display name.",
    "3. Make sure your active gcloud account has access to deploy into it.",
    "",
    "Paste the project ID here. Bootstrap will verify it before continuing.",
  ].join("\n");
}

export function formatGcpRegionPromptMessage(): string {
  return [
    "GCP region",
    "",
    "Choose the Google Cloud region for Atlas Cloud Run and Artifact Registry.",
    "Use us-central1 unless production has intentionally moved to another region.",
    "Bootstrap writes this as GCP_REGION and deploys hosted services there.",
  ].join("\n");
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
  assumeYes = false,
): Promise<ProjectInfo> {
  if (persistedProjectId) {
    const persistedProject = await reusePersistedProject(
      doctorMode,
      followUpItems,
      persistedProjectId,
      assumeYes,
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

  if (doctorMode) {
    const projectId = activeProjectId;
    if (!projectId) {
      log.warn("GCP project is not configured");
      followUpItems.push(
        "Set GCP_PROJECT_ID in .env.production or select one during `pnpm setup:prod`",
      );
      return { projectId: "", projectNumber: "" };
    }

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

  const projectChoice = (await promptOrExit(
    select({
      message: formatGcpProjectChoicePromptMessage(),
      options: buildProjectOptions(activeProjectId, projects),
    }),
  )) as ProjectChoice;

  const creatingNew = projectChoice.mode === "new";
  const projectId =
    projectChoice.mode === "existing" && projectChoice.projectId
      ? projectChoice.projectId
      : ((await promptOrExit(
          text({
            message: formatGcpProjectIdPromptMessage(creatingNew),
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
        [
          `GCP project '${projectId}' was not found.`,
          "",
          "Choose Yes to let bootstrap create this project with gcloud.",
          "Choose No if the project ID is wrong or you need a different account.",
        ].join("\n"),
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
    const billingReady = await promptConfirm(
      [
        "Confirm GCP billing is enabled",
        "",
        `Open https://console.cloud.google.com/billing/linkedaccount?project=${projectId} and link a billing account.`,
        "Cloud Run cannot deploy until billing is linked.",
        "",
        "Choose Yes only after the billing page shows this project is linked.",
      ].join("\n"),
      false,
    );
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
  assumeYes: boolean,
): Promise<ProjectInfo | undefined> {
  const describeResult = describeProject(projectId);
  if (!describeResult.ok) {
    handleProjectLookupFailure(projectId, describeResult, followUpItems, true);
    return undefined;
  }

  log.success(`GCP_PROJECT_ID already configured (${projectId})`);

  if (!doctorMode && !assumeYes) {
    const action = (await promptOrExit(
      select({
        message: formatGcpProjectChoicePromptMessage(),
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

  if (!doctorMode) {
    runCommand(`gcloud config set project "${projectId}" --quiet`);
  }
  return { projectId, projectNumber: numResult.stdout };
}

export async function chooseRegion(
  doctorMode: boolean,
  persistedRegion?: string,
  followUpItems: string[] = [],
  assumeYes = false,
): Promise<string> {
  if (persistedRegion) {
    log.success(`GCP_REGION already configured (${persistedRegion})`);

    if (assumeYes) {
      return persistedRegion;
    }

    if (!doctorMode) {
      const action = (await promptOrExit(
        select({
          message: formatGcpRegionPromptMessage(),
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

  if (doctorMode) {
    log.warn("GCP_REGION is not configured");
    followUpItems.push(
      "Set GCP_REGION in .env.production or choose one during hosted setup",
    );
    return "us-central1";
  }

  return (await promptOrExit(
    text({
      message: formatGcpRegionPromptMessage(),
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
