import { createFileRoute } from "@tanstack/react-router";
import { MergesPage } from "@/domains/editorial/merges-page";

export const Route = createFileRoute("/_workspace/editorial/merges")({
  head: () => ({ meta: [{ title: "Merge profiles | Atlas editorial" }] }),
  component: MergesPage,
});
