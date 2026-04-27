/**
 * SaveListPicker — dropdown shown for signed-in users when they click Save.
 *
 * Displays the user's saved lists, allows toggling membership for the current
 * entry, and supports creating a new list inline.
 */
import { Check, FolderPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAddSavedListItem,
  useCreateSavedList,
  useRemoveSavedListItem,
  useSavedListMembership,
  useSavedLists,
} from "@/domains/catalog/hooks/use-claims";
import { Button } from "@/platform/ui/button";

interface SaveListPickerProps {
  entryId: string;
  open: boolean;
  onClose: () => void;
}

export function SaveListPicker({ entryId, open, onClose }: SaveListPickerProps) {
  const lists = useSavedLists();
  const membership = useSavedListMembership(entryId, open);
  const createList = useCreateSavedList();
  const addItem = useAddSavedListItem();
  const removeItem = useRemoveSavedListItem();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
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
    if (memberSet.has(listId)) {
      await removeItem.mutateAsync({ listId, entryId });
    } else {
      await addItem.mutateAsync({ listId, body: { entry_id: entryId } });
    }
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created = await createList.mutateAsync({ name: trimmed });
    await addItem.mutateAsync({ listId: created.id, body: { entry_id: entryId } });
    setNewName("");
    setShowCreate(false);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Save to list"
      className="border-outline-variant bg-surface-container-lowest absolute top-full right-0 z-30 mt-2 w-72 space-y-3 rounded-[1rem] border p-4 shadow-lg"
    >
      <p className="type-label-medium text-ink-muted">Add to a list</p>
      {lists.isLoading ? (
        <p className="type-body-small text-ink-soft">Loading…</p>
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
                  className="hover:bg-surface-container flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
                >
                  <span className="type-body-medium text-ink-strong">{list.name}</span>
                  {checked ? (
                    <Check className="text-accent h-4 w-4" aria-hidden />
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

      {showCreate ? (
        <div className="space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
            }}
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
              disabled={createList.isPending}
            >
              Create
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setNewName("");
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
