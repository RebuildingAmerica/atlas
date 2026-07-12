import { createFileRoute } from "@tanstack/react-router";
import {
  StartPurchaseCompletePage,
  startPurchaseCompleteSearchSchema,
} from "@/domains/billing/pages/auth/start-purchase-complete-page";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_auth/start/complete")({
  validateSearch: startPurchaseCompleteSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: StartPurchaseCompleteRoute,
});

function StartPurchaseCompleteRoute() {
  const search = Route.useSearch();
  return <StartPurchaseCompletePage purchase={search.purchase} />;
}
