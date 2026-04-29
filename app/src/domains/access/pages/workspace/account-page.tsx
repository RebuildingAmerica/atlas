import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createApiKey, deleteApiKey, listApiKeys } from "@/domains/access/api-keys.functions";
import { type ApiKeyScope } from "@/domains/access/api-key-scopes";
import { hasSerializedCapability } from "@/domains/access/capabilities";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { resolvePasskeyName } from "@/domains/access/passkey-names";
import { deletePasskey, listPasskeys, updatePasskey } from "@/domains/access/passkeys.functions";
import { getRpLogoutRedirect } from "@/domains/access/session.functions";
import { WorkspaceBillingSection } from "@/domains/billing/components/workspace-billing-section";
import { AccountHeader } from "./components/account-header";
import {
  AccountApiKeysSection,
  type AccountApiKeyRecord,
} from "./components/account-api-keys-section";
import {
  AccountPasskeysSection,
  type AccountPasskeyRecord,
} from "./components/account-passkeys-section";
import { AccountWorkspaceCards } from "./components/account-workspace-cards";

const PASSKEYS_QUERY_KEY = ["auth", "passkeys"] as const;
const API_KEYS_QUERY_KEY = ["auth", "api-keys"] as const;

/**
 * Reads the newly created API-key secret from the server response.
 *
 * @param result - The API-key creation response.
 */
function readCreatedApiKeySecret(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  if (!("key" in result)) {
    return null;
  }
  const { key } = result;
  return typeof key === "string" ? key : null;
}

/**
 * Operator account screen for passkeys and direct API-key management.
 *
 * This page is session-only; API keys are intentionally managed from the
 * browser operator session rather than from direct API-key auth.
 */
