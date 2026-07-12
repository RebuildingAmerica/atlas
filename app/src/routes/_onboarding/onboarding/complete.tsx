import { createFileRoute } from "@tanstack/react-router";
import {
  purchaseOnboardingIntentQueryOptions,
  SetupCompletePage,
  setupCompleteSearchSchema,
} from "@/domains/onboarding/pages/setup-complete-page";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_onboarding/onboarding/complete")({
  validateSearch: setupCompleteSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  loaderDeps: ({ search }) => ({ purchase: search.purchase }),
  loader: ({ context, deps }) => {
    if (!deps.purchase) {
      return null;
    }
    return context.queryClient.ensureQueryData(purchaseOnboardingIntentQueryOptions(deps.purchase));
  },
  component: SetupCompleteRoute,
});

function SetupCompleteRoute() {
  const search = Route.useSearch();
  return <SetupCompletePage purchase={search.purchase} />;
}
