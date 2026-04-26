import { createFileRoute } from "@tanstack/react-router";
import { loadPublicSession } from "@/domains/access/server";
import { HomePage } from "@/platform/pages/home-page";

export const Route = createFileRoute("/_public/")({
  loader: async () => ({ session: await loadPublicSession() }),
  component: HomePageWrapper,
});

function HomePageWrapper() {
  const { session } = Route.useLoaderData();
  return <HomePage session={session} />;
}
