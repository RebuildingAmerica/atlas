import { createFileRoute } from "@tanstack/react-router";
import { SetupPage, setupSearchSchema } from "@/domains/onboarding/pages/setup-page";

export const Route = createFileRoute("/_onboarding/onboarding/")({
  validateSearch: setupSearchSchema,
  component: SetupIndexRoute,
});

function SetupIndexRoute() {
  const search = Route.useSearch();
  return (
    <SetupPage
      interval={search.interval}
      product={search.product}
      purchase={search.purchase}
      step={search.step}
    />
  );
}
