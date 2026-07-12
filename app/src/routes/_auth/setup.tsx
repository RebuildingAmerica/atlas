import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AccountSetupPage } from "@/domains/access";
import { requireIncompleteAtlasSession } from "@/domains/access/server";

const setupSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/_auth/setup")({
  validateSearch: setupSearchSchema,
  beforeLoad: async ({ location, search }) => {
    return {
      session: await requireIncompleteAtlasSession(location.href, search.redirect),
    };
  },
  component: AccountSetupRoute,
});

function AccountSetupRoute() {
  const search = Route.useSearch();
  return <AccountSetupPage redirectTo={search.redirect} />;
}
