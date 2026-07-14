import { createFileRoute } from "@tanstack/react-router";

async function loadE2EWorkspaceMemberModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/access/server/e2e-workspace-member");
  }

  /* v8 ignore next -- TanStack server handlers execute with SSR enabled; this guard protects accidental client imports. */
  throw new Error("E2E workspace member seeding is only available on the server.");
}

/**
 * Acceptance-only helper for creating a real second workspace member.
 */
export const Route = createFileRoute("/api/e2e/workspace/member")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { seedE2EWorkspaceMember } = await loadE2EWorkspaceMemberModule();

        return await seedE2EWorkspaceMember(request);
      },
    },
  },
});
