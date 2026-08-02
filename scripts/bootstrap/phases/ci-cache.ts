import { log } from "@clack/prompts";
import pc from "picocolors";
import { commandOutput, runCommand } from "../lib/shell.js";
import { logSubline } from "../lib/ui.js";
import type { PhaseResult } from "../state.js";

/**
 * Describe the repository-owned CI cache path.
 */
export function formatCiCacheStatus(): string {
  return [
    "GitHub Actions cache is the Atlas CI Turbo cache.",
    "It is configured in .github/actions/setup-toolchain/action.yml and needs no Vercel login or token.",
  ].join("\n");
}

/**
 * Turn Turbo's local status output into actionable, non-mutating local-cache guidance.
 */
export function formatTurboRemoteCacheDiagnostic(turboInfo: string): string {
  if (/remote caching enabled/i.test(turboInfo)) {
    return "Optional local Turbo remote cache: authenticated and enabled.";
  }

  return [
    "Optional local Turbo remote cache: not authenticated.",
    "Local builds still use .turbo/cache, and CI uses GitHub Actions cache automatically.",
  ].join("\n");
}

/**
 * Report the turnkey CI cache configuration without creating provider credentials.
 */
export function runCiCachePhase(
  _projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  log.success("Atlas CI Turbo cache is configured.");
  formatCiCacheStatus()
    .split("\n")
    .forEach((line) => {
      logSubline(pc.dim(line));
    });

  if (doctorMode) {
    const diagnostic = formatTurboRemoteCacheDiagnostic(
      commandOutput(runCommand("pnpm exec turbo info")),
    );
    diagnostic.split("\n").forEach((line) => {
      logSubline(line);
    });
  }

  return Promise.resolve({ success: true, followUpItems: [] });
}
