import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  useCreateSavedList,
  useDeleteSavedList,
  useSavedLists,
} from "@/domains/catalog/hooks/use-claims";
import { Badge } from "@/platform/ui/badge";
import { Button } from "@/platform/ui/button";

export const Route = createFileRoute("/_workspace/lists")({
  component: ListsRoute,
});

function ListsRoute() {
  const lists = useSavedLists();
  const createList = useCreateSavedList();
  const deleteList = useDeleteSavedList();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCreate() {
    setErrorMessage(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createList.mutateAsync({
        name: trimmed,
        description: description.trim() || null,
      });
      setName("");
      setDescription("");
      setShowCreate(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not create list.");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge variant="info">My collections</Badge>
          <h1 className="type-display-small text-ink-strong mt-2">Saved lists</h1>
          <p className="type-body-large text-ink-soft max-w-2xl">
            Pin profiles into named collections so you can come back to them — for an outreach push,
            a research thread, or a coalition you&apos;re building.
          </p>
        </div>
        <Button
          onClick={() => {
            setShowCreate((current) => !current);
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden />
            New list
          </span>
        </Button>
      </header>

      {showCreate ? (
        <section className="bg-surface-container space-y-3 rounded-[1rem] p-5">
          <input
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="List name"
            className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            rows={2}
            placeholder="Optional description"
            className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                void handleCreate();
              }}
              disabled={createList.isPending}
              size="sm"
            >
              Create list
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setName("");
                setDescription("");
              }}
              className="type-label-medium text-ink-muted hover:text-ink-strong"
            >
              Cancel
            </button>
          </div>
          {errorMessage ? (
            <p className="type-label-medium text-rose-700" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </section>
      ) : null}

      {lists.isLoading ? (
        <p className="type-body-medium text-ink-soft">Loading lists…</p>
      ) : (lists.data?.length ?? 0) === 0 ? (
        <div className="bg-surface-container space-y-2 rounded-[1rem] p-5">
          <p className="type-body-medium text-ink-strong">You haven&apos;t built any lists yet.</p>
          <p className="type-body-small text-ink-soft">
            Click <span className="font-semibold">Save</span> on any profile to start one.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {(lists.data ?? []).map((list) => (
            <li
              key={list.id}
              className="border-outline-variant bg-surface-container-lowest flex items-start justify-between gap-3 rounded-[1rem] border p-4"
            >
              <Link to="/lists/$id" params={{ id: list.id }} className="min-w-0 flex-1 space-y-1">
                <div className="type-title-medium text-ink-strong inline-flex items-center gap-2">
                  {list.name}
                  <ArrowUpRight className="text-ink-muted h-4 w-4" />
                </div>
                {list.description ? (
                  <p className="type-body-small text-ink-soft line-clamp-2">{list.description}</p>
                ) : null}
                <p className="type-label-small text-ink-muted">
                  {list.item_count} {list.item_count === 1 ? "actor" : "actors"}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => {
                  void deleteList.mutateAsync(list.id);
                }}
                className="text-ink-muted hover:text-rose-700"
                aria-label={`Delete ${list.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
