import { createFileRoute } from "@tanstack/react-router";
import {
  UserFacingError,
  userFacingErrorMessage,
} from "@rebuildingamerica/atlas-api-client/user-facing-errors";

async function authorizeWithAtprotoHarness(request: Request): Promise<Response> {
  if (!import.meta.env.SSR) {
    throw new UserFacingError("ATProto OAuth is only available on the server.");
  }

  const requestUrl = new URL(request.url);
  const { createAtprotoHarnessProviderCallbackUrl } =
    await import("@/domains/access/server/atproto-oauth");
  return Response.redirect(
    createAtprotoHarnessProviderCallbackUrl(requestUrl.searchParams).toString(),
    302,
  );
}

export const Route = createFileRoute("/api/atproto/oauth/harness/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await authorizeWithAtprotoHarness(request);
        } catch (error) {
          return Response.json(
            { error: userFacingErrorMessage(error, "ATProto provider failed.") },
            { status: 400 },
          );
        }
      },
    },
  },
});
