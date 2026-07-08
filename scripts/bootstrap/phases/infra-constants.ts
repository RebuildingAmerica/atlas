export const REQUIRED_APIS = [
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
];

export const SERVICE_ACCOUNT_ROLES = [
  "roles/run.admin",
  "roles/artifactregistry.writer",
  "roles/iam.serviceAccountUser",
];

export const REPO_NAME = "atlas-images";
export const SA_NAME = "atlas-deploy";
export const POOL_NAME = "github-pool";
export const PROVIDER_NAME = "github-provider";
