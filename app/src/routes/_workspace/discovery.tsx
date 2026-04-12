import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryPage } from "@/domains/discovery";
import { requireReadyAtlasSession } from "@/domains/access/server";

export const Route = createFileRoute("/_workspace/discovery")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    return {
      session: await requireReadyAtlasSession(location.href),
    };
  },
  component: DiscoveryPage,
});
