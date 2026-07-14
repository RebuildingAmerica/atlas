import { createFileRoute } from "@tanstack/react-router";

async function loadHostedE2EModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/access/server/hosted-e2e");
  }

  /* v8 ignore next -- TanStack server handlers execute with SSR enabled; this guard protects accidental client imports. */
  throw new Error("Hosted E2E identity verification is only available on the server.");
}

/**
 * Staging-only helper used by hosted identity verification. The server module
 * returns 404 unless the explicit hosted E2E environment guard passes.
 */
export const Route = createFileRoute("/api/e2e/hosted/identity")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleHostedE2EIdentityRequest } = await loadHostedE2EModule();

        return await handleHostedE2EIdentityRequest(request);
      },
    },
  },
});
