import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { atprotoIdentitiesQueryKey } from "@/domains/access/atproto-identities";
import { createApiKey, deleteApiKey, listApiKeys } from "@/domains/access/api-keys.functions";
import { type ApiKeyScope } from "@rebuildingamerica/atlas-access/api-key-scopes";
import { hasSerializedCapability } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { resolvePasskeyName } from "@rebuildingamerica/atlas-access/passkey-names";
import { signalUnknownPasskey } from "@rebuildingamerica/atlas-access/passkey-signal";
import { deletePasskey, listPasskeys, updatePasskey } from "@/domains/access/passkeys.functions";
import { listScoutDevices, revokeScoutDevice } from "@/domains/access/scout-devices.functions";
import { AccountBillingSection } from "./components/account/billing";
import { AccountDeveloperSection } from "./components/account/developer";
import { AccountIdentitySection } from "./components/account/identity";
import type { AccountApiKeyRecord } from "./components/account/keys";
import { AccountLayout } from "./components/account/layout";
import type { AccountPasskeyRecord } from "./components/account/passkeys";
import { AccountProfileSection } from "./components/account/profile";
import { AccountScoutSection, type AccountScoutDeviceRecord } from "./components/account/scout";
import { AccountSecuritySection } from "./components/account/security";
import type { AccountTab } from "./components/account/tabs";
import {
  type McpElicitationCompleteResponse,
  useMcpElicitationCompletion,
} from "./mcp-elicitation-completion";

const PASSKEYS_QUERY_KEY = ["auth", "passkeys"] as const;
const API_KEYS_QUERY_KEY = ["auth", "api-keys"] as const;
const SCOUT_DEVICES_QUERY_KEY = ["auth", "scout-devices"] as const;

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

function mcpCompletionMessage(targetFlow: string): string {
  if (targetFlow === "billing_settings") {
    return "You can return to your assistant to continue billing setup.";
  }
  if (targetFlow === "api_key_settings") {
    return "You can return to your assistant to continue API key setup.";
  }
  return "You can return to your assistant to continue from account settings.";
}

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
  const hasSession = atlasSession.data != null;
  const handleMcpCompletion = useCallback((response: McpElicitationCompleteResponse) => {
    setFlashMessage(mcpCompletionMessage(response.target_flow));
  }, []);

  const passkeysQuery = useQuery<AccountPasskeyRecord[]>({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: listPasskeys,
  });
  const deletePasskeyMutation = useMutation({
    mutationFn: (id: string) => deletePasskey({ data: { id } }),
    onSuccess: async (_data, id) => {
      setFlashMessage("Passkey removed.");
      signalUnknownPasskey(id);
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
  const scoutDevicesQuery = useQuery<AccountScoutDeviceRecord[]>({
    queryKey: SCOUT_DEVICES_QUERY_KEY,
    queryFn: listScoutDevices,
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
  const revokeScoutDeviceMutation = useMutation({
    mutationFn: (deviceId: string) => revokeScoutDevice({ data: { deviceId } }),
    onSuccess: async () => {
      setErrorMessage(null);
      setFlashMessage("Scout device revoked.");
      await queryClient.invalidateQueries({ queryKey: SCOUT_DEVICES_QUERY_KEY });
    },
    onError: () => {
      setErrorMessage("Atlas could not revoke that Scout device. Please try again.");
    },
  });

  useMcpElicitationCompletion({
    enabled: hasSession,
    onComplete: handleMcpCompletion,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("atprotoStatus");
    const error = params.get("atprotoError");
    if (status === "connected") {
      setErrorMessage(null);
      setFlashMessage("ATProto account connected.");
      void queryClient.invalidateQueries({ queryKey: atprotoIdentitiesQueryKey });
    } else if (error) {
      setFlashMessage(null);
      setErrorMessage(error);
    } else {
      return;
    }
    window.history.replaceState(null, "", "/account#identity");
  }, [queryClient]);

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

  const showSecuritySection = hasSession && !isLocal;
  const showIdentitySection = hasSession && !isLocal;
  const showDeveloperSection = hasSession && !isLocal && canCreateApiKeys;
  const showScoutSection = hasSession && !isLocal;
  const showBillingSection = hasSession && !isLocal;
  const tabs: AccountTab[] = [
    { id: "profile", label: "Profile" },
    ...(showIdentitySection ? [{ id: "identity", label: "Identity" }] : []),
    ...(showSecuritySection ? [{ id: "security", label: "Security" }] : []),
    ...(showDeveloperSection ? [{ id: "developer", label: "Developer" }] : []),
    ...(showScoutSection ? [{ id: "scout", label: "Scout" }] : []),
    ...(showBillingSection ? [{ id: "billing", label: "Billing" }] : []),
  ];

  const toggleScope = (scope: ApiKeyScope) => {
    setApiKeyScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  return (
    <AccountLayout
      email={atlasSession.data?.user.email}
      errorMessage={errorMessage}
      flashMessage={flashMessage}
      name={atlasSession.data?.user.name}
      tabs={tabs}
    >
      <AccountProfileSection
        activeWorkspaceName={activeWorkspace?.name ?? null}
        email={atlasSession.data?.user.email}
        hasPendingInvitations={hasPendingInvitations}
        isLocal={isLocal}
        name={atlasSession.data?.user.name}
        needsWorkspace={needsWorkspace}
      />

      {showIdentitySection ? <AccountIdentitySection /> : null}

      {showSecuritySection ? (
        <AccountSecuritySection
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

      {showDeveloperSection ? (
        <AccountDeveloperSection
          apiKeyName={apiKeyName}
          apiKeyScopes={apiKeyScopes}
          apiKeySecret={apiKeySecret}
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

      {showScoutSection ? (
        <AccountScoutSection
          devices={scoutDevicesQuery.data}
          isError={scoutDevicesQuery.isError}
          isRevokePending={revokeScoutDeviceMutation.isPending}
          onRevoke={(id) => {
            setFlashMessage(null);
            setErrorMessage(null);
            revokeScoutDeviceMutation.mutate(id);
          }}
        />
      ) : null}

      {showBillingSection ? (
        <AccountBillingSection activeProducts={atlasSession.data?.workspace.activeProducts ?? []} />
      ) : null}
    </AccountLayout>
  );
}
