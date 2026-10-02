export const REQUIRED_APIS = [
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "secretmanager.googleapis.com",
  "cloudscheduler.googleapis.com",
];

export const SERVICE_ACCOUNT_ROLES = [
  "roles/run.admin",
  "roles/artifactregistry.writer",
  "roles/iam.serviceAccountUser",
];

export const REPO_NAME = "atlas-images";
export const SA_NAME = "atlas-deploy";
/**
 * Cloud Scheduler signs scheduled discovery calls as this account. It holds
 * no project roles: the API verifies its Google ID token and grants it one
 * action, so the account's only power is starting the nightly run.
 */
export const SCHEDULER_SA_NAME = "atlas-scheduler";
export const SCHEDULED_DISCOVERY_PATH = "/api/discovery-runs/scheduled";
export const POOL_NAME = "github-pool";
export const PROVIDER_NAME = "github-provider";
export const PDS_APP_PROVISIONING_SECRET =
  "atlas-pds-production-admin-password";
