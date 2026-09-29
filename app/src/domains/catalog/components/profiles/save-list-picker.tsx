/**
 * SaveListPicker — dropdown shown for signed-in users when they click Save.
 *
 * Displays the user's saved lists, allows toggling membership for the current
 * entry, and supports creating a new list inline.
 */
import { Check, FolderPlus, List as ListIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  useAddSavedListItem,
  useCreateSavedList,
  useRemoveSavedListItem,
  useSavedListMembership,
  useSavedLists,
} from "@/domains/catalog/hooks/use-claims";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";

interface SaveListPickerProps {
  entryId: string;
  id?: string;
  open: boolean;
  onClose: () => void;
}

export function SaveListPicker({ entryId, id, open, onClose }: SaveListPickerProps) {
  const lists = useSavedLists();
  const membership = useSavedListMembership(entryId, open);
  const createList = useCreateSavedList();
  const addItem = useAddSavedListItem();
  const removeItem = useRemoveSavedListItem();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [createdListId, setCreatedListId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const nameInputId = useId();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  const memberSet = useMemo(() => new Set(membership.data ?? []), [membership.data]);

  if (!open) return null;

  async function toggleMembership(listId: string) {
    setActionError(null);
    try {
      if (memberSet.has(listId)) {
        await removeItem.mutateAsync({ listId, entryId });
      } else {
        await addItem.mutateAsync({ listId, body: { entry_id: entryId } });
      }
    } catch {
      setActionError("Could not update this list. Try again.");
    }
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    setActionError(null);
    let listId = createdListId;
    if (!listId) {
      try {
        const created = await createList.mutateAsync({ name: trimmed });
        listId = created.id;
        setCreatedListId(listId);
      } catch {
        setActionError("Could not create this list. Try again.");
        return;
      }
    }
    try {
      await addItem.mutateAsync({ listId, body: { entry_id: entryId } });
      setNewName("");
      setCreatedListId(null);
      setShowCreate(false);
    } catch {
      setActionError("List created, but this profile was not saved. Try again.");
    }
  }

  return (
    <div
      id={id}
      ref={ref}
      role="dialog"
      aria-label="Save to list"
      className="border-outline-variant bg-surface-container-lowest absolute top-full right-0 z-30 mt-2 w-72 space-y-3 rounded-[1rem] border p-4 shadow-lg"
    >
      <p className="type-label-medium text-ink-muted">Add to a list</p>
      {lists.isLoading ? (
        <p className="type-body-small text-ink-soft">Loading…</p>
      ) : lists.isError ? (
        <div className="space-y-2">
          <p className="type-body-small text-ink-soft">Could not load your lists.</p>
          <button
            type="button"
            onClick={() => void lists.refetch()}
            className="type-label-medium text-ink-strong underline"
          >
            Try again
          </button>
        </div>
      ) : (lists.data?.length ?? 0) === 0 && !showCreate ? (
        <p className="type-body-small text-ink-soft">You don&apos;t have any lists yet.</p>
      ) : (
        <ul className="space-y-1">
          {(lists.data ?? []).map((list) => {
            const checked = memberSet.has(list.id);
            return (
              <li key={list.id}>
                <button
                  type="button"
                  onClick={() => {
                    void toggleMembership(list.id);
                  }}
                  aria-pressed={checked}
                  disabled={
                    membership.isLoading ||
                    membership.isError ||
                    addItem.isPending ||
                    removeItem.isPending
                  }
                  className="hover:bg-surface-container flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ListIcon className="text-ink-muted h-4 w-4 shrink-0" aria-hidden />
                    <span className="type-body-medium text-ink-strong truncate">{list.name}</span>
                  </span>
                  {checked ? (
                    <Check className="text-accent-deep h-4 w-4" aria-hidden />
                  ) : (
                    <span className="type-label-small text-ink-muted">
                      {list.item_count} {list.item_count === 1 ? "actor" : "actors"}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {membership.isError && !lists.isError ? (
        <p className="type-body-small text-ink-soft">
          Could not check which lists contain this profile.
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="type-body-small text-ink-soft">
          {actionError}
        </p>
      ) : null}

      {showCreate ? (
        <div className="space-y-2">
          <label htmlFor={nameInputId} className="type-label-small text-ink-muted">
            List name
          </label>
          <input
            id={nameInputId}
            type="text"
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
              setActionError(null);
            }}
            disabled={createdListId !== null}
            placeholder="New list name"
            className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                void handleCreate();
              }}
              size="sm"
              disabled={createList.isPending || addItem.isPending || !newName.trim()}
            >
              {createdListId ? "Try saving again" : "Create"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setNewName("");
                setCreatedListId(null);
                setActionError(null);
              }}
              className="type-label-medium text-ink-muted hover:text-ink-strong"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setShowCreate(true);
          }}
          className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
        >
          <FolderPlus className="h-4 w-4" aria-hidden />
          Create a new list
        </button>
      )}
    </div>
  );
}
