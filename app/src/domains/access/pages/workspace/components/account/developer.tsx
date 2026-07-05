import type { ApiKeyScope } from "@/domains/access/api-key-scopes";
import { AccountApiKeys, type AccountApiKeyRecord } from "./keys";
import { AccountNotice } from "./notice";
import { AccountSection, AccountSubsection } from "./rows";

interface AccountDeveloperSectionProps {
  apiKeyName: string;
  apiKeyScopes: ApiKeyScope[];
  apiKeySecret: string | null;
  apiKeys: AccountApiKeyRecord[] | undefined;
  isCreatePending: boolean;
  isDeletePending: boolean;
  isError: boolean;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onNameChange: (value: string) => void;
  onToggleScope: (scope: ApiKeyScope) => void;
}

export function AccountDeveloperSection({
  apiKeyName,
  apiKeyScopes,
  apiKeySecret,
  apiKeys,
  isCreatePending,
  isDeletePending,
  isError,
  onCreate,
  onDelete,
  onNameChange,
  onToggleScope,
}: AccountDeveloperSectionProps) {
  return (
    <AccountSection id="developer" title="Developer">
      {apiKeySecret ? (
        <AccountNotice title="New API key" tone="secret">
          {apiKeySecret}
        </AccountNotice>
      ) : null}

      <AccountSubsection title="API keys">
        <AccountApiKeys
          apiKeyName={apiKeyName}
          apiKeyScopes={apiKeyScopes}
          apiKeys={apiKeys}
          isCreatePending={isCreatePending}
          isDeletePending={isDeletePending}
          isError={isError}
          onCreate={onCreate}
          onDelete={onDelete}
          onNameChange={onNameChange}
          onToggleScope={onToggleScope}
        />
      </AccountSubsection>
    </AccountSection>
  );
}
