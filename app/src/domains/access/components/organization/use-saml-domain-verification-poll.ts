import { useEffect, useRef, useState } from "react";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";
import { verifyWorkspaceSSODomain } from "@/domains/access/sso.functions";

const POLL_INTERVAL_MS = 30 * 1000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_STORAGE_PREFIX = "atlas:saml-poll-started:";

/**
 * Returns the persisted poll-started timestamp for a provider fingerprint
 * if the prior poll is still inside its budget, otherwise null.  Lets the
 * verification poll survive a page refresh without restarting the
 * 10-minute budget — admins who reload to recheck DNS shouldn't get
 * another full window.
 */
function readStoredPollStart(fingerprint: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(POLL_STORAGE_PREFIX + fingerprint);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  if (Date.now() - parsed > POLL_TIMEOUT_MS) {
    window.localStorage.removeItem(POLL_STORAGE_PREFIX + fingerprint);
    return null;
  }
  return parsed;
}

function writeStoredPollStart(fingerprint: string, startedAt: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POLL_STORAGE_PREFIX + fingerprint, String(startedAt));
}

function clearStoredPollStart(fingerprint: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(POLL_STORAGE_PREFIX + fingerprint);
}

/**
 * Result returned to the SSO page so it can render a "we stopped polling"
 * banner once the auto-poll runs past its budget without all providers
 * verifying.  Re-arms once the set of pending providers changes.
 */
export interface SamlDomainVerificationPollState {
  timedOutProviderIds: readonly string[];
}

/**
 * Returns the provider IDs that still need DNS-TXT verification but already
 * have a token published, so the auto-poll only chases providers where the
 * admin has plausibly published the record.
 *
 * @param organization - The current organization details.
 */
function listPendingProviderIds(
  organization: AtlasOrganizationDetails | null | undefined,
): string[] {
  const providers = organization?.sso?.providers;
  if (!providers) {
    return [];
  }
  return providers
    .filter((provider) => !provider.domainVerified && provider.domainVerificationTokenAvailable)
    .map((provider) => provider.providerId);
}

/**
 * Periodically nudges Better Auth to re-check DNS-TXT verification for any
 * SSO provider that still has a pending domain.  The poll runs silently —
 * the admin sees the existing "Verify domain" button update its state when
 * verification eventually succeeds, but no flash banner fires for each
 * background attempt.
 *
 * The poll stops automatically once every provider has been verified or
 * after `POLL_TIMEOUT_MS`, whichever comes first.  The admin can still
 * click "Verify domain" manually at any time.
 *
 * @param params - Hook inputs.
 * @param params.organization - The current organization details query data.
 * @param params.refreshWorkspaceData - Shared callback that re-fetches the
 *   session and organization queries after a successful verification.
 */
export function useSamlDomainVerificationPoll(params: {
  organization: AtlasOrganizationDetails | null | undefined;
  refreshWorkspaceData: () => Promise<void>;
}): SamlDomainVerificationPollState {
  const { organization, refreshWorkspaceData } = params;
  const pendingProviderIds = listPendingProviderIds(organization);
  const fingerprint = pendingProviderIds.join(",");
  const refreshRef = useRef(refreshWorkspaceData);
  refreshRef.current = refreshWorkspaceData;
  const [timedOutProviderIds, setTimedOutProviderIds] = useState<readonly string[]>([]);

  useEffect(() => {
    setTimedOutProviderIds([]);
    if (fingerprint === "") {
      return;
    }

    const targetProviderIds = fingerprint.split(",");
    const persistedStart = readStoredPollStart(fingerprint);
    const startedAt = persistedStart ?? Date.now();
    if (persistedStart === null) {
      writeStoredPollStart(fingerprint, startedAt);
    }
    let cancelled = false;

    async function attemptOnce() {
      let anySucceeded = false;
      for (const providerId of targetProviderIds) {
        try {
          await verifyWorkspaceSSODomain({ data: { providerId } });
          anySucceeded = true;
        } catch {
          // DNS not propagated yet, or the provider was deleted; keep
          // polling until the timeout fires.
        }
      }
      if (!cancelled && anySucceeded) {
        await refreshRef.current();
      }
    }

    const intervalId = setInterval(() => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(intervalId);
        clearStoredPollStart(fingerprint);
        setTimedOutProviderIds(targetProviderIds);
        return;
      }
      void attemptOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [fingerprint]);

  return { timedOutProviderIds };
}
