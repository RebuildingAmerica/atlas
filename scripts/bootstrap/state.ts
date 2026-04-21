import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  CapabilityId,
  CapabilityState,
  CommandGroup,
  PhaseId,
  PhaseState,
} from "./lib/types.js";

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
  state.capabilities[id] = {
    status: "ready",
    installStatus: "ready",
    authStatus: "not_required",
    checkedAt: new Date().toISOString(),
    ...existing,
    ...update,
    checkedAt: new Date().toISOString(),
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
