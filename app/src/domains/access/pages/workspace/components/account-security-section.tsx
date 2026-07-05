import { AccountPasskeysSection, type AccountPasskeyRecord } from "./account-passkeys-section";
import { AccountSettingsSection } from "./account-settings-section";

interface AccountSecuritySectionProps {
  editingPasskeyId: string | null;
  editingPasskeyName: string;
  isAddingPasskey: boolean;
  isDeletePending: boolean;
  isError: boolean;
  isRenamePending: boolean;
  passkeys: AccountPasskeyRecord[] | undefined;
  onAddPasskey: () => void;
  onCancelRename: () => void;
  onDelete: (id: string) => void;
  onRenameChange: (name: string) => void;
  onStartRename: (id: string, name: string) => void;
  onSubmitRename: (id: string, name: string) => void;
}

export function AccountSecuritySection({
  editingPasskeyId,
  editingPasskeyName,
  isAddingPasskey,
  isDeletePending,
  isError,
  isRenamePending,
  passkeys,
  onAddPasskey,
  onCancelRename,
  onDelete,
  onRenameChange,
  onStartRename,
  onSubmitRename,
}: AccountSecuritySectionProps) {
  return (
    <AccountSettingsSection id="security" title="Security">
      <AccountPasskeysSection
        editingPasskeyId={editingPasskeyId}
        editingPasskeyName={editingPasskeyName}
        isAddingPasskey={isAddingPasskey}
        isDeletePending={isDeletePending}
        isError={isError}
        isRenamePending={isRenamePending}
        passkeys={passkeys}
        onAddPasskey={onAddPasskey}
        onCancelRename={onCancelRename}
        onDelete={onDelete}
        onRenameChange={onRenameChange}
        onStartRename={onStartRename}
        onSubmitRename={onSubmitRename}
      />
    </AccountSettingsSection>
  );
}
