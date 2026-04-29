import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/platform/ui/button";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { getAtlasSession } from "@/domains/access/session.functions";
import type {
  AtlasSessionPayload,
  AtlasWorkspaceMembership,
} from "@/domains/access/organization-contracts";
import {
  safeRedirectHostname,
  scopeAlreadyPinsOrg,
  withWorkspaceScope,
} from "./oauth-consent-helpers";
import { OAuthClientSummary, type OAuthClientInfo } from "./components/oauth-client-summary";
import { OAuthScopeList } from "./components/oauth-scope-list";
import { OAuthWorkspacePicker } from "./components/oauth-workspace-picker";

/**
 * Search params accepted by the OAuth consent route.
 */
export const oauthConsentSearchSchema = z.object({
  client_id: z.string(),
  scope: z.string().optional(),
  redirect_uri: z.string().optional(),
});

interface OAuthPublicClientResponse {
  name?: string;
  icon?: string;
  uri?: string;
}

/**
 * OAuth 2.1 consent page shown when a third-party app requests access
 * to user resources.
 */
export function OAuthConsentPage({
  clientId,
  scope,
  redirectUri,
}: {
  clientId: string;
  scope?: string;
  redirectUri?: string;
}) {
  const [clientInfo, setClientInfo] = useState<OAuthClientInfo | null>(null);
  const [isLoadingClient, setIsLoadingClient] = useState(true);
  const [clientError, setClientError] = useState<string | null>(null);

  const [isAllowing, setIsAllowing] = useState(false);
  const [isDenying, setIsDenying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<AtlasWorkspaceMembership[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const scopes = scope ? scope.split(" ").filter(Boolean) : [];
  const workspaceScopePinned = scopeAlreadyPinsOrg(scope);

  useEffect(() => {
    let active = true;

    async function fetchClient() {
      try {
        const params = new URLSearchParams({ client_id: clientId });
        const response = await fetch(`/api/auth/oauth2/public-client?${params.toString()}`, {
          credentials: "include",
        });
        if (!active) return;
        if (!response.ok) {
          setClientError("Could not load application details.");
          return;
        }
        const data = (await response.json()) as OAuthPublicClientResponse;
        setClientInfo({
          name: data.name ?? "Unknown app",
          icon: data.icon,
          uri: data.uri,
        });
      } catch {
        if (!active) return;
        setClientError("Could not load application details.");
      } finally {
        if (active) setIsLoadingClient(false);
      }
    }

    void fetchClient();

    return () => {
      active = false;
    };
  }, [clientId]);

  useEffect(() => {
    let active = true;

    async function loadWorkspaceMemberships() {
      try {
        const session: AtlasSessionPayload | null = await getAtlasSession();
        if (!active) return;

        const list = session?.workspace.memberships ?? [];
        setMemberships(list);
        if (list.length === 1) {
          setSelectedWorkspaceId(list[0]?.id ?? null);
        } else if (list.length > 1) {
          const activeId = session?.workspace.activeOrganization?.id;
          setSelectedWorkspaceId(activeId ?? list[0]?.id ?? null);
        }
      } catch {
        // Workspace lookup is best-effort; fall back to the API-side
        // resolvePrimaryWorkspaceId default if the session call fails.
      }
    }

    void loadWorkspaceMemberships();

    return () => {
      active = false;
    };
  }, []);

  const handleAllow = async () => {
    setErrorMessage(null);
    setIsAllowing(true);

    try {
      const finalScope = workspaceScopePinned
        ? scope
        : withWorkspaceScope(scope, selectedWorkspaceId);

      const result = await getAuthClient().oauth2.consent({
        accept: true,
        scope: finalScope,
      });
      if (result.error) {
        setErrorMessage("Access could not be granted. Please try again.");
        return;
      }
      if (result.data?.redirect && result.data.url) {
        window.location.assign(result.data.url);
      }
    } catch {
      setErrorMessage("Access could not be granted. Please try again.");
    } finally {
      setIsAllowing(false);
    }
  };

  const handleDeny = async () => {
    setErrorMessage(null);
    setIsDenying(true);

    try {
      const result = await getAuthClient().oauth2.consent({
        accept: false,
      });
      if (result.error) {
        setErrorMessage("Access could not be denied. Please try again.");
        return;
      }
      if (result.data?.redirect && result.data.url) {
        window.location.assign(result.data.url);
      }
    } catch {
      setErrorMessage("Access could not be denied. Please try again.");
    } finally {
      setIsDenying(false);
    }
  };

  const isBusy = isAllowing || isDenying;
  const redirectHostname = safeRedirectHostname(redirectUri);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="type-label-medium text-ink-muted">Authorization Request</p>
        <h1 className="type-display-small text-ink-strong">Allow access to Atlas?</h1>
      </div>

      <div className="border-border-strong bg-surface-container-lowest space-y-5 rounded-[1.8rem] border p-6">
        {isLoadingClient ? (
          <p className="type-body-medium text-ink-soft">Loading application details...</p>
        ) : clientError ? (
          <p className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-700">
            {clientError}
          </p>
        ) : (
          <>
            <OAuthClientSummary
              clientId={clientId}
              clientInfo={clientInfo}
              redirectHostname={redirectHostname}
            />

            {!workspaceScopePinned ? (
              <OAuthWorkspacePicker
                memberships={memberships}
                selectedWorkspaceId={selectedWorkspaceId}
                onSelect={setSelectedWorkspaceId}
              />
            ) : null}

            <OAuthScopeList scopes={scopes} />
          </>
        )}

        {!isLoadingClient && !clientError ? (
          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={() => {
                void handleAllow();
              }}
              disabled={isBusy}
            >
              {isAllowing ? "Allowing..." : "Allow"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void handleDeny();
              }}
              disabled={isBusy}
            >
              {isDenying ? "Denying..." : "Deny"}
            </Button>
          </div>
        ) : null}

        {errorMessage ? (
          <p className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-700">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
