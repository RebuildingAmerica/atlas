import { Plus } from "lucide-react";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/domains/access/api-key-scopes";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

export interface AccountApiKeyRecord {
  createdAt: string;
  id: string;
  name?: string | null;
  prefix?: string | null;
  scopes?: ApiKeyScope[];
}

interface AccountApiKeysSectionProps {
  apiKeyName: string;
  apiKeyScopes: ApiKeyScope[];
  apiKeys: AccountApiKeyRecord[] | undefined;
  isCreatePending: boolean;
  isDeletePending: boolean;
  isError: boolean;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onNameChange: (value: string) => void;
  onToggleScope: (scope: ApiKeyScope) => void;
}

/**
 * Card on the account page for direct API-key creation and revocation.
 * The form is intentionally session-only — Atlas keeps API-key
 * provisioning attached to the operator's browser session rather than
 * letting an existing API key mint more API keys.
 */
export function AccountApiKeysSection({
  apiKeyName,
  apiKeyScopes,
  apiKeys,
  isCreatePending,
  isDeletePending,
  isError,
  onCreate,
  onDelete,
  onNameChange,
  onToggleScope,
}: AccountApiKeysSectionProps) {
  return (
    <div className="border-outline bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-on-surface">API keys</h2>
        <p className="type-body-medium text-outline">
          Create keys for direct API access to protected Atlas endpoints.
        </p>
      </div>

      <div className="flex gap-3">
        <Input
          value={apiKeyName}
          onChange={onNameChange}
          placeholder="Desktop script"
          label="Key name"
        />
        <div className="pt-7">
          <Button
            onClick={onCreate}
            disabled={!apiKeyName || apiKeyScopes.length === 0 || isCreatePending}
          >
            <span className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create
            </span>
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="type-label-large text-on-surface">Scopes</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {API_KEY_SCOPES.map((scope) => (
            <label
              key={scope}
              className="border-outline-variant flex items-start gap-3 rounded-lg border px-3 py-3"
            >
              <input
                type="checkbox"
                checked={apiKeyScopes.includes(scope)}
                onChange={() => {
                  onToggleScope(scope);
                }}
                className="mt-1"
              />
              <span className="type-title-small text-on-surface block">{scope}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {apiKeys?.map((apiKey) => (
          <article
            key={apiKey.id}
            className="border-outline-variant flex items-center justify-between gap-3 rounded-2xl border bg-white/70 px-4 py-3"
          >
            <div>
              <p className="type-title-small text-on-surface">{apiKey.name || "Untitled key"}</p>
              <p className="type-body-small text-outline">
                {apiKey.prefix || "atlas"} · {apiKey.createdAt}
              </p>
              <p className="type-body-small text-outline">
                {(apiKey.scopes ?? []).join(", ") || "No scopes"}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                onDelete(apiKey.id);
              }}
              disabled={isDeletePending}
            >
              Revoke
            </Button>
          </article>
        ))}

        {isError ? (
          <p className="type-body-medium text-outline">
            Atlas could not load your API keys right now.
          </p>
        ) : null}

        {!apiKeys?.length ? (
          <p className="type-body-medium text-outline">
            No API keys yet. Create one for scripts or CLI access.
          </p>
        ) : null}
      </div>
    </div>
  );
}
