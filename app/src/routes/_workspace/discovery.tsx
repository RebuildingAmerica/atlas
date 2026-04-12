import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryPage } from "@/domains/discovery";

export const Route = createFileRoute("/_workspace/discovery")({
  ssr: false,
  component: DiscoveryPage,
});
