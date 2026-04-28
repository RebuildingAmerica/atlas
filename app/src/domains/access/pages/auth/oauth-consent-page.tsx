import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/platform/ui/button";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { getAtlasSession } from "@/domains/access/session.functions";
import type {
  AtlasSessionPayload,
  AtlasWorkspaceMembership,
} from "@/domains/access/organization-contracts";

/**
 * Search params accepted by the OAuth consent route.
 */
export const oauthConsentSearchSchema = z.object({
  client_id: z.string(),
  scope: z.string().optional(),
  redirect_uri: z.string().optional(),
});

/**
 * Returns the hostname Atlas should display next to the consent prompt when
 * the redirect URI is meaningful (CIMD clients, dynamically registered
 * clients).  Returns null for invalid URIs so callers can hide the line.
 */
function safeRedirectHostname(redirectUri: string | undefined): string | null {
  if (!redirectUri) return null;
  try {
    return new URL(redirectUri).host;
  } catch {
    return null;
  }
}

/**
 * True when `clientId` looks like a Client ID Metadata Document URL.  A
 * URL-shaped `client_id` triggers extra UI affordances (showing the
 * client_id origin, calling out the document model) so the operator can
 * tell whether the request comes from a CIMD client.
 */
function isUrlShapedClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}

const ORG_SCOPE_PREFIX = "org:";

/**
 * Returns true when the requested scope already pins an organization with
 * `org:{id}`.  When this is the case the consent UI hides the picker and
 * defers to the explicit scope so the chosen workspace is what the
 * customAccessTokenClaims callback ultimately binds.
 */
function scopeAlreadyPinsOrg(scope: string | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).some((token) => token.startsWith(ORG_SCOPE_PREFIX));
}

/**
 * Composes the final scope string Atlas sends to Better Auth's consent
 * endpoint.  When the requesting client did not bind a workspace
 * explicitly and the operator picked one in the picker, append
 * `org:{id}` so the JWT's `org_id` claim flows from the chosen workspace.
 */
function withWorkspaceScope(scope: string | undefined, workspaceId: string | null): string {
  const base = scope?.trim() ?? "";
  if (!workspaceId || scopeAlreadyPinsOrg(base)) {
    return base;
  }
  return base ? `${base} ${ORG_SCOPE_PREFIX}${workspaceId}` : `${ORG_SCOPE_PREFIX}${workspaceId}`;
}

const SCOPE_LABELS: Record<string, { title: string; description: string }> = {
  openid: { title: "Basic identity", description: "Your account identifier" },
  profile: { title: "Profile", description: "Your name and avatar" },
  email: { title: "Email address", description: "Your verified email" },
  offline_access: { title: "Persistent access", description: "Maintain access between sessions" },
  "discovery:read": { title: "View discoveries", description: "Read discovery runs and results" },
  "discovery:write": { title: "Manage discoveries", description: "Create and run discoveries" },
  "entities:write": { title: "Edit entities", description: "Create and update catalog entries" },
};

interface OAuthPublicClientResponse {
  name?: string;
  icon?: string;
  uri?: string;
}

interface ClientInfo {
  name: string;
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
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
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
        throw new Error(result.error.message || "Could not grant access.");
      }
      if (result.data?.redirect && result.data.url) {
        window.location.assign(result.data.url);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not grant access.");
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
        throw new Error(result.error.message || "Could not deny access.");
      }
      if (result.data?.redirect && result.data.url) {
        window.location.assign(result.data.url);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not deny access.");
    } finally {
      setIsDenying(false);
    }
  };

  const clientName = clientInfo?.name ?? "Unknown app";
  const isBusy = isAllowing || isDenying;
  const redirectHostname = safeRedirectHostname(redirectUri);
  const isCimdClient = isUrlShapedClientId(clientId);

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
            <div className="flex items-center gap-4">
              {clientInfo?.icon ? (
                <img
                  src={clientInfo.icon}
                  alt=""
                  className="border-border h-10 w-10 rounded-xl border"
                />
              ) : (
                <div className="border-border bg-surface-container-lowest text-ink-muted flex h-10 w-10 items-center justify-center rounded-xl border">
                  <span className="type-title-small">{clientName.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <div>
                <p className="type-title-medium text-ink-strong">{clientName}</p>
                {clientInfo?.uri ? (
                  <p className="type-body-small text-ink-muted">{clientInfo.uri}</p>
                ) : null}
                {isCimdClient ? (
                  <p className="type-body-small text-ink-muted break-all">
                    Client ID document: {clientId}
                  </p>
                ) : null}
              </div>
            </div>

            <p className="type-body-medium text-ink-soft">
              <span className="text-ink-strong font-medium">{clientName}</span> is requesting access
              to your Atlas account.
              {redirectHostname ? (
                <>
                  {" "}
                  After approval, Atlas will send you back to{" "}
                  <span className="text-ink-strong font-medium">{redirectHostname}</span>.
                </>
              ) : null}
            </p>

            {!workspaceScopePinned && memberships.length >= 2 ? (
              <div className="space-y-2">
                <p className="type-label-medium text-ink-muted">Workspace this app will see:</p>
                <ul className="space-y-2">
                  {memberships.map((membership) => (
                    <li
                      key={membership.id}
                      className="border-border bg-surface-container-lowest flex items-start gap-3 rounded-[1.4rem] border px-4 py-3"
                    >
                      <input
                        type="radio"
                        name="workspace"
                        id={`workspace-${membership.id}`}
                        value={membership.id}
                        checked={selectedWorkspaceId === membership.id}
                        onChange={() => {
                          setSelectedWorkspaceId(membership.id);
                        }}
                        className="mt-1"
                      />
                      <label
                        htmlFor={`workspace-${membership.id}`}
                        className="flex-1 cursor-pointer"
                      >
                        <p className="type-title-small text-ink-strong">{membership.name}</p>
                        <p className="type-body-small text-ink-soft mt-0.5">
                          Role: {membership.role}
                        </p>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!workspaceScopePinned && memberships.length === 1 && memberships[0] ? (
              <p className="type-body-small text-ink-soft">
                Tokens will be scoped to your workspace,{" "}
                <span className="text-ink-strong font-medium">{memberships[0].name}</span>.
              </p>
            ) : null}

            {scopes.length > 0 ? (
              <div className="space-y-2">
                <p className="type-label-medium text-ink-muted">This will allow the app to:</p>
                <ul className="space-y-2">
                  {scopes.map((s) => {
                    const label = SCOPE_LABELS[s];
                    return (
                      <li
                        key={s}
                        className="border-border bg-surface-container-lowest rounded-[1.4rem] border px-4 py-3"
                      >
                        <p className="type-title-small text-ink-strong">{label?.title ?? s}</p>
                        {label?.description ? (
                          <p className="type-body-small text-ink-soft mt-0.5">
                            {label.description}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
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
