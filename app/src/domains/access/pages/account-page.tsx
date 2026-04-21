import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { API_KEY_SCOPES, type ApiKeyScope } from "../api-key-scopes";
import { hasSerializedCapability } from "../capabilities";
import { createApiKey, deleteApiKey, listApiKeys } from "../api-keys.functions";
import { deletePasskey, listPasskeys, updatePasskey } from "../passkeys.functions";
import { resolvePasskeyName } from "../passkey-names";
import { getAuthClient } from "../client/auth-client";
import { atlasSessionQueryKey, useAtlasSession } from "../client/use-atlas-session";
import { WorkspaceBillingSection } from "../../billing/components/workspace-billing-section";

const PASSKEYS_QUERY_KEY = ["auth", "passkeys"] as const;
const API_KEYS_QUERY_KEY = ["auth", "api-keys"] as const;

interface AtlasApiKeyRecord {
  createdAt: string;
  id: string;
  name?: string | null;
  prefix?: string | null;
  scopes?: ApiKeyScope[];
}

interface AtlasPasskeyRecord {
  id: string;
  name?: string | null;
  deviceType: string;
  createdAt: string;
  backedUp: boolean;
}

/**
 * Loads passkeys into the account page's local record shape.
 */
async function loadAtlasPasskeys(): Promise<AtlasPasskeyRecord[]> {
  const passkeys = await listPasskeys();
  return passkeys;
}

/**
 * Loads API keys into the account page's local record shape.
 */
