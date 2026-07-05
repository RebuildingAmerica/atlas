import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createApiKey, deleteApiKey, listApiKeys } from "@/domains/access/api-keys.functions";
import { type ApiKeyScope } from "@/domains/access/api-key-scopes";
import { hasSerializedCapability } from "@/domains/access/capabilities";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { resolvePasskeyName } from "@/domains/access/passkey-names";
import { deletePasskey, listPasskeys, updatePasskey } from "@/domains/access/passkeys.functions";
import { listScoutDevices, revokeScoutDevice } from "@/domains/access/scout-devices.functions";
import { WorkspaceBillingSection } from "@/domains/billing/components/workspace-billing-section";
import { AccountDeveloperAccessSection } from "./components/account-developer-access-section";
import { AccountHeader } from "./components/account-header";
import { AccountPageFeedback } from "./components/account-page-feedback";
import type { AccountApiKeyRecord } from "./components/account-api-keys-section";
import type { AccountPasskeyRecord } from "./components/account-passkeys-section";
import { AccountSecuritySection } from "./components/account-security-section";
import type { AccountScoutDeviceRecord } from "./components/account-scout-devices-section";
import { AccountWorkspaceCards } from "./components/account-workspace-cards";

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

  const showSecuritySection = !isLocal;
  const showDeveloperAccessSection = !isLocal;
  const showBillingSection = !isLocal;

  const toggleScope = (scope: ApiKeyScope) => {
    setApiKeyScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-10 py-8">
      <AccountHeader email={atlasSession.data?.user.email} name={atlasSession.data?.user.name} />

      <AccountPageFeedback errorMessage={errorMessage} flashMessage={flashMessage} />

      <AccountWorkspaceCards
        activeWorkspaceName={activeWorkspace?.name ?? null}
        hasPendingInvitations={hasPendingInvitations}
        isLocal={isLocal}
        needsWorkspace={needsWorkspace}
      />

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

      {showDeveloperAccessSection ? (
        <AccountDeveloperAccessSection
          apiKeyName={apiKeyName}
          apiKeyScopes={apiKeyScopes}
          apiKeySecret={apiKeySecret}
          apiKeys={apiKeysQuery.data}
          canCreateApiKeys={canCreateApiKeys}
          devices={scoutDevicesQuery.data}
          isCreatePending={createApiKeyMutation.isPending}
          isDeletePending={deleteApiKeyMutation.isPending}
          isError={apiKeysQuery.isError}
          isLocal={isLocal}
          isRevokePending={revokeScoutDeviceMutation.isPending}
          isScoutDevicesError={scoutDevicesQuery.isError}
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
          onRevoke={(id) => {
            setFlashMessage(null);
            setErrorMessage(null);
            revokeScoutDeviceMutation.mutate(id);
          }}
          onToggleScope={toggleScope}
        />
      ) : null}

      {showBillingSection ? (
        <section id="billing" className="scroll-mt-24">
          <WorkspaceBillingSection
            activeProducts={atlasSession.data?.workspace.activeProducts ?? []}
          />
        </section>
      ) : null}
    </div>
  );
}
