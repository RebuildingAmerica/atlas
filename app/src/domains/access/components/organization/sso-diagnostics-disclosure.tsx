import { useEffect, useState } from "react";
import { Button } from "@/platform/ui/button";
import {
  clearSsoDiagnostics,
  readSsoDiagnostics,
  type SsoDiagnosticsEntry,
} from "../../client/sso-diagnostics-log";

/**
 * Disclosure surface that lists recent SSO sign-in failures recorded on
 * the operator's device.  Useful as a first-pass triage tool when a
 * teammate reports "I can't sign in" and the workspace admin hasn't yet
 * checked the IdP-side trace.  The store is local-only — Atlas does not
 * aggregate failures across devices in this build.
 */
export function SsoDiagnosticsDisclosure() {
  const [entries, setEntries] = useState<SsoDiagnosticsEntry[]>([]);

  useEffect(() => {
    setEntries(readSsoDiagnostics());
  }, []);

  if (entries.length === 0) {
    return null;
  }

  return (
    <details className="border-outline-variant rounded-[1.25rem] border bg-white/70 p-4">
      <summary className="type-label-medium cursor-pointer">
        Recent SSO sign-in failures on this device ({entries.length})
      </summary>
      <ul className="type-body-small text-outline mt-3 space-y-2">
        {entries.map((entry) => (
          <li key={entry.recordedAt} className="space-y-0.5">
            <p className="text-on-surface">
              <code>{entry.code ?? "unknown"}</code> ·{" "}
              {new Date(entry.recordedAt).toISOString().slice(0, 19).replace("T", " ")}
              {entry.email ? ` · ${entry.email}` : ""}
            </p>
            {entry.message ? <p>{entry.message}</p> : null}
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            clearSsoDiagnostics();
            setEntries([]);
          }}
        >
          Clear log
        </Button>
      </div>
    </details>
  );
}
