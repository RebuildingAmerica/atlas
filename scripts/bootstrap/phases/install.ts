import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import {
  CAPABILITY_SPECS,
  type CapabilityConfig,
} from "../config/prerequisites.js";
import type { SupportedOs } from "../lib/types.js";
import type { PhaseResult } from "../lib/types.js";
import { runCommand, summarizeOutputLine } from "../lib/shell.js";
import { isVersionGte } from "../lib/os.js";
import { promptConfirm, logSubline } from "../lib/ui.js";
import { markCapability } from "../state.js";
import type { ReadinessState } from "../state.js";

export async function runInstallPhase(
  state: ReadinessState,
  os: SupportedOs,
  doctorMode: boolean,
  localOnly: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  let allReady = true;

  const caps = CAPABILITY_SPECS.filter((cap) => {
    if (localOnly && cap.category !== "core") return false;
    return cap.requiredByDefault || cap.category === "core";
  });

  for (const cap of caps) {
    const result = checkCapability(cap);

    if (result.installed) {
      const versionInfo = result.version ? ` (${result.version})` : "";
      log.success(`${cap.label}${versionInfo}`);
      markCapability(state, cap.id, {
        status: "ready",
        installStatus: "ready",
        detectedVersion: result.version,
      });
      continue;
    }

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
      `${cap.label} is not installed. Install it?`,
      true,
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
      const cmdResult = runCommand(cmd);
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

  return { success: allReady, followUpItems };
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
