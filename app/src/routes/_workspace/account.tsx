import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "@/domains/access";
import { requireReadyAtlasSession } from "@/domains/access/server";

export const Route = createFileRoute("/_workspace/account")({
  beforeLoad: async ({ location }) => {
    return {
      session: await requireReadyAtlasSession(location.href),
    };
  },
  component: AccountPage,
});
