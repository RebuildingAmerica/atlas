import { createFileRoute } from "@tanstack/react-router";
import { OAuthConsentPage, oauthConsentSearchSchema } from "@/domains/access";

export const Route = createFileRoute("/_auth/oauth/consent")({
  ssr: false,
  validateSearch: oauthConsentSearchSchema,
  component: OAuthConsentRoute,
});

function OAuthConsentRoute() {
  const search = Route.useSearch();
  return <OAuthConsentPage clientId={search.client_id} scope={search.scope} />;
}
