import { Check, KeyRound, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

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

/**
 * Card on the account page that lists registered passkeys and exposes
 * inline rename, delete, and add-new controls.  Empty and error states
 * sit at the bottom of the card so the operator always sees the add
 * button and any existing passkeys above them.
 */
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
  return (
    <div className="border-outline bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-on-surface">Passkeys</h2>
        <p className="type-body-medium text-outline">
          Register a passkey after your email-based sign-in so future access is faster.
        </p>
      </div>
      <Button variant="secondary" disabled={isAddingPasskey} onClick={onAddPasskey}>
        <span className="inline-flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          {isAddingPasskey ? "Adding passkey..." : "Add passkey"}
        </span>
      </Button>

      <div className="space-y-3">
        {passkeys?.map((pk) => (
          <article
            key={pk.id}
            className="border-outline-variant flex items-center justify-between gap-3 rounded-2xl border bg-white/70 px-4 py-3"
          >
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
                    type="submit"
                    variant="ghost"
                    disabled={!editingPasskeyName.trim() || isRenamePending}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" onClick={onCancelRename}>
                    <X className="h-4 w-4" />
                  </Button>
                </form>
              ) : (
                <p className="type-title-small text-on-surface">{pk.name || "Unnamed passkey"}</p>
              )}
              <p className="type-body-small text-outline">
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
                    onStartRename(pk.id, pk.name ?? "");
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    onDelete(pk.id);
                  }}
                  disabled={isDeletePending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </article>
        ))}

        {isError ? (
          <p className="type-body-medium text-outline">
            Atlas could not load your passkeys right now.
          </p>
        ) : null}

        {passkeys?.length === 0 ? (
          <p className="type-body-medium text-outline">
            No passkeys yet. Add one above for faster sign-in.
          </p>
        ) : null}
      </div>
    </div>
  );
}
