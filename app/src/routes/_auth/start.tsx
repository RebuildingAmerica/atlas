import { createFileRoute } from "@tanstack/react-router";
import {
  StartPurchasePage,
  startPurchaseSearchSchema,
} from "@/domains/billing/pages/auth/start-purchase-page";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_auth/start")({
  validateSearch: startPurchaseSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: StartPurchaseRoute,
});

function StartPurchaseRoute() {
  const search = Route.useSearch();
  return (
    <StartPurchasePage
      interval={search.interval}
      product={search.product}
      purchase={search.purchase}
      step={search.step}
    />
  );
}
