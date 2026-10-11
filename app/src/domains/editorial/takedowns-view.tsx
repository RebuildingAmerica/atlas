import { useState } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { Textarea } from "@rebuildingamerica/atlas-ui/ui/textarea";
import {
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import type { ProfileTakedown } from "./takedowns.functions";

/** A takedown the editor is about to make. */
export interface NewTakedown {
  address: string;
  reason: string;
}

export interface TakedownsViewProps {
  actionError?: string;
  createError?: string;
  errorMessage?: string;
  /** Changes after each takedown, which clears the form. */
  formResetKey: number;
  isCreating: boolean;
  isLoading: boolean;
  onCreate: (takedown: NewTakedown) => void;
  onRestore: (takedown: ProfileTakedown) => void;
  pendingTakedownId?: string;
  takedowns: ProfileTakedown[];
}

interface TakedownRowProps {
  onRestore: (takedown: ProfileTakedown) => void;
  pending: boolean;
  takedown: ProfileTakedown;
}

interface NewTakedownFormProps {
  createError?: string;
  isCreating: boolean;
  onCreate: (takedown: NewTakedown) => void;
}

/**
 * Profiles taken down, usually at the person's own request. A profile stays
 * hidden until an editor restores it, whatever later research finds.
 */
export function TakedownsView({
  actionError,
  createError,
  errorMessage,
  formResetKey,
  isCreating,
  isLoading,
  onCreate,
  onRestore,
  pendingTakedownId,
  takedowns,
}: TakedownsViewProps) {
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Removals"
        title="Takedowns"
        description="Take a profile down when the person asks or it should not be public. It stays hidden until you restore it, even if later research finds them again."
      />
      <NewTakedownForm
        key={formResetKey}
        createError={createError}
        isCreating={isCreating}
        onCreate={onCreate}
      />
      <section aria-label="Profiles taken down" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-title-large text-ink-strong">Taken down</h2>
          <span className="type-body-small text-ink-soft">{takedowns.length} hidden</span>
        </div>
        <AdminInlineStatus message={errorMessage} />
        <AdminInlineStatus message={actionError} />
        {isLoading ? (
          <div
            aria-busy
            className="border-border bg-surface-container-lowest h-24 rounded-lg border"
          />
        ) : takedowns.length === 0 && !errorMessage ? (
          <div className="border-border bg-surface-container-lowest rounded-lg border p-6">
            <p className="type-body-medium text-ink-soft">No profiles are taken down.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {takedowns.map((takedown) => (
              <TakedownRow
                key={takedown.id}
                onRestore={onRestore}
                pending={pendingTakedownId === takedown.id}
                takedown={takedown}
              />
            ))}
          </ul>
        )}
      </section>
    </AdminPageShell>
  );
}

function TakedownRow({ onRestore, pending, takedown }: TakedownRowProps) {
  return (
    <li className="border-border bg-surface-container-lowest space-y-3 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="type-title-medium text-ink-strong">{takedown.entryName}</h3>
          <p className="type-body-small text-ink-soft">
            {takedown.entryType === "person" ? "Person" : "Organization"} · taken down{" "}
            {formatDate(takedown.takenDownAt)} by {takedown.takenDownBy}
          </p>
        </div>
        <AdminStatusBadge tone="block">Hidden</AdminStatusBadge>
      </div>
      <p className="type-body-medium text-ink-strong whitespace-pre-wrap">{takedown.reason}</p>
      <Button
        ariaLabel={`Restore ${takedown.entryName}`}
        disabled={pending}
        onClick={() => {
          onRestore(takedown);
        }}
        size="sm"
        variant="secondary"
      >
        {takedown.wasPublished ? "Restore and republish" : "Restore to review"}
      </Button>
    </li>
  );
}

function NewTakedownForm({ createError, isCreating, onCreate }: NewTakedownFormProps) {
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const ready = address.trim().length > 0 && reason.trim().length >= 3;

  return (
    <section aria-label="Take a profile down" className="space-y-4">
      <h2 className="type-title-large text-ink-strong">Take a profile down</h2>
      <AdminInlineStatus message={createError} />
      <form
        className="border-border bg-surface-container-lowest space-y-4 rounded-lg border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onCreate({ address: address.trim(), reason: reason.trim() });
        }}
      >
        <Input
          label="Profile address"
          onChange={setAddress}
          placeholder="https://atlas.rebuildingus.org/profiles/people/…"
          required
          value={address}
        />
        <Textarea
          label="Reason"
          onChange={setReason}
          placeholder="Who asked, when and how, so whoever reads this later understands it."
          required
          rows={3}
          value={reason}
        />
        <Button disabled={!ready || isCreating} type="submit">
          {isCreating ? "Taking down…" : "Take down"}
        </Button>
      </form>
    </section>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
