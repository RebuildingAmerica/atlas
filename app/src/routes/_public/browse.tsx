import { createFileRoute } from "@tanstack/react-router";
import { BrowsePage, browseSearchSchema } from "@/domains/catalog";

export const Route = createFileRoute("/_public/browse")({
  ssr: false,
  validateSearch: browseSearchSchema,
  component: BrowseRoute,
});

function BrowseRoute() {
  const search = Route.useSearch();

  return <BrowsePage search={search} />;
}
