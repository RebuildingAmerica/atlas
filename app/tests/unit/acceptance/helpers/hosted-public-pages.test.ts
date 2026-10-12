import { afterEach, expect, it, vi } from "vitest";
import { firstProfilePath } from "@/../tests/helpers/hosted-public-pages";

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each(["person", "organization"] as const)(
  "selects an actual published %s profile using the API filter",
  async (type) => {
    vi.stubGlobal("fetch", (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get("entity_type") !== type) {
        return Promise.resolve(
          Response.json({ error: "Missing entity type filter" }, { status: 400 }),
        );
      }
      return Promise.resolve(Response.json({ items: [{ slug: "published-profile", type }] }));
    });
    const collection = type === "person" ? "people" : "organizations";
    await expect(firstProfilePath("https://candidate.example.com", type)).resolves.toBe(
      `/profiles/${collection}/published-profile`,
    );
  },
);

it("rejects a mismatched profile instead of testing an unrelated 404 page", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(Response.json({ items: [{ slug: "an-organization", type: "organization" }] })),
  );
  await expect(firstProfilePath("https://candidate.example.com", "person")).rejects.toThrow(
    "entity type",
  );
});
