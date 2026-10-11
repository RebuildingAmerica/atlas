import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "@/domains/accounts/accounts-page";

export const Route = createFileRoute("/accounts")({
  head: () => ({ meta: [{ title: "Accounts | Atlas platform admin" }] }),
  component: AccountsPage,
});
