export type SupportedOs = "macos" | "linux";
export type SetupMode = "wizard" | "doctor";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CapabilityId =
  | "core-node"
  | "core-pnpm"
  | "core-python"
  | "core-uv"
  | "core-docker"
  | "deploy-gcloud"
  | "deploy-gh"
  | "deploy-actionlint"
  | "deploy-wrangler"
  | "deploy-vercel"
  | "product-stripe"
  | "product-neonctl"
  | "product-psql";

export type CommandGroup = "dev" | "test" | "build" | "deploy" | "product";
export type PhaseId =
  | "install"
  | "auth"
  | "env"
  | "infra"
  | "database"
  | "product"
  | "deploy";

export type CapabilityStatus = "ready" | "failed" | "deferred" | "skipped";

export interface CapabilityState {
  status: CapabilityStatus;
  installStatus: CapabilityStatus;
  authStatus: CapabilityStatus | "not_required";
  detectedVersion?: string;
  details?: string;
  nextAction?: string;
  checkedAt: string;
}

export interface PhaseState {
  status: "complete" | "partial" | "skipped" | "failed";
  completedAt: string;
  details?: string;
}

export interface PhaseResult {
  success: boolean;
  followUpItems: string[];
  details?: string;
}
