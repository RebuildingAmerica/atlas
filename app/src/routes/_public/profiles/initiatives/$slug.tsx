import { createFileRoute } from "@tanstack/react-router";
import {
  buildNonActorProfileHead,
  NON_ACTOR_PROFILE_ROUTES,
} from "@/domains/catalog/pages/profiles/detail/non-actor-profile-page";
import { ProfileRoutePage } from "@/domains/catalog/pages/profiles/detail/profile-route-page";
import { loadProfileBySlug } from "@/domains/catalog/server/profiles/profile-loaders";
import { loadOrDegrade } from "@/platform/routes/load-or-degrade";

const routeConfig = NON_ACTOR_PROFILE_ROUTES.initiatives;

export const Route = createFileRoute("/_public/profiles/initiatives/$slug")({
  loader: async ({ params }) => {
    const entry = await loadOrDegrade(() =>
      loadProfileBySlug({ data: { type: routeConfig.scope, slug: params.slug } }),
    );
    return { entry };
  },
  head: buildNonActorProfileHead(routeConfig),
  component: InitiativeProfileRoute,
});

function InitiativeProfileRoute() {
  const { entry } = Route.useLoaderData();
  const { slug } = Route.useParams();
  return <ProfileRoutePage scope={routeConfig.scope} slug={slug} entry={entry} />;
}
