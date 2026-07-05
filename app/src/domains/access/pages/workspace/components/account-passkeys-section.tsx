import { Check, KeyRound, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { AccountSettingsRow, AccountSettingsSurface } from "./account-settings-section";

export interface AccountPasskeyRecord {
  id: string;
  name?: string | null;
  deviceType: string;
  createdAt: string;
  backedUp: boolean;
}

interface AccountPasskeysSectionProps {
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

export function AccountPasskeysSection({
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
}: AccountPasskeysSectionProps) {
  const passkeyCount = passkeys?.length;

  return (
    <div className="space-y-3">
      <AccountSettingsSurface>
        <AccountSettingsRow
          label="Passkeys"
          value={isError ? "Unavailable" : (passkeyCount ?? 0)}
          action={
            <Button
              ariaLabel="Add passkey"
              variant="secondary"
              size="sm"
              disabled={isAddingPasskey}
              onClick={onAddPasskey}
            >
              <span className="inline-flex items-center gap-2">
                <KeyRound aria-hidden="true" className="h-4 w-4" />
                {isAddingPasskey ? "Adding..." : "Add"}
              </span>
            </Button>
          }
        />
        {passkeys?.map((pk) => (
          <article key={pk.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1 space-y-1">
              {editingPasskeyId === pk.id ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSubmitRename(pk.id, editingPasskeyName);
                  }}
                >
                  <Input value={editingPasskeyName} onChange={onRenameChange} label="" />
                  <Button
                    ariaLabel="Save passkey name"
                    type="submit"
                    variant="ghost"
                    disabled={!editingPasskeyName.trim() || isRenamePending}
                  >
                    <Check aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <Button
                    ariaLabel="Cancel passkey rename"
                    type="button"
                    variant="ghost"
                    onClick={onCancelRename}
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </form>
              ) : (
                <p className="type-title-small text-ink-strong">{pk.name || "Unnamed passkey"}</p>
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
                  ariaLabel="Rename passkey"
                  variant="ghost"
                  onClick={() => {
                    onStartRename(pk.id, pk.name ?? "");
                  }}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </Button>
                <Button
                  ariaLabel="Delete passkey"
                  variant="ghost"
                  onClick={() => {
                    onDelete(pk.id);
                  }}
                  disabled={isDeletePending}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </article>
        ))}

        {isError ? (
          <p className="type-body-medium text-ink-soft px-4 py-3">Could not load passkeys.</p>
        ) : null}
      </AccountSettingsSurface>
    </div>
  );
}
