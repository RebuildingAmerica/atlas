import { createFileRoute } from "@tanstack/react-router";
import { SwitchesPage } from "@/domains/switches/switches-page";

export const Route = createFileRoute("/switches")({
  head: () => ({ meta: [{ title: "Switches | Atlas platform admin" }] }),
  component: SwitchesPage,
});
