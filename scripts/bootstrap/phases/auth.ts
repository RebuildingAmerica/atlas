import { log } from "@clack/prompts";
import { CAPABILITY_SPECS } from "../config/prerequisites.js";
import type { PhaseResult } from "../lib/types.js";
import { runCommand, runInteractiveCommand } from "../lib/shell.js";
import { promptConfirm, logSubline } from "../lib/ui.js";
import { markCapability } from "../state.js";
import type { ReadinessState } from "../state.js";

export async function runAuthPhase(
  state: ReadinessState,
  doctorMode: boolean,
  localOnly: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  let allReady = true;

  const capsWithAuth = CAPABILITY_SPECS.filter((cap) => cap.auth);

  if (capsWithAuth.length === 0) {
    log.info("No CLI tools require authentication.");
    return { success: true, followUpItems: [] };
  }

  for (const cap of capsWithAuth) {
    const auth = cap.auth;
    if (!auth) continue;

    const capState = state.capabilities[cap.id];

    // Not installed — show status but don't try to auth
    if (capState?.installStatus !== "ready") {
      log.info(`${cap.label} — not installed, skipping auth`);
      continue;
    }

    // Installed but skipped for local-only
    if (localOnly && cap.category !== "core") {
      const checkResult = runCommand(auth.checkCommand);
      if (checkResult.ok) {
        log.success(`${cap.label} — authenticated`);
        markCapability(state, cap.id, { authStatus: "ready" });
      } else {
        log.info(`${cap.label} — not authenticated (not needed for local dev)`);
        markCapability(state, cap.id, { authStatus: "skipped" });
      }
      continue;
    }

    const checkResult = runCommand(auth.checkCommand);

    if (checkResult.ok) {
      log.success(`${cap.label} — authenticated`);
      markCapability(state, cap.id, { authStatus: "ready" });
      continue;
    }

    if (doctorMode) {
      log.warn(`${cap.label} — not authenticated`);
      logSubline(`Run: ${auth.loginCommand}`);
      markCapability(state, cap.id, { authStatus: "failed" });
      allReady = false;
      continue;
    }

    const shouldAuth = await promptConfirm(
      `${cap.label} is not authenticated. Log in now?`,
      true,
    );

    if (!shouldAuth) {
      log.warn(`${cap.label} — auth deferred`);
      markCapability(state, cap.id, { authStatus: "deferred" });
      followUpItems.push(`Authenticate ${cap.label}: ${auth.loginCommand}`);
      continue;
    }

    const loginOk = runInteractiveCommand(auth.loginCommand);

    if (loginOk) {
      // Re-verify after login
      const recheck = runCommand(auth.checkCommand);
      if (recheck.ok) {
        log.success(`${cap.label} — authenticated`);
        markCapability(state, cap.id, { authStatus: "ready" });
      } else {
        log.warn(`${cap.label} — login completed but verification failed`);
        markCapability(state, cap.id, {
          authStatus: "failed",
          details: "login succeeded but re-check failed",
        });
        allReady = false;
      }
    } else {
      log.error(`${cap.label} — login failed`);
      markCapability(state, cap.id, { authStatus: "failed" });
      followUpItems.push(`Authenticate ${cap.label}: ${auth.loginCommand}`);
      allReady = false;
    }
  }

  return { success: allReady, followUpItems };
}
