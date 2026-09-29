import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAtlasSession } from "@/domains/access";
import {
  useCreateSavedList,
  useDeleteSavedList,
  useSavedLists,
} from "@/domains/catalog/hooks/use-claims";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";

export const Route = createFileRoute("/_workspace/lists/")({
  head: () => ({ meta: [{ title: "Research lists | Atlas" }] }),
  component: ListsRoute,
});

function ListsRoute() {
  const session = useAtlasSession();
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
      setErrorMessage(userFacingErrorMessage(err, "Could not create list."));
    }
  }

  const activeOrganization = session.data?.workspace?.activeOrganization;
  const isTeamWorkspace = activeOrganization?.workspaceType === "team";
  const heading = "Your research lists";

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge variant="info">Research workspace</Badge>
          <h1 className="type-display-small text-ink-strong mt-2">{heading}</h1>
          <p className="type-body-large text-ink-soft max-w-2xl">
            Group leads and notes around a goal. Your lists stay private until you choose to share
            one with a Team workspace.
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
          {isTeamWorkspace ? (
            <p className="type-body-small text-ink-soft">
              This list starts private. You can share it with {activeOrganization.name} after
              creating it.
            </p>
          ) : null}
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
      ) : !lists.data || lists.data.length === 0 ? (
        <div className="bg-surface-container space-y-2 rounded-[1rem] p-5">
          <p className="type-body-medium text-ink-strong">You haven&apos;t built any lists yet.</p>
          <p className="type-body-small text-ink-soft">
            Click <span className="font-semibold">Save</span> on any profile to start one.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {lists.data.map((list) => (
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
                <p className="type-label-small text-ink-soft">Leads, notes, briefs, and exports</p>
                <div className="type-label-small text-ink-muted flex flex-wrap gap-x-3 gap-y-1">
                  <span>
                    {list.org_id
                      ? `Shared with ${activeOrganization?.name ?? "your team"}`
                      : "Private to you"}
                  </span>
                  {list.org_id ? (
                    <span>
                      {list.user_id === session.data?.user?.id
                        ? "Created by you"
                        : "Created by a teammate"}
                    </span>
                  ) : null}
                </div>
                <p className="type-label-small text-ink-muted">
                  {list.item_count} {list.item_count === 1 ? "actor" : "actors"}
                </p>
              </Link>
              {list.user_id === session.data?.user?.id ? (
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
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
