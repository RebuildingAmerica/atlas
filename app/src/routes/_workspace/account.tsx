import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "@/domains/access";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_workspace/account")({
  beforeLoad: () => {
    redirectIfLocalSession("/discovery");
  },
  component: AccountPage,
});
