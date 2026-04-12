import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/platform/ui/button";
import { getAuthClient } from "../client/auth-client";

/**
 * Search params accepted by the OAuth consent route.
 */
export const oauthConsentSearchSchema = z.object({
  client_id: z.string(),
  scope: z.string().optional(),
});

const SCOPE_LABELS: Record<string, { title: string; description: string }> = {
  openid: { title: "Basic identity", description: "Your account identifier" },
  profile: { title: "Profile", description: "Your name and avatar" },
  email: { title: "Email address", description: "Your verified email" },
  offline_access: { title: "Persistent access", description: "Access when you're offline" },
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
export function OAuthConsentPage({ clientId, scope }: { clientId: string; scope?: string }) {
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [isLoadingClient, setIsLoadingClient] = useState(true);
  const [clientError, setClientError] = useState<string | null>(null);

  const [isAllowing, setIsAllowing] = useState(false);
  const [isDenying, setIsDenying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scopes = scope ? scope.split(" ").filter(Boolean) : [];

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

  const handleAllow = async () => {
    setErrorMessage(null);
    setIsAllowing(true);

    try {
      const result = await getAuthClient().oauth2.consent({
        accept: true,
        scope,
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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="type-label-medium text-[var(--ink-muted)]">Authorization Request</p>
        <h1 className="type-display-small text-[var(--ink-strong)]">Grant access?</h1>
      </div>

      <div className="space-y-5 rounded-[1.8rem] border border-[var(--border-strong)] bg-[var(--surface-container-lowest)] p-6">
        {isLoadingClient ? (
          <p className="type-body-medium text-[var(--ink-soft)]">Loading application details...</p>
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
                  className="h-10 w-10 rounded-xl border border-[var(--border)]"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-container-lowest)] text-[var(--ink-muted)]">
                  <span className="type-title-small">{clientName.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <div>
                <p className="type-title-medium text-[var(--ink-strong)]">{clientName}</p>
                {clientInfo?.uri ? (
                  <p className="type-body-small text-[var(--ink-muted)]">{clientInfo.uri}</p>
                ) : null}
              </div>
            </div>

            <p className="type-body-medium text-[var(--ink-soft)]">
              <span className="font-medium text-[var(--ink-strong)]">{clientName}</span> is
              requesting access to your Atlas account.
            </p>

            {scopes.length > 0 ? (
              <div className="space-y-2">
                <p className="type-label-medium text-[var(--ink-muted)]">
                  This will allow the app to:
                </p>
                <ul className="space-y-2">
                  {scopes.map((s) => {
                    const label = SCOPE_LABELS[s];
                    return (
                      <li
                        key={s}
                        className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-container-lowest)] px-4 py-3"
                      >
                        <p className="type-title-small text-[var(--ink-strong)]">
                          {label?.title ?? s}
                        </p>
                        {label?.description ? (
                          <p className="type-body-small mt-0.5 text-[var(--ink-soft)]">
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
