import { isNotFound } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AtlasApiError } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import type {
  ConnectionNetwork,
  Entry,
  EntryFilterParams,
  EntryListResponse,
  EntrySlugScope,
} from "@rebuildingamerica/atlas-api-client";
import {
  loadEntryBySlugAny,
  loadProfileBySlug,
  loadProfileConnections,
  loadProfilesCatalog,
} from "@/domains/catalog/server/profiles/profile-loaders";
import { createEntryFixture } from "../../../../../fixtures/catalog/entries";

const mocks = vi.hoisted(() => ({
  getBySlug: vi.fn<(type: string, slug: string) => Promise<unknown>>(),
  getConnections: vi.fn<(entryId: string) => Promise<unknown>>(),
  list: vi.fn<(filters?: unknown) => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: {
    entries: {
      getBySlug: mocks.getBySlug,
      getConnections: mocks.getConnections,
      list: mocks.list,
    },
  },
}));

describe("profile route loaders", () => {
  beforeEach(() => {
    mocks.getBySlug.mockReset();
    mocks.getConnections.mockReset();
    mocks.list.mockReset();
  });

  /**
   * The failure a server function recorded when it was called over the wire.
   *
   * `__executeServer` is the entry point a real HTTP request lands on: it takes
   * the payload as `unknown`, which is what lets these tests push input the
   * typed in-app signature refuses, and it reports the outcome instead of
   * rejecting.
   *
   * @param outcome - What `__executeServer` resolved with.
   * @returns The recorded error, or the whole outcome when it carries none.
   */
  function recordedFailure(outcome: unknown): unknown {
    if (typeof outcome === "object" && outcome !== null && "error" in outcome) {
      return outcome.error;
    }
    return outcome;
  }

  function slugLookup(): Map<string, Entry | Error> {
    const byKey = new Map<string, Entry | Error>();
    mocks.getBySlug.mockImplementation((type: string, slug: string) => {
      const outcome = byKey.get(`${type}/${slug}`);
      if (outcome instanceof Error) {
        return Promise.reject(outcome);
      }
      if (!outcome) {
        return Promise.reject(new AtlasApiError(404, "Entity not found"));
      }
      return Promise.resolve(outcome);
    });
    return byKey;
  }

  describe("loadProfileBySlug", () => {
    it("returns the profile behind a scoped slug", async () => {
      const entry = createEntryFixture({ name: "Ada Reyes", slug: "ada-reyes" });
      slugLookup().set("people/ada-reyes", entry);

      const result = await loadProfileBySlug({ data: { slug: "ada-reyes", type: "people" } });

      expect(result).toEqual(entry);
      expect(mocks.getBySlug).toHaveBeenCalledWith("people", "ada-reyes");
    });

    it("turns a missing profile into a router not-found rather than an error page", async () => {
      slugLookup();

      const thrown = await loadProfileBySlug({
        data: { slug: "ghost", type: "organizations" },
      }).catch((error: unknown) => error);

      expect(isNotFound(thrown)).toBe(true);
    });

    it("lets an outage surface instead of pretending the profile does not exist", async () => {
      const outage = new AtlasApiError(503, "upstream down");
      slugLookup().set("people/ada-reyes", outage);

      await expect(loadProfileBySlug({ data: { slug: "ada-reyes", type: "people" } })).rejects.toBe(
        outage,
      );
    });

    it("lets a non-HTTP failure surface unchanged", async () => {
      const failure = new TypeError("fetch failed");
      slugLookup().set("people/ada-reyes", failure);

      await expect(loadProfileBySlug({ data: { slug: "ada-reyes", type: "people" } })).rejects.toBe(
        failure,
      );
    });

    // Only a caller reaching the server function over the wire can send a scope
    // outside the published set, so this goes through the HTTP entry point where
    // the payload is still unvalidated rather than the typed in-app signature.
    it("refuses a scope Atlas does not publish profiles for", async () => {
      const outcome = await loadProfileBySlug.__executeServer({
        method: "GET",
        data: { slug: "ada-reyes", type: "mascots" },
      });

      expect(recordedFailure(outcome)).toBeInstanceOf(Error);
      expect(mocks.getBySlug).not.toHaveBeenCalled();
    });

    it("refuses an empty slug", async () => {
      await expect(loadProfileBySlug({ data: { slug: "", type: "people" } })).rejects.toThrow();
      expect(mocks.getBySlug).not.toHaveBeenCalled();
    });
  });

  describe("loadProfileConnections", () => {
    it("returns the connection network for one entry", async () => {
      const network: ConnectionNetwork = { actors: [], total: 0 };
      mocks.getConnections.mockResolvedValue(network);

      const result = await loadProfileConnections({ data: { entryId: "entry-1" } });

      expect(result).toEqual(network);
      expect(mocks.getConnections).toHaveBeenCalledWith("entry-1");
    });

    it("refuses an empty entry id", async () => {
      await expect(loadProfileConnections({ data: { entryId: "" } })).rejects.toThrow();
      expect(mocks.getConnections).not.toHaveBeenCalled();
    });
  });

  describe("loadProfilesCatalog", () => {
    it("asks for exactly the slice the overview page will render for that scope", async () => {
      const response = { data: [], facets: {}, pagination: {} } as unknown as EntryListResponse;
      mocks.list.mockResolvedValue(response);

      await loadProfilesCatalog({ data: { scope: "all" } });
      await loadProfilesCatalog({ data: { scope: "people" } });
      const scoped = await loadProfilesCatalog({ data: { scope: "organizations" } });

      expect(scoped).toBe(response);
      expect(mocks.list.mock.calls.map(([filters]) => filters as EntryFilterParams)).toEqual([
        { entry_types: ["person", "organization"], limit: 18 },
        { entry_types: ["person"], limit: 18 },
        { entry_types: ["organization"], limit: 18 },
      ]);
    });

    it("refuses a scope the profiles surface has no shelf for", async () => {
      const outcome = await loadProfilesCatalog.__executeServer({
        method: "GET",
        data: { scope: "everything" },
      });

      expect(recordedFailure(outcome)).toBeInstanceOf(Error);
      expect(mocks.list).not.toHaveBeenCalled();
    });
  });

  describe("loadEntryBySlugAny", () => {
    it("resolves a person slug without waiting for the organization lookup to fail", async () => {
      const entry = createEntryFixture({ name: "Ada Reyes", slug: "ada-reyes" });
      slugLookup().set("people/ada-reyes", entry);

      const result = await loadEntryBySlugAny({ data: { slug: "ada-reyes" } });

      expect(result).toEqual(entry);
      expect(mocks.getBySlug.mock.calls.map(([type]) => type as EntrySlugScope)).toEqual([
        "people",
        "organizations",
      ]);
    });

    it("falls through to the organization of the same slug", async () => {
      const entry = createEntryFixture({
        name: "Beacon Housing Trust",
        slug: "beacon",
        type: "organization",
      });
      slugLookup().set("organizations/beacon", entry);

      await expect(loadEntryBySlugAny({ data: { slug: "beacon" } })).resolves.toEqual(entry);
    });

    it("reports not-found only when neither type holds the slug", async () => {
      slugLookup();

      const thrown = await loadEntryBySlugAny({ data: { slug: "ghost" } }).catch(
        (error: unknown) => error,
      );

      expect(isNotFound(thrown)).toBe(true);
    });

    it("surfaces a person-lookup outage rather than reporting the slug as missing", async () => {
      const outage = new AtlasApiError(500, "boom");
      slugLookup().set("people/ada-reyes", outage);

      await expect(loadEntryBySlugAny({ data: { slug: "ada-reyes" } })).rejects.toBe(outage);
    });

    it("surfaces an organization-lookup outage when the person lookup merely missed", async () => {
      const outage = new AtlasApiError(500, "boom");
      slugLookup().set("organizations/beacon", outage);

      await expect(loadEntryBySlugAny({ data: { slug: "beacon" } })).rejects.toBe(outage);
    });

    it("refuses an empty slug", async () => {
      await expect(loadEntryBySlugAny({ data: { slug: "" } })).rejects.toThrow();
      expect(mocks.getBySlug).not.toHaveBeenCalled();
    });
  });
});
