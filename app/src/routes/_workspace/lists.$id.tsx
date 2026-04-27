import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useRemoveSavedListItem, useSavedList } from "@/domains/catalog/hooks/use-claims";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { Badge } from "@/platform/ui/badge";

export const Route = createFileRoute("/_workspace/lists/$id")({
  component: ListDetailRoute,
});

function ListDetailRoute() {
  const { id } = Route.useParams();
  const list = useSavedList(id, true);
  const removeItem = useRemoveSavedListItem();

  if (list.isLoading) {
    return (
      <div className="mx-auto max-w-4xl py-12">
        <p className="type-body-medium text-ink-soft">Loading list…</p>
      </div>
    );
  }

  if (!list.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 py-12">
        <h1 className="type-display-small text-ink-strong">List not found</h1>
        <p className="type-body-medium text-ink-soft">
          This list may have been deleted. Head back to{" "}
          <Link to="/lists" className="underline">
            your lists
          </Link>
          .
        </p>
      </div>
    );
  }

  const data = list.data;
  const items = data.items ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-12">
      <Link
        to="/lists"
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        All lists
      </Link>

      <div className="space-y-3">
        <Badge variant="info">{data.item_count} actors</Badge>
        <h1 className="type-display-small text-ink-strong">{data.name}</h1>
        {data.description ? (
          <p className="type-body-large text-ink-soft max-w-2xl">{data.description}</p>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="bg-surface-container space-y-2 rounded-[1rem] p-5">
          <p className="type-body-medium text-ink-strong">No actors yet.</p>
          <p className="type-body-small text-ink-soft">
            Use the <span className="font-semibold">Save</span> button on any profile to add it
            here.
          </p>
        </div>
      ) : (
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
                    name={actor.name}
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
                      {actor.source_count ?? 0}{" "}
                      {(actor.source_count ?? 0) === 1 ? "source" : "sources"}
                    </p>
                  ) : null}
                  {item.note ? (
                    <p className="type-body-small text-ink-soft italic">“{item.note}”</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void removeItem.mutateAsync({ listId: data.id, entryId: item.entry_id });
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
      )}
    </div>
  );
}
