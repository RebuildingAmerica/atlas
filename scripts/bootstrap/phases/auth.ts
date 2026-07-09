import { log } from "@clack/prompts";
import { CAPABILITY_SPECS } from "../config/prerequisites.js";
import type {
  CapabilityConfig,
  CapabilityId,
} from "../config/prerequisites.js";
import type { PhaseResult } from "../state.js";
import { runCommand, runInteractiveCommand } from "../lib/shell.js";
import { promptConfirm, logSubline } from "../lib/ui.js";
import { markCapability } from "../state.js";
import type { ReadinessState } from "../state.js";

type JsonRecord = Record<string, unknown>;

interface AuthenticatedAccountDetail {
  label: string;
  identity: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecord(output: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(output);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function jsonString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function nestedJsonString(
  record: JsonRecord | null,
  keys: string[],
): string | null {
  let current: unknown = record;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" && current.trim().length > 0
    ? current.trim()
    : null;
}

function firstOutputLine(output: string): string | null {
  const line = output
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  return line ?? null;
}

function joinIdentityParts(parts: (string | null)[]): string | null {
  const displayParts = parts.filter((part): part is string => part !== null);
  return displayParts.length > 0 ? displayParts.join(" / ") : null;
}

function parseWranglerAccount(output: string): string | null {
  for (const line of output.split("\n")) {
    const parts = line
      .split("│")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (
      parts.length === 2 &&
      parts[0] !== "Account Name" &&
      parts[1] !== "Account ID"
    ) {
      return `${parts[0]} / ${parts[1]}`;
    }
  }
  return null;
}

export function parseAuthIdentity(
  capabilityId: CapabilityId,
  output: string,
): string | null {
  const record = jsonRecord(output);

  if (capabilityId === "deploy-gh") {
    const login = jsonString(record, "login");
    if (login) return login;
  }

  if (capabilityId === "deploy-wrangler") {
    return parseWranglerAccount(output);
  }

  if (capabilityId === "product-stripe") {
    return joinIdentityParts([
      nestedJsonString(record, ["settings", "dashboard", "display_name"]),
      jsonString(record, "email"),
      jsonString(record, "id"),
    ]);
  }

  if (capabilityId === "product-neonctl") {
    return joinIdentityParts([
      jsonString(record, "id"),
      jsonString(record, "email"),
    ]);
  }

  return firstOutputLine(output);
}

export function formatAuthenticatedAccountPrompt(
  detail: AuthenticatedAccountDetail,
): string {
  return [
    `Use this ${detail.label} account?`,
    "",
    `Account: ${detail.identity}`,
    "",
    "Choose Yes only if this is the account Atlas should use for setup.",
    "Choose No to log in with a different account before bootstrap continues.",
  ].join("\n");
}

function describeAuthenticatedAccount(cap: CapabilityConfig): string | null {
  const command = cap.auth?.identityCommand;
  if (!command) return null;

  const result = runCommand(command);
  const output = result.stdout || result.stderr;
  return parseAuthIdentity(cap.id, output);
}

function authenticatedAccountDetail(
  cap: CapabilityConfig,
): AuthenticatedAccountDetail {
  return {
    label: cap.label,
    identity: describeAuthenticatedAccount(cap) ?? "identity unavailable",
  };
}

export function shouldAcceptAuthenticatedAccount(
  assumeYes: boolean,
  confirmed: boolean,
): boolean {
  return assumeYes || confirmed;
}

export function shouldShowAuthenticatedAccountStatus(
  doctorMode: boolean,
): boolean {
  return doctorMode;
}

export async function runAuthPhase(
  state: ReadinessState,
  doctorMode: boolean,
  _localOnly: boolean,
  assumeYes: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  let allReady = true;

  const capsWithAuth = CAPABILITY_SPECS.filter((cap) => cap.auth);

  if (capsWithAuth.length === 0) {
    log.info("No CLI accounts needed for this setup.");
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

    const checkResult = runCommand(auth.checkCommand);

    if (checkResult.ok) {
      if (shouldShowAuthenticatedAccountStatus(doctorMode)) {
        log.success(`${cap.label} — authenticated`);
      }
      const accepted = await confirmAuthenticatedAccount(
        cap,
        doctorMode,
        assumeYes,
      );
      if (!accepted) {
        followUpItems.push(
          `Authenticate ${cap.label} with the intended account, then re-run bootstrap.`,
        );
        return { success: false, followUpItems };
      }
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
      [
        `${cap.label} is not authenticated.`,
        "",
        `Bootstrap needs the intended ${cap.label} account before setup can continue.`,
        `It will run: ${auth.loginCommand}`,
        "",
        "Choose Yes to log in now. Choose No to stop and handle this account manually.",
      ].join("\n"),
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
        if (shouldShowAuthenticatedAccountStatus(doctorMode)) {
          log.success(`${cap.label} — authenticated`);
        }
        const accepted = await confirmAuthenticatedAccount(
          cap,
          doctorMode,
          assumeYes,
        );
        if (!accepted) {
          followUpItems.push(
            `Authenticate ${cap.label} with the intended account, then re-run bootstrap.`,
          );
          return { success: false, followUpItems };
        }
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

async function confirmAuthenticatedAccount(
  cap: CapabilityConfig,
  doctorMode: boolean,
  assumeYes: boolean,
): Promise<boolean> {
  if (doctorMode || assumeYes) {
    return true;
  }

  const account = authenticatedAccountDetail(cap);
  const confirmed = await promptConfirm(
    formatAuthenticatedAccountPrompt(account),
    true,
  );
  if (shouldAcceptAuthenticatedAccount(assumeYes, confirmed)) {
    return true;
  }

  log.warn(`${cap.label} account rejected`);
  const auth = cap.auth;
  if (!auth) {
    return false;
  }
  const shouldAuth = await promptConfirm(
    [
      `Switch ${cap.label} account now?`,
      "",
      "The previous account was rejected.",
      `Bootstrap will run: ${auth.loginCommand}`,
      "",
      "Choose Yes to log in with the intended account before continuing.",
    ].join("\n"),
    true,
  );
  if (!shouldAuth) {
    return false;
  }
  if (!runInteractiveCommand(auth.loginCommand)) {
    log.error(`${cap.label} — login failed`);
    return false;
  }
  const recheck = runCommand(auth.checkCommand);
  if (!recheck.ok) {
    log.warn(`${cap.label} — login completed but verification failed`);
    return false;
  }
  return confirmAuthenticatedAccount(cap, doctorMode, assumeYes);
}
