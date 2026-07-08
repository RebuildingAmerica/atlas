import { createFileRoute } from "@tanstack/react-router";

async function completeAtprotoCallback(request: Request): Promise<Response> {
  if (!import.meta.env.SSR) {
    throw new Error("ATProto OAuth is only available on the server.");
  }

  const requestUrl = new URL(request.url);
  const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");
  const redirectUrl = await completeAtprotoAuthorization(requestUrl.searchParams);
  return Response.redirect(redirectUrl, 302);
}

interface RecoverableAtprotoCallbackError {
  attemptedHandle?: string;
  message: string;
  returnTo: string;
}

function recoverableCallbackError(error: unknown): RecoverableAtprotoCallbackError | null {
  if (!(error instanceof Error)) return null;
  if (!("returnTo" in error) || typeof error.returnTo !== "string") return null;
  const attemptedHandle =
    "attemptedHandle" in error && typeof error.attemptedHandle === "string"
      ? error.attemptedHandle
      : undefined;
  return {
    attemptedHandle,
    message: error.message || "ATProto callback failed.",
    returnTo: error.returnTo,
  };
}

function recoverableCallbackRedirect(request: Request, error: unknown): Response | null {
  const recoverable = recoverableCallbackError(error);
  if (!recoverable) return null;
  const requestUrl = new URL(request.url);
  const redirectUrl = new URL(recoverable.returnTo, requestUrl.origin);
  if (redirectUrl.origin !== requestUrl.origin || !redirectUrl.pathname.startsWith("/claim/")) {
    return null;
  }
  redirectUrl.searchParams.set("atprotoError", recoverable.message);
  if (recoverable.attemptedHandle) {
    redirectUrl.searchParams.set("atprotoHandle", recoverable.attemptedHandle);
  }
  return Response.redirect(redirectUrl.toString(), 302);
}

export const Route = createFileRoute("/api/atproto/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await completeAtprotoCallback(request);
        } catch (error) {
          const redirect = recoverableCallbackRedirect(request, error);
          if (redirect) return redirect;
          return Response.json(
            { error: error instanceof Error ? error.message : "ATProto callback failed." },
            { status: 400 },
          );
        }
      },
    },
  },
});
