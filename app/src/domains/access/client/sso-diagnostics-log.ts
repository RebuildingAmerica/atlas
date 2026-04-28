/**
 * Bounded localStorage log of SSO sign-in failures Atlas surfaces in the
 * workspace's SSO diagnostics disclosure.  Local-only — no network round
 * trip — so an admin doesn't need a server-side dashboard to triage the
 * "user complained sign-in didn't work" case.
 *
 * The log is per-device.  Workspace-wide aggregation lives behind the
 * larger admin diagnostics dashboard task and is intentionally out of
 * scope for the localStorage shim.
 */
const STORAGE_KEY = "atlas:sso-diagnostics-log";
const MAX_ENTRIES = 25;

export interface SsoDiagnosticsEntry {
  code: string | null;
  email: string | null;
  message: string | null;
  recordedAt: string;
  workspaceSlug: string | null;
}

interface RawEntry {
  code?: unknown;
  email?: unknown;
  message?: unknown;
  recordedAt?: unknown;
  workspaceSlug?: unknown;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Appends one SSO-failure entry, capped at the most recent 25.
 */
export function recordSsoDiagnostics(entry: Omit<SsoDiagnosticsEntry, "recordedAt">): void {
  if (typeof window === "undefined") return;
  const next: SsoDiagnosticsEntry = {
    ...entry,
    recordedAt: new Date().toISOString(),
  };
  const existing = readSsoDiagnostics();
  const merged = [next, ...existing].slice(0, MAX_ENTRIES);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

/**
 * Returns the diagnostic log, oldest-last.  Malformed entries are skipped
 * so a hand-edited localStorage value cannot wedge the disclosure.
 */
export function readSsoDiagnostics(): SsoDiagnosticsEntry[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: SsoDiagnosticsEntry[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as RawEntry;
    const recordedAt = nullableString(raw.recordedAt);
    if (!recordedAt) continue;
    entries.push({
      code: nullableString(raw.code),
      email: nullableString(raw.email),
      message: nullableString(raw.message),
      recordedAt,
      workspaceSlug: nullableString(raw.workspaceSlug),
    });
  }
  return entries;
}

/**
 * Clears the diagnostic log; bound to the "Clear" button on the
 * disclosure so admins can dismiss noise after a triage session.
 */
export function clearSsoDiagnostics(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
