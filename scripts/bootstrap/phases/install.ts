import { log, note, spinner } from "@clack/prompts";
import pc from "picocolors";
import {
  CAPABILITY_SPECS,
  type CapabilityConfig,
} from "../config/prerequisites.js";
import { runCommand, summarizeOutputLine } from "../lib/shell.js";
import { isVersionGte, type SupportedOs } from "../lib/os.js";
import { promptConfirm, logSubline } from "../lib/ui.js";
import { markCapability } from "../state.js";
import type { PhaseResult, ReadinessState } from "../state.js";

interface ReadyTool {
  label: string;
  version?: string;
}

export function formatToolVersion(version: string | undefined): string {
  if (!version) return "installed";
  const trimmed = version.trim();
  const firstSemver = /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(
    trimmed,
  );
  if (firstSemver) return firstSemver[1];
  const firstNumber = /\bv?(\d+(?:\.\d+)*)\b/.exec(trimmed);
  return firstNumber?.[1] ?? trimmed;
}

export function formatToolSummary(ready: ReadyTool[]): string {
  return [
    `${ready.length} tool${ready.length === 1 ? "" : "s"} ready`,
    "",
    ...ready.map(
      (dependency) =>
        `${dependency.label}: ${formatToolVersion(dependency.version)}`,
    ),
  ].join("\n");
}

export async function runInstallPhase(
  state: ReadinessState,
  os: SupportedOs,
  doctorMode: boolean,
  _localOnly: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  let allReady = true;
  const readyTools: ReadyTool[] = [];

  for (const cap of CAPABILITY_SPECS) {
    const result = checkCapability(cap);

    if (result.installed) {
      const versionInfo = ` (${formatToolVersion(result.version)})`;
      readyTools.push({ label: cap.label, version: result.version });
      if (doctorMode) {
        log.success(`${cap.label}${versionInfo}`);
      }
      markCapability(state, cap.id, {
        status: "ready",
        installStatus: "ready",
        detectedVersion: result.version,
      });
      continue;
    }

    // Not installed — decide whether to offer installation
    const isRequired = cap.requiredByDefault || cap.category === "core";
    if (doctorMode) {
      log.warn(`${cap.label} — not installed`);
      if (cap.postInstallHint) logSubline(pc.dim(cap.postInstallHint));
      markCapability(state, cap.id, {
        status: "failed",
        installStatus: "failed",
        details: "not installed",
      });
      allReady = false;
      continue;
    }

    const shouldInstall = await promptConfirm(
      [
        `${cap.label} is not installed${isRequired ? " and is required for this setup." : "."}`,
        "",
        "Choose Yes to let bootstrap install it with the configured install command.",
        "Choose No to skip this tool now and handle it manually later.",
      ].join("\n"),
      isRequired,
    );

    if (!shouldInstall) {
      log.warn(`${cap.label} — skipped`);
      markCapability(state, cap.id, {
        status: "deferred",
        installStatus: "deferred",
      });
      followUpItems.push(
        `Install ${cap.label}: ${cap.installCommands[os].join(" && ")}`,
      );
      continue;
    }

    const s = spinner();
    s.start(`Installing ${cap.label}...`);

    let installOk = true;
    for (const cmd of cap.installCommands[os]) {
      let cmdResult = runCommand(cmd);
      if (
        !cmdResult.ok &&
        cmdResult.stderr.includes("ERR_PNPM_UNEXPECTED_STORE")
      ) {
        const repaired = repairPnpmGlobalStore();
        if (repaired) {
          cmdResult = runCommand(cmd);
        }
      }
      if (!cmdResult.ok) {
        s.stop(`${cap.label} — install failed`);
        log.error(summarizeOutputLine(cmdResult));
        markCapability(state, cap.id, {
          status: "failed",
          installStatus: "failed",
          details: cmdResult.stderr,
        });
        followUpItems.push(`Install ${cap.label} manually: ${cmd}`);
        installOk = false;
        allReady = false;
        break;
      }
    }

    if (installOk) {
      const recheck = checkCapability(cap);
      if (recheck.installed) {
        s.stop(`${cap.label} installed`);
        markCapability(state, cap.id, {
          status: "ready",
          installStatus: "ready",
          detectedVersion: recheck.version,
        });
      } else {
        s.stop(`${cap.label} — installed but not detected`);
        markCapability(state, cap.id, {
          status: "failed",
          installStatus: "failed",
          details: "installed but not on PATH",
        });
        if (cap.postInstallHint) followUpItems.push(cap.postInstallHint);
        allReady = false;
      }
    }
  }

  if (!doctorMode && readyTools.length > 0) {
    note(formatToolSummary(readyTools), "System tools");
  }

  return { success: allReady, followUpItems };
}

function repairPnpmGlobalStore(): boolean {
  const globalStoreDir = runCommand("pnpm config get store-dir --global");
  const stale = globalStoreDir.stdout.trim();
  if (!stale || stale === "undefined") {
    return false;
  }

  logSubline(
    pc.dim(
      `pnpm global store-dir is pinned to ${stale}; clearing so pnpm can use the default for its current store version.`,
    ),
  );
  return runCommand("pnpm config delete store-dir --global").ok;
}

interface CapabilityCheck {
  installed: boolean;
  version?: string;
}

function checkCapability(cap: CapabilityConfig): CapabilityCheck {
  const binaryResult = runCommand(cap.binaryCommand);
  if (!binaryResult.ok) {
    // Try path candidates
    if (cap.pathCandidates) {
      for (const candidate of cap.pathCandidates) {
        const pathCheck = runCommand(`test -x "${candidate}"`);
        if (pathCheck.ok) {
          // Temporarily add to PATH for this session
          const dir = candidate.replace(/\/[^/]+$/, "");
          process.env.PATH = `${dir}:${process.env.PATH}`;
          return checkCapability({ ...cap, pathCandidates: undefined });
        }
      }
    }
    return { installed: false };
  }

  if (!cap.versionCommand) return { installed: true };

  const versionResult = runCommand(cap.versionCommand);
  if (!versionResult.ok) return { installed: true };

  let version = versionResult.stdout;
  if (cap.versionPrefix) {
    version = version.replace(cap.versionPrefix, "");
  }

  if (cap.minVersion && !isVersionGte(version, cap.minVersion)) {
    return { installed: false, version };
  }

  return { installed: true, version };
}
