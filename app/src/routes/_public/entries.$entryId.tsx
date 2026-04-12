import { createFileRoute } from "@tanstack/react-router";
import { EntryPage } from "@/domains/catalog";

export const Route = createFileRoute("/_public/entries/$entryId")({
  ssr: false,
  component: EntryRoute,
});

function EntryRoute() {
  const { entryId } = Route.useParams();
  return <EntryPage entryId={entryId} />;
}