async function loadAtlasApiKeys(): Promise<AtlasApiKeyRecord[]> {
  const apiKeys = await listApiKeys();
  return apiKeys;
}

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
  const activeWorkspace = atlasSession.data?.workspace.activeOrganization ?? null;
  const needsWorkspace = atlasSession.data?.workspace.onboarding.needsWorkspace ?? false;
  const hasPendingInvitations =
    atlasSession.data?.workspace.onboarding.hasPendingInvitations ?? false;
  const canCreateApiKeys = atlasSession.data
    ? hasSerializedCapability(atlasSession.data.workspace.resolvedCapabilities, "api.keys")
    : false;
  const shouldShowOrganizationLink =
    atlasSession.data?.workspace.capabilities.canSwitchOrganizations ||
    activeWorkspace?.workspaceType === "team" ||
    needsWorkspace ||
    hasPendingInvitations;
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyScopes, setApiKeyScopes] = useState<ApiKeyScope[]>(["discovery:read"]);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [apiKeySecret, setApiKeySecret] = useState<string | null>(null);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState("");
  const passkeysQuery = useQuery<AtlasPasskeyRecord[]>({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: loadAtlasPasskeys,
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
  const apiKeysQuery = useQuery<AtlasApiKeyRecord[]>({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: loadAtlasApiKeys,
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

  const handleSignOut = async () => {
    await getAuthClient().signOut();
    window.location.assign("/");
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setApiKeyScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  return (
    <div className="space-y-8 py-2">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="type-label-medium text-ink-muted">Account</p>
          <h1 className="type-headline-large text-ink-strong">
            {atlasSession.data?.user.name?.trim() || "Atlas Operator"}
          </h1>
          <p className="type-body-large text-ink-soft">{atlasSession.data?.user.email}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            void handleSignOut();
          }}
        >
          <span className="inline-flex items-center gap-2">
            <LogOut className="h-4 w-4" />
            Sign out
          </span>
        </Button>
      </section>

      {flashMessage ? (
        <p className="type-body-medium bg-surface-container-lowest text-ink-strong rounded-2xl px-4 py-3">
          {flashMessage}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="type-body-medium border-border-strong bg-surface text-ink-strong rounded-2xl border px-4 py-3">
          {errorMessage}
        </p>
      ) : null}

      {apiKeySecret ? (
        <div className="border-border-strong bg-surface rounded-[1.5rem] border p-5">
          <p className="type-title-small text-ink-strong">New API key</p>
          <p className="type-body-medium text-ink-soft mt-2 break-all">{apiKeySecret}</p>
        </div>
      ) : null}

      {needsWorkspace ? (
        <div className="border-border-strong bg-surface rounded-[1.5rem] border p-5">
          <p className="type-title-small text-ink-strong">Workspace setup is waiting</p>
          <p className="type-body-medium text-ink-soft mt-2">
            Finish creating your first workspace so Atlas can keep account security separate from
            workspace context.
          </p>
          <div className="mt-4">
            <Link className="type-label-large text-ink-strong underline" to="/organization">
              Open workspace setup
            </Link>
          </div>
        </div>
      ) : null}

      {hasPendingInvitations ? (
        <div className="border-border-strong bg-surface rounded-[1.5rem] border p-5">
          <p className="type-title-small text-ink-strong">Workspace invitations waiting</p>
          <p className="type-body-medium text-ink-soft mt-2">
            Review your pending invitations before Atlas decides which workspace should open next.
          </p>
          <div className="mt-4">
            <Link className="type-label-large text-ink-strong underline" to="/organization">
              Review invitations
            </Link>
          </div>
        </div>
      ) : null}

      {activeWorkspace ? (
        <div className="border-border bg-surface-container-lowest rounded-[1.5rem] border p-5">
          <p className="type-title-small text-ink-strong">Current workspace</p>
          <p className="type-body-medium text-ink-soft mt-2">
            {activeWorkspace.name} · {activeWorkspace.workspaceType} · {activeWorkspace.role}
          </p>
          {shouldShowOrganizationLink ? (
            <div className="mt-4">
              <Link className="type-label-large text-ink-strong underline" to="/organization">
                Manage workspace
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <WorkspaceBillingSection activeProducts={atlasSession.data?.workspace.activeProducts ?? []} />

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
          <div className="space-y-2">
            <h2 className="type-title-large text-ink-strong">Passkeys</h2>
            <p className="type-body-medium text-ink-soft">
              Register a passkey after your email-based sign-in so future access is faster.
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={isAddingPasskey}
            onClick={() => {
              void handlePasskeyAdd();
            }}
          >
            <span className="inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {isAddingPasskey ? "Adding passkey..." : "Add passkey"}
            </span>
          </Button>

          <div className="space-y-3">
            {passkeysQuery.data?.map((pk) => (
              <article
                key={pk.id}
                className="border-border flex items-center justify-between gap-3 rounded-2xl border bg-white/70 px-4 py-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  {editingPasskeyId === pk.id ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        renamePasskeyMutation.mutate({ id: pk.id, name: editingPasskeyName });
                      }}
                    >
                      <Input value={editingPasskeyName} onChange={setEditingPasskeyName} label="" />
                      <Button
                        type="submit"
                        variant="ghost"
                        disabled={!editingPasskeyName.trim() || renamePasskeyMutation.isPending}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setEditingPasskeyId(null);
                          setEditingPasskeyName("");
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </form>
                  ) : (
                    <p className="type-title-small text-ink-strong">
                      {pk.name || "Unnamed passkey"}
                    </p>
                  )}
                  <p className="type-body-small text-ink-soft">
                    {pk.deviceType === "platform" ? "Device passkey" : "Hardware key"}
                    {pk.backedUp ? " · synced" : ""}
                    {" · "}
                    {new Date(pk.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {editingPasskeyId !== pk.id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingPasskeyId(pk.id);
                        setEditingPasskeyName(pk.name ?? "");
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        deletePasskeyMutation.mutate(pk.id);
                      }}
                      disabled={deletePasskeyMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}

            {passkeysQuery.isError ? (
              <p className="type-body-medium text-ink-soft">
                Atlas could not load your passkeys right now.
              </p>
            ) : null}

            {passkeysQuery.data?.length === 0 ? (
              <p className="type-body-medium text-ink-soft">
                No passkeys yet. Add one above for faster sign-in.
              </p>
            ) : null}
          </div>
        </div>

        {canCreateApiKeys ? (
          <div className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
            <div className="space-y-2">
              <h2 className="type-title-large text-ink-strong">API keys</h2>
              <p className="type-body-medium text-ink-soft">
                Create keys for direct API access to protected Atlas endpoints.
              </p>
            </div>

            <div className="flex gap-3">
              <Input
                value={apiKeyName}
                onChange={setApiKeyName}
                placeholder="Desktop script"
                label="Key name"
              />
              <div className="pt-7">
                <Button
                  onClick={() => {
                    setFlashMessage(null);
                    setErrorMessage(null);
                    createApiKeyMutation.mutate({ name: apiKeyName, scopes: apiKeyScopes });
                  }}
                  disabled={
                    !apiKeyName || apiKeyScopes.length === 0 || createApiKeyMutation.isPending
                  }
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Create
                  </span>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="type-label-large text-ink-strong">Scopes</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {API_KEY_SCOPES.map((scope) => (
                  <label
                    key={scope}
                    className="border-border flex items-start gap-3 rounded-lg border px-3 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={apiKeyScopes.includes(scope)}
                      onChange={() => {
                        toggleScope(scope);
                      }}
                      className="mt-1"
                    />
                    <span className="type-title-small text-ink-strong block">{scope}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {apiKeysQuery.data?.map((apiKey) => (
                <article
                  key={apiKey.id}
                  className="border-border flex items-center justify-between gap-3 rounded-2xl border bg-white/70 px-4 py-3"
                >
                  <div>
                    <p className="type-title-small text-ink-strong">
                      {apiKey.name || "Untitled key"}
                    </p>
                    <p className="type-body-small text-ink-soft">
                      {apiKey.prefix || "atlas"} · {apiKey.createdAt}
                    </p>
                    <p className="type-body-small text-ink-soft">
                      {(apiKey.scopes ?? []).join(", ") || "No scopes"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFlashMessage(null);
                      setErrorMessage(null);
                      deleteApiKeyMutation.mutate(apiKey.id);
                    }}
                    disabled={deleteApiKeyMutation.isPending}
                  >
                    Revoke
                  </Button>
                </article>
              ))}

              {apiKeysQuery.isError ? (
                <p className="type-body-medium text-ink-soft">
                  Atlas could not load your API keys right now.
                </p>
              ) : null}

              {!apiKeysQuery.data?.length ? (
                <p className="type-body-medium text-ink-soft">
                  No API keys yet. Create one for scripts or CLI access.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
