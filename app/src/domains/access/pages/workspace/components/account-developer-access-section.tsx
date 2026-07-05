import type { ApiKeyScope } from "@/domains/access/api-key-scopes";
import { AccountApiKeysSection, type AccountApiKeyRecord } from "./account-api-keys-section";
import {
  AccountScoutDevicesSection,
  type AccountScoutDeviceRecord,
} from "./account-scout-devices-section";
import { AccountSettingsNotice, AccountSettingsSection } from "./account-settings-section";

interface AccountDeveloperAccessSectionProps {
  apiKeyName: string;
  apiKeyScopes: ApiKeyScope[];
  apiKeySecret: string | null;
  apiKeys: AccountApiKeyRecord[] | undefined;
  canCreateApiKeys: boolean;
  devices: AccountScoutDeviceRecord[] | undefined;
  isCreatePending: boolean;
  isDeletePending: boolean;
  isError: boolean;
  isLocal: boolean;
  isRevokePending: boolean;
  isScoutDevicesError: boolean;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onNameChange: (value: string) => void;
  onRevoke: (id: string) => void;
  onToggleScope: (scope: ApiKeyScope) => void;
}

export function AccountDeveloperAccessSection({
  apiKeyName,
  apiKeyScopes,
  apiKeySecret,
  apiKeys,
  canCreateApiKeys,
  devices,
  isCreatePending,
  isDeletePending,
  isError,
  isLocal,
  isRevokePending,
  isScoutDevicesError,
  onCreate,
  onDelete,
  onNameChange,
  onRevoke,
  onToggleScope,
}: AccountDeveloperAccessSectionProps) {
  return (
    <AccountSettingsSection id="developer-access" title="Developer access">
      <div className="space-y-6">
        {apiKeySecret ? (
          <AccountSettingsNotice title="New API key" tone="secret">
            {apiKeySecret}
          </AccountSettingsNotice>
        ) : null}

        {canCreateApiKeys ? (
          <AccountApiKeysSection
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
        ) : null}

        {!isLocal ? (
          <AccountScoutDevicesSection
            devices={devices}
            isError={isScoutDevicesError}
            isRevokePending={isRevokePending}
            onRevoke={onRevoke}
          />
        ) : null}
      </div>
    </AccountSettingsSection>
  );
}
