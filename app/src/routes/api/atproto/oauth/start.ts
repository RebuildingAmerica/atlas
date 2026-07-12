import { createFileRoute } from "@tanstack/react-router";

async function redirectToAtprotoAuthorization(request: Request): Promise<Response> {
  if (!import.meta.env.SSR) {
    throw new Error("ATProto OAuth is only available on the server.");
  }

  const requestUrl = new URL(request.url);
  const handle = requestUrl.searchParams.get("handle")?.trim();
  if (!handle) {
    return Response.json({ error: "ATProto handle is required." }, { status: 400 });
  }
  const returnTo = requestUrl.searchParams.get("returnTo") ?? "/account";
  const { createAtprotoAuthorizationUrl } = await import("@/domains/access/server/atproto-oauth");
  const authorizationUrl = await createAtprotoAuthorizationUrl({ handle, returnTo });
  return Response.redirect(authorizationUrl.toString(), 302);
}

export const Route = createFileRoute("/api/atproto/oauth/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await redirectToAtprotoAuthorization(request);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "ATProto authorization failed." },
            { status: 400 },
          );
        }
      },
    },
  },
});
