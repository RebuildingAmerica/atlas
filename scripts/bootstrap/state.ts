import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CapabilityId, CommandGroup } from "./config/prerequisites.js";

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

export type PhaseId =
  | "install"
  | "auth"
  | "env"
  | "infra"
  | "database"
  | "product"
  | "deploy"
  | "mcp-registry"
  | "ci-cache"
  | "api-domain"
  | "api-edge";

export interface PhaseResult {
  success: boolean;
  followUpItems: string[];
  details?: string;
}

const STATE_VERSION = 1;

export interface ReadinessState {
  version: number;
  generatedAt: string;
  capabilities: Partial<Record<CapabilityId, CapabilityState>>;
  commandReadiness: Record<CommandGroup, "ready" | "blocked">;
  phases: Partial<Record<PhaseId, PhaseState>>;
}

function stateFilePath(projectRoot: string): string {
  return path.join(projectRoot, ".atlas", "dev-readiness.json");
}

export function loadReadiness(projectRoot: string): ReadinessState {
  const filePath = stateFilePath(projectRoot);
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ReadinessState;
    if (parsed.version === STATE_VERSION) {
      return parsed;
    }
  }
  return createEmptyState();
}

export function saveReadiness(
  projectRoot: string,
  state: ReadinessState,
): void {
  const filePath = stateFilePath(projectRoot);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  state.generatedAt = new Date().toISOString();
  writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n");
}

export function markPhase(
  state: ReadinessState,
  phaseId: PhaseId,
  status: PhaseState["status"],
  details?: string,
): void {
  state.phases[phaseId] = {
    status,
    completedAt: new Date().toISOString(),
    details,
  };
}

export function markCapability(
  state: ReadinessState,
  id: CapabilityId,
  update: Partial<CapabilityState>,
): void {
  const existing = state.capabilities[id];
  const checkedAt = new Date().toISOString();
  state.capabilities[id] = {
    status: "ready",
    installStatus: "ready",
    authStatus: "not_required",
    ...existing,
    ...update,
    checkedAt,
  };
}

function createEmptyState(): ReadinessState {
  return {
    version: STATE_VERSION,
    generatedAt: new Date().toISOString(),
    capabilities: {},
    commandReadiness: {
      dev: "blocked",
      test: "blocked",
      build: "blocked",
      deploy: "blocked",
      product: "blocked",
    },
    phases: {},
  };
}
