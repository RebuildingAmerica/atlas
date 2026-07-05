import { AccountPasskeys, type AccountPasskeyRecord } from "./passkeys";
import { AccountSection, AccountSubsection } from "./rows";

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
    <AccountSection id="security" title="Security">
      <AccountSubsection title="Sign-in methods">
        <AccountPasskeys
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
      </AccountSubsection>
    </AccountSection>
  );
}
