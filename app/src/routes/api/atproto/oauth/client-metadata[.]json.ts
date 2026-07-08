import { createFileRoute } from "@tanstack/react-router";

async function readClientMetadata() {
  if (import.meta.env.SSR) {
    const { getAtprotoClientMetadata } = await import("@/domains/access/server/atproto-oauth");
    return getAtprotoClientMetadata();
  }
  throw new Error("ATProto client metadata is only available on the server.");
}

export const Route = createFileRoute("/api/atproto/oauth/client-metadata.json")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(await readClientMetadata(), {
          headers: {
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
