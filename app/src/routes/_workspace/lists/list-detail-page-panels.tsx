import { Link } from "@tanstack/react-router";
import { Check, PencilLine, Trash2, X } from "lucide-react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import type { SavedListThreadItem } from "./list-detail-page-utils";

interface SavedListItemNoteEditorProps {
  actorName: string;
  entryId: string;
  isEditing: boolean;
  isPending: boolean;
  note: string | null;
  noteDraft: string;
  showError: boolean;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
}

function SavedListItemNoteEditor({
  actorName,
  entryId,
  isEditing,
  isPending,
  note,
  noteDraft,
  showError,
  onCancel,
  onDraftChange,
  onEdit,
  onSave,
}: SavedListItemNoteEditorProps) {
  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="type-label-small text-accent hover:text-accent-dark inline-flex items-center gap-1.5 transition-colors"
        aria-label={`${note ? "Edit" : "Add"} note for ${actorName}`}
      >
        <PencilLine className="h-3.5 w-3.5" aria-hidden />
        {note ? "Edit note" : "Add note"}
      </button>
    );
  }

  return (
    <div className="border-outline-variant bg-surface-container mt-3 space-y-2 rounded-lg border p-3">
      <label htmlFor={`saved-list-note-${entryId}`} className="sr-only">
        Note for {actorName}
      </label>
      <textarea
        id={`saved-list-note-${entryId}`}
        value={noteDraft}
        onChange={(event) => {
          onDraftChange(event.target.value);
        }}
        rows={3}
        className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface type-body-small w-full resize-y rounded-md border px-3 py-2 focus:ring-2 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="type-label-small bg-ink-strong text-surface hover:bg-ink inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors disabled:opacity-60"
          aria-label={`Save note for ${actorName}`}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          Save note
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="type-label-small text-ink-muted hover:text-ink-strong inline-flex items-center gap-1.5 transition-colors"
          aria-label={`Cancel note edit for ${actorName}`}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Cancel
        </button>
        {showError ? (
          <span className="type-label-small text-rose-700" role="alert">
            Could not save note.
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface SavedListItemsSectionProps {
  dataId: string;
  editingEntryId: string | null;
  items: SavedListThreadItem[];
  noteDraft: string;
  noteErrorEntryId: string | null;
  saveItemPending: boolean;
  onBeginNoteEdit: (entryId: string, note: string | null | undefined) => void;
  onCancelNoteEdit: () => void;
  onDraftChange: (value: string) => void;
  onSaveNote: (listId: string, entryId: string) => void;
  onRemoveItem: (entryId: string) => void;
}

export function SavedListItemsSection({
  dataId,
  editingEntryId,
  items,
  noteDraft,
  noteErrorEntryId,
  saveItemPending,
  onBeginNoteEdit,
  onCancelNoteEdit,
  onDraftChange,
  onSaveNote,
  onRemoveItem,
}: SavedListItemsSectionProps) {
  if (items.length === 0) {
    return (
      <div className="bg-surface-container space-y-2 rounded-[1rem] p-5">
        <p className="type-body-medium text-ink-strong">No people or groups yet.</p>
        <p className="type-body-small text-ink-soft">
          Use the <span className="font-semibold">Save</span> button on any profile to add it here.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const actor = item.entry;
        const slug = actor?.slug ?? "";
        const segment = actor?.type === "organization" ? "organizations" : "people";
        const avatarType: "person" | "organization" =
          actor?.type === "organization" ? "organization" : "person";
        const city = actor?.address?.city ?? null;
        const state = actor?.address?.state ?? null;
        const locationLabel = city && state ? `${city}, ${state}` : (state ?? "—");

        return (
          <li
            key={item.entry_id}
            className="border-outline-variant bg-surface-container-lowest flex items-start gap-4 rounded-[1rem] border p-4"
          >
            {actor ? (
              <ActorAvatar
                name={actor.name ?? "Profile unavailable"}
                type={avatarType}
                size="md"
                photoUrl={actor.photo_url ?? undefined}
              />
            ) : null}
            <div className="min-w-0 flex-1 space-y-1">
              {actor && slug ? (
                <Link
                  to={`/profiles/${segment}/$slug` as "/profiles/people/$slug"}
                  params={{ slug }}
                  className="type-title-medium text-ink-strong block truncate hover:underline"
                >
                  {actor.name}
                </Link>
              ) : (
                <p className="type-title-medium text-ink-strong">
                  {actor?.name ?? "Profile unavailable"}
                </p>
              )}
              {actor ? (
                <p className="type-body-small text-ink-soft">
                  {locationLabel}
                  {" · "}
                  {actor.source_count ?? 0} {(actor.source_count ?? 0) === 1 ? "source" : "sources"}
                </p>
              ) : null}
              {item.note ? (
                <p className="type-body-small text-ink-soft italic">“{item.note}”</p>
              ) : null}
              <SavedListItemNoteEditor
                actorName={actor?.name ?? "actor"}
                entryId={item.entry_id}
                isEditing={editingEntryId === item.entry_id}
                isPending={saveItemPending}
                note={item.note ?? null}
                noteDraft={noteDraft}
                showError={noteErrorEntryId === item.entry_id}
                onCancel={onCancelNoteEdit}
                onDraftChange={onDraftChange}
                onEdit={() => {
                  onBeginNoteEdit(item.entry_id, item.note);
                }}
                onSave={() => {
                  onSaveNote(dataId, item.entry_id);
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onRemoveItem(item.entry_id);
              }}
              className="text-ink-muted hover:text-rose-700"
              aria-label={`Remove ${actor?.name ?? "actor"} from list`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