export function AccountPage() {
  const queryClient = useQueryClient();
  const atlasSession = useAtlasSession();
  const isLocal = atlasSession.data?.isLocal ?? false;
  const activeWorkspace = atlasSession.data?.workspace.activeOrganization ?? null;
  const needsWorkspace = atlasSession.data?.workspace.onboarding.needsWorkspace ?? false;
  const hasPendingInvitations =
    atlasSession.data?.workspace.onboarding.hasPendingInvitations ?? false;
  const canCreateApiKeys = atlasSession.data
    ? hasSerializedCapability(atlasSession.data.workspace.resolvedCapabilities, "api.keys")
    : false;
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyScopes, setApiKeyScopes] = useState<ApiKeyScope[]>(["discovery:read"]);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [apiKeySecret, setApiKeySecret] = useState<string | null>(null);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState("");

  const passkeysQuery = useQuery<AccountPasskeyRecord[]>({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: listPasskeys,
  });
  const deletePasskeyMutation = useMutation({
    mutationFn: (id: string) => deletePasskey({ data: { id } }),
    onSuccess: async () => {
      setFlashMessage("Passkey removed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: atlasSessionQueryKey }),
      ]);
    },
    onError: () => {
      setErrorMessage("Atlas could not remove that passkey. Please try again.");
    },
  });
  const renamePasskeyMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updatePasskey({ data: { id, name } }),
    onSuccess: async () => {
      setEditingPasskeyId(null);
      setEditingPasskeyName("");
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
    },
    onError: () => {
      setErrorMessage("Atlas could not rename that passkey. Please try again.");
    },
  });

  const apiKeysQuery = useQuery<AccountApiKeyRecord[]>({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: listApiKeys,
  });
  const createApiKeyMutation = useMutation({
    mutationFn: (data: { name: string; scopes: ApiKeyScope[] }) => createApiKey({ data }),
    onSuccess: async (result) => {
      setErrorMessage(null);
      setApiKeyName("");
      setApiKeyScopes(["discovery:read"]);
      setApiKeySecret(readCreatedApiKeySecret(result));
      setFlashMessage(
        "API key created. Copy it now, because Atlas will only show it once. Activation can take a few seconds.",
      );
      await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
    onError: () => {
      setApiKeySecret(null);
      setErrorMessage("Atlas could not create that API key. Please try again.");
    },
  });
  const deleteApiKeyMutation = useMutation({
    mutationFn: (keyId: string) => deleteApiKey({ data: { keyId } }),
    onSuccess: async () => {
      setErrorMessage(null);
      setFlashMessage("API key revoked.");
      setApiKeySecret(null);
      await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
    onError: () => {
      setErrorMessage("Atlas could not revoke that API key. Please try again.");
    },
  });

  const handlePasskeyAdd = async () => {
    setFlashMessage(null);
    setErrorMessage(null);
    setIsAddingPasskey(true);

    try {
      const result = await getAuthClient().passkey.addPasskey({});
      if (result?.error) {
        throw new Error(result.error.message || "Atlas could not add that passkey.");
      }
      if (result?.data) {
        const name = resolvePasskeyName(result.data.aaguid);
        await updatePasskey({ data: { id: result.data.id, name } });
      }
      setFlashMessage("Passkey added to your Atlas account.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: atlasSessionQueryKey }),
      ]);
    } catch {
      setErrorMessage("Atlas could not add that passkey. Please try again.");
    } finally {
      setIsAddingPasskey(false);
    }
  };

  // Resolve the OIDC RP-Initiated Logout URL once on mount.  We need it
  // both to render the "Atlas will also sign you out…" caption and to
  // hand off to the IdP at sign-out, so caching it here avoids a second
  // round trip on the click path.
  const [rpLogoutUrl, setRpLogoutUrl] = useState<string | null>(null);
  const [rpLogoutResolved, setRpLogoutResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getRpLogoutRedirect();
        if (cancelled) return;
        setRpLogoutUrl(result.url);
      } catch {
        // Treat as unavailable; fall through to setRpLogoutResolved.
      } finally {
        if (!cancelled) setRpLogoutResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rpLogoutAvailable = rpLogoutResolved ? rpLogoutUrl !== null : null;

  const handleSignOut = async () => {
    await getAuthClient().signOut();
    window.location.assign(rpLogoutUrl ?? "/");
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setApiKeyScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  return (
    <div className="space-y-8 py-2">
      <AccountHeader
        email={atlasSession.data?.user.email}
        isLocal={isLocal}
        name={atlasSession.data?.user.name}
        rpLogoutAvailable={rpLogoutAvailable}
        onSignOut={() => {
          void handleSignOut();
        }}
      />

      {flashMessage ? (
        <p className="type-body-medium bg-surface-container-lowest text-on-surface rounded-2xl px-4 py-3">
          {flashMessage}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="type-body-medium border-outline bg-surface text-on-surface rounded-2xl border px-4 py-3">
          {errorMessage}
        </p>
      ) : null}

      {apiKeySecret ? (
        <div className="border-outline bg-surface rounded-[1.5rem] border p-5">
          <p className="type-title-small text-on-surface">New API key</p>
          <p className="type-body-medium text-outline mt-2 break-all">{apiKeySecret}</p>
        </div>
      ) : null}

      <AccountWorkspaceCards
        activeWorkspaceName={activeWorkspace?.name ?? null}
        hasPendingInvitations={hasPendingInvitations}
        isLocal={isLocal}
        needsWorkspace={needsWorkspace}
      />

      {!isLocal ? (
        <WorkspaceBillingSection
          activeProducts={atlasSession.data?.workspace.activeProducts ?? []}
        />
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        {!isLocal ? (
          <AccountPasskeysSection
            editingPasskeyId={editingPasskeyId}
            editingPasskeyName={editingPasskeyName}
            isAddingPasskey={isAddingPasskey}
            isDeletePending={deletePasskeyMutation.isPending}
            isError={passkeysQuery.isError}
            isRenamePending={renamePasskeyMutation.isPending}
            passkeys={passkeysQuery.data}
            onAddPasskey={() => {
              void handlePasskeyAdd();
            }}
            onCancelRename={() => {
              setEditingPasskeyId(null);
              setEditingPasskeyName("");
            }}
            onDelete={(id) => {
              deletePasskeyMutation.mutate(id);
            }}
            onRenameChange={setEditingPasskeyName}
            onStartRename={(id, name) => {
              setEditingPasskeyId(id);
              setEditingPasskeyName(name);
            }}
            onSubmitRename={(id, name) => {
              renamePasskeyMutation.mutate({ id, name });
            }}
          />
        ) : null}

        {canCreateApiKeys ? (
          <AccountApiKeysSection
            apiKeyName={apiKeyName}
            apiKeyScopes={apiKeyScopes}
            apiKeys={apiKeysQuery.data}
            isCreatePending={createApiKeyMutation.isPending}
            isDeletePending={deleteApiKeyMutation.isPending}
            isError={apiKeysQuery.isError}
            onCreate={() => {
              setFlashMessage(null);
              setErrorMessage(null);
              createApiKeyMutation.mutate({ name: apiKeyName, scopes: apiKeyScopes });
            }}
            onDelete={(id) => {
              setFlashMessage(null);
              setErrorMessage(null);
              deleteApiKeyMutation.mutate(id);
            }}
            onNameChange={setApiKeyName}
            onToggleScope={toggleScope}
          />
        ) : null}
      </section>
    </div>
  );
}
