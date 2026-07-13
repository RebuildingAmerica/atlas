import { createFileRoute } from "@tanstack/react-router";

async function startAtprotoSignIn(request: Request): Promise<Response> {
  if (!import.meta.env.SSR) {
    throw new Error("ATProto sign-in is only available on the server.");
  }
  const requestUrl = new URL(request.url);
  const handle = requestUrl.searchParams.get("handle")?.trim();
  if (!handle) {
    return Response.json({ error: "ATProto handle is required." }, { status: 400 });
  }
  const returnTo = requestUrl.searchParams.get("returnTo") ?? "/account";
  const { createAtprotoSignInAuthorizationUrl } =
    await import("@/domains/access/server/atproto-oauth");
  const authorizationUrl = await createAtprotoSignInAuthorizationUrl({ handle, returnTo });
  return Response.redirect(authorizationUrl.toString(), 302);
}

export const Route = createFileRoute("/api/atproto/sign-in/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await startAtprotoSignIn(request);
        } catch {
          return Response.json({ error: "ATProto sign-in is unavailable." }, { status: 400 });
        }
      },
    },
  },
});
