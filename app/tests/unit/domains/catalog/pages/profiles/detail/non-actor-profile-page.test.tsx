// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HeadNameMeta, PageHead } from "@/platform/seo";
import {
  NON_ACTOR_PROFILE_ROUTES,
  NonActorProfilePage,
  buildNonActorProfileHead,
} from "@/domains/catalog/pages/profiles/detail/non-actor-profile-page";
import { createEntryFixture } from "../../../../../../fixtures/catalog/entries";
import { renderWithProviders } from "../../../../../../helpers/render-with-providers";
import { stubFetch } from "../../../../../../helpers/stub-fetch";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("non-actor profiles", () => {
  function initiative() {
    return createEntryFixture({
      description: "A five-year plan to keep long-time residents in place.",
      name: "Delta Housing Initiative",
      slug: "delta-housing-initiative",
      type: "initiative",
    });
  }

  function metaOf(head: PageHead | Record<string, never>) {
    return "meta" in head ? head.meta : [];
  }

  describe("buildNonActorProfileHead", () => {
    it("titles an initiative with its own kind so search results read correctly", () => {
      const head = buildNonActorProfileHead(NON_ACTOR_PROFILE_ROUTES.initiatives)({
        loaderData: { entry: initiative() },
      });

      expect(metaOf(head)).toContainEqual({
        title: "Delta Housing Initiative — Initiative | Atlas",
      });
      expect(metaOf(head)).toContainEqual({
        content: "Delta Housing Initiative",
        property: "og:title",
      });
      expect(metaOf(head)).toContainEqual({ content: "article", property: "og:type" });
      expect("links" in head ? head.links : []).toContainEqual({
        href: "https://atlas.rebuildingamerica.com/profiles/initiatives/delta-housing-initiative",
        rel: "canonical",
      });
    });

    it("labels campaigns and events with their own kind", () => {
      expect(
        metaOf(
          buildNonActorProfileHead(NON_ACTOR_PROFILE_ROUTES.campaigns)({
            loaderData: { entry: initiative() },
          }),
        ),
      ).toContainEqual({ title: "Delta Housing Initiative — Campaign | Atlas" });
      expect(
        metaOf(
          buildNonActorProfileHead(NON_ACTOR_PROFILE_ROUTES.events)({
            loaderData: { entry: initiative() },
          }),
        ),
      ).toContainEqual({ title: "Delta Housing Initiative — Event | Atlas" });
    });

    it("truncates a long description to what a link preview will actually show", () => {
      const head = buildNonActorProfileHead(NON_ACTOR_PROFILE_ROUTES.initiatives)({
        loaderData: {
          entry: createEntryFixture({
            description: "Housing. ".repeat(40),
            name: "Delta Housing Initiative",
            slug: "delta-housing-initiative",
            type: "initiative",
          }),
        },
      });

      const description = metaOf(head).find(
        (entry): entry is HeadNameMeta => "name" in entry && entry.name === "description",
      );
      expect(description?.content).toHaveLength(160);
    });

    it("emits nothing rather than a head describing a record that failed to load", () => {
      const build = buildNonActorProfileHead(NON_ACTOR_PROFILE_ROUTES.events);

      expect(build({})).toEqual({});
      expect(build({ loaderData: {} })).toEqual({});
    });
  });

  describe("NonActorProfilePage", () => {
    it("shows the record so a reader can judge it against its sources", () => {
      stubFetch({ body: { detail: "the page should not have needed the network" }, status: 500 });

      renderWithProviders(<NonActorProfilePage entry={initiative()} />);

      expect(screen.getByText("Delta Housing Initiative")).toBeInTheDocument();
      expect(
        screen.getByText("A five-year plan to keep long-time residents in place."),
      ).toBeInTheDocument();
    });
  });
});
