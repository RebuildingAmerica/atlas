import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "@/domains/access";

export const Route = createFileRoute("/_workspace/account")({
  component: AccountPage,
});
