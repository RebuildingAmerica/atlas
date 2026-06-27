import { createFileRoute } from "@tanstack/react-router";
import {
  buildNonActorProfileHead,
  NonActorProfilePage,
  NON_ACTOR_PROFILE_ROUTES,
} from "@/domains/catalog/pages/profiles/detail/non-actor-profile-page";
import { loadProfileBySlug } from "@/domains/catalog/server/profiles/profile-loaders";

const routeConfig = NON_ACTOR_PROFILE_ROUTES.campaigns;

export const Route = createFileRoute("/_public/profiles/campaigns/$slug")({
  loader: async ({ params }) => {
    const entry = await loadProfileBySlug({
      data: { type: routeConfig.scope, slug: params.slug },
    });
    return { entry };
  },
  head: buildNonActorProfileHead(routeConfig),
  component: CampaignProfileRoute,
});

function CampaignProfileRoute() {
  const { entry } = Route.useLoaderData();
  return <NonActorProfilePage entry={entry} />;
}
