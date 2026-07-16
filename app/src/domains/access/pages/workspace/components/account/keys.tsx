import { Plus } from "lucide-react";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/domains/access/api-key-scopes";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { AccountRow, AccountSurface } from "./rows";

export interface AccountApiKeyRecord {
  createdAt: string;
  id: string;
  name?: string | null;
  prefix?: string | null;
  scopes?: ApiKeyScope[];
}

interface AccountApiKeysProps {
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

export function AccountApiKeys({
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
}: AccountApiKeysProps) {
  const apiKeyCount = apiKeys?.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Input
          value={apiKeyName}
          onChange={onNameChange}
          placeholder="Desktop script"
          label="Key name"
        />
        <Button
          ariaLabel="Create API key"
          onClick={onCreate}
          disabled={!apiKeyName || apiKeyScopes.length === 0 || isCreatePending}
        >
          <span className="inline-flex items-center gap-2">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Create
          </span>
        </Button>
      </div>

      <div className="space-y-2">
        <p className="type-label-large text-ink-strong">Scopes</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {API_KEY_SCOPES.map((scope) => (
            <label
              key={scope}
              className="border-border bg-surface-container-lowest flex items-start gap-3 rounded-lg border px-3 py-3"
            >
              <input
                type="checkbox"
                checked={apiKeyScopes.includes(scope)}
                onChange={() => {
                  onToggleScope(scope);
                }}
                className="mt-1"
              />
              <span className="type-title-small text-ink-strong block">{scope}</span>
            </label>
          ))}
        </div>
      </div>

      <AccountSurface>
        <AccountRow label="Keys" value={isError ? "Unavailable" : (apiKeyCount ?? 0)} />
        {apiKeys?.map((apiKey) => (
          <article key={apiKey.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <p className="type-title-small text-ink-strong">{apiKey.name || "Untitled key"}</p>
              <p className="type-body-small text-ink-soft">
                {apiKey.prefix || "atlas"} · {apiKey.createdAt}
              </p>
              <p className="type-body-small text-ink-soft">
                {(apiKey.scopes ?? []).join(", ") || "No scopes"}
              </p>
            </div>
            <Button
              ariaLabel="Revoke API key"
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
          <p className="type-body-medium text-ink-soft px-4 py-3">Could not load API keys.</p>
        ) : null}
      </AccountSurface>
    </div>
  );
}
