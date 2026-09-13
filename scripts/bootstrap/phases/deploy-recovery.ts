/**
 * Recovering from the two deploy failures an operator can fix in place.
 *
 * Cloud Build refusing to read the source bucket needs one IAM grant, and an
 * expired gcloud credential needs one re-login. Both are worth attempting
 * before the bootstrap ends in a wall of Google error text.
 */

import { log, note, spinner } from "@clack/prompts";
import {
  runCommand,
  commandOutput,
  runInteractiveCommand,
  type CommandResult,
} from "../lib/shell.js";
import { promptConfirm } from "../lib/ui.js";

export interface CloudBuildSourceAccessFailure {
  serviceAccount: string;
  bucket: string;
}

export interface CloudBuildRecoveryOptions {
  allowAuthRecovery: boolean;
  allowSourceAccessRecovery: boolean;
}

export function parseCloudBuildSourceAccessFailure(
  result: CommandResult,
): CloudBuildSourceAccessFailure | undefined {
  const output = commandOutput(result);
  if (!/storage\.objects\.get access/i.test(output)) {
    return undefined;
  }

  const serviceAccountMatch =
    /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com)\b/.exec(output);
  const bucketMatch = /\/buckets\/([^/\s]+)\/objects\//.exec(output);

  if (!serviceAccountMatch?.[1] || !bucketMatch?.[1]) {
    return undefined;
  }

  return {
    serviceAccount: serviceAccountMatch[1],
    bucket: bucketMatch[1],
  };
}

export function formatCloudBuildSourceAccessGrantCommand(
  failure: CloudBuildSourceAccessFailure,
): string {
  return (
    `gcloud storage buckets add-iam-policy-binding "gs://${failure.bucket}" ` +
    `--member="serviceAccount:${failure.serviceAccount}" ` +
    `--role="roles/storage.objectViewer" ` +
    "--quiet"
  );
}

export function formatCloudBuildSourceAccessRecoveryNote(
  failure: CloudBuildSourceAccessFailure,
): string {
  return [
    "Cloud Build uploaded the source archive, but the build identity cannot read it back from the Cloud Build staging bucket.",
    "",
    `Service account: ${failure.serviceAccount}`,
    `Bucket: gs://${failure.bucket}`,
    "",
    "Bootstrap can grant Storage Object Viewer on that one bucket and retry the build.",
  ].join("\n");
}

export function formatCloudBuildSourceAccessFollowUp(
  failure: CloudBuildSourceAccessFailure,
): string {
  return [
    `Grant Storage Object Viewer on gs://${failure.bucket} to ${failure.serviceAccount}.`,
    "Then run `pnpm bootstrap --resume`.",
  ].join(" ");
}

export async function recoverCloudBuildSourceAccess(
  failure: CloudBuildSourceAccessFailure,
): Promise<boolean> {
  note(formatCloudBuildSourceAccessRecoveryNote(failure), "Cloud Build access");
  const shouldGrant = await promptConfirm(
    "Grant Cloud Build source bucket access now?",
    true,
  );
  if (!shouldGrant) {
    return false;
  }

  const s = spinner();
  s.start("Granting Cloud Build source bucket access...");
  const grantResult = runCommand(
    formatCloudBuildSourceAccessGrantCommand(failure),
  );
  if (!grantResult.ok) {
    s.stop("Failed to grant Cloud Build source bucket access");
    log.error(commandOutput(grantResult));
    return false;
  }
  s.stop("Cloud Build source bucket access granted");
  return true;
}

export function isGcloudReauthenticationFailure(
  result: CommandResult,
): boolean {
  return /Reauthentication failed|cannot prompt during non-interactive|gcloud auth login/i.test(
    commandOutput(result),
  );
}

export function formatGcloudReauthenticationRecovery(): string {
  return [
    "Google Cloud needs a fresh interactive login before Cloud Build can continue.",
    "",
    "Bootstrap can run `gcloud auth login` now and retry Cloud Build after it succeeds.",
  ].join("\n");
}

export async function recoverGcloudAuthentication(): Promise<boolean> {
  note(formatGcloudReauthenticationRecovery(), "Google Cloud authentication");
  const shouldLogin = await promptConfirm("Run `gcloud auth login` now?", true);
  if (!shouldLogin) {
    return false;
  }
  return runInteractiveCommand("gcloud auth login");
}
