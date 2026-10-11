import { createFileRoute } from "@tanstack/react-router";
import { TakedownsPage } from "@/domains/editorial/takedowns-page";

export const Route = createFileRoute("/_workspace/editorial/takedowns")({
  head: () => ({ meta: [{ title: "Takedowns | Atlas editorial" }] }),
  component: TakedownsPage,
});
