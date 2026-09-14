// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { profileEntryQueryKey, useProfileEntry } from "@/domains/catalog/hooks/use-profile-entry";
import {
  loadEntryBySlugAny,
  loadProfileBySlug,
} from "@/domains/catalog/server/profiles/profile-loaders";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";
import { createTestQueryClient } from "../../../../helpers/render-with-providers";

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadEntryBySlugAny: vi.fn(),
  loadProfileBySlug: vi.fn(),
}));

describe("useProfileEntry", () => {
  it("shares the scoped cache entry with useEntryBySlug so neither fetches it twice", async () => {
    const queryClient = createTestQueryClient();
    const entry = createEntryFixture({ name: "Ada Reyes", slug: "ada-reyes" });
    vi.mocked(loadProfileBySlug).mockResolvedValue(entry);

    const { result } = renderHook(() => useProfileEntry({ scope: "people", slug: "ada-reyes" }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current).toEqual(entry);
    });
    expect(profileEntryQueryKey({ scope: "people", slug: "ada-reyes" })).toEqual([
      "entries",
      "by-slug",
      "people",
      "ada-reyes",
    ]);
    expect(queryClient.getQueryData(["entries", "by-slug", "people", "ada-reyes"])).toEqual(entry);
  });

  it("resolves a slug of either actor type through the loader's any-type lookup", async () => {
    const queryClient = createTestQueryClient();
    const entry = createEntryFixture({ name: "Acme", slug: "acme", type: "organization" });
    vi.mocked(loadEntryBySlugAny).mockResolvedValue(entry);

    const { result } = renderHook(() => useProfileEntry({ scope: "any", slug: "acme" }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    expect(result.current).toBeUndefined();
    await waitFor(() => {
      expect(result.current).toEqual(entry);
    });
    expect(loadEntryBySlugAny).toHaveBeenCalledWith({ data: { slug: "acme" } });
    expect(queryClient.getQueryData(["entries", "by-slug-any", "acme"])).toEqual(entry);
  });
});
