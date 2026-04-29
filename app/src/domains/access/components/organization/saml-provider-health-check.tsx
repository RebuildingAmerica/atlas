import { useRef, useState } from "react";
import {
  type AtlasSAMLProviderHealth,
  checkWorkspaceSAMLProviderHealth,
} from "../../sso.functions";
import { Button } from "@/platform/ui/button";

/**
 * Returns true when a health-check result indicates a healthy SAML
 * provider — entry point reachable, certificate parseable, not expired.
 * Drives the top-line verdict banner.
 */
function isHealthyResult(result: AtlasSAMLProviderHealth): boolean {
  return (
    result.entryPointReachable &&
    result.certificateValid !== false &&
    result.certificateExpired !== true &&
    !result.reason
  );
}

/**
 * Renders the most recent SAML provider health-check result.  Pings the
 * IdP entry point and inspects the stored signing certificate; does not
 * run a full AuthnRequest.  Auto-runs lazily on first disclosure open
 * instead of mount so a workspace with several SAML providers does not
 * fan out N parallel probes.
 */
export function SamlProviderHealthCheck({ providerId }: { providerId: string }) {
  const [result, setResult] = useState<AtlasSAMLProviderHealth | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAutoRunRef = useRef(false);

  async function runCheck() {
    setPending(true);
    setError(null);
    try {
      const checkResult = await checkWorkspaceSAMLProviderHealth({
        data: { providerId },
      });
      setResult(checkResult);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Atlas could not run the SAML health check.",
      );
    } finally {
      setPending(false);
    }
  }

  function handleToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && !hasAutoRunRef.current) {
      hasAutoRunRef.current = true;
      void runCheck();
    }
  }

  const verdict = result ? (isHealthyResult(result) ? "healthy" : "unhealthy") : null;

  return (
    <details className="text-outline space-y-2" onToggle={handleToggle}>
      <summary className="type-label-medium cursor-pointer">SAML health check</summary>
      {verdict ? (
        <p
          className={`type-label-medium rounded-2xl px-3 py-2 ${
            verdict === "healthy" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
          }`}
          role="status"
        >
          {verdict === "healthy"
            ? "Provider looks healthy — entry point reachable and certificate valid."
            : "Provider needs attention — review the details below before telling users to sign in."}
        </p>
      ) : null}
      <p className="type-body-small text-outline">
        Pings the IdP entry point and inspects the stored signing certificate. Does not start a full
        sign-in flow.
      </p>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          void runCheck();
        }}
      >
        {pending ? "Checking..." : "Re-run health check"}
      </Button>
      {error ? <p className="type-body-small text-error">{error}</p> : null}
      {result ? (
        <ul className="type-body-small text-outline list-disc space-y-1 pl-5">
          <li>
            IdP entry point:{" "}
            {result.entryPointReachable
              ? `reachable (HTTP ${String(result.entryPointStatus ?? "?")})`
              : `unreachable${result.entryPointStatus ? ` (HTTP ${String(result.entryPointStatus)})` : ""}`}
          </li>
          <li>
            Signing certificate:{" "}
            {result.certificateValid === false
              ? "could not parse"
              : result.certificateExpired === true
                ? `expired ${result.certificateNotAfter ?? ""}`
                : result.certificateExpired === false
                  ? `valid (expires ${result.certificateNotAfter ?? "unknown"})`
                  : "unknown"}
          </li>
          {result.reason ? <li>Notes: {result.reason}</li> : null}
        </ul>
      ) : null}
    </details>
  );
}
