import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSitemapEntry,
  buildSitemapEntryListResponse,
  readSitemapXml,
} from "../../helpers/sitemap-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: {
    entries: {
      list: vi.fn(),
    },
    publicDirectories: {
      list: vi.fn(),
    },
  },
}));

describe("routes/sitemap.xml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits an XML sitemap with profile URLs and skips entries without a slug", async () => {
    const { api } = await import("@rebuildingamerica/atlas-api-client");
    vi.mocked(api.publicDirectories.list).mockResolvedValue({
      directories: [
        {
          org_id: "tenant-kc",
          record_count: 3,
          last_published_at: "2024-04-03T10:00:00Z",
        },
      ],
    });
    vi.mocked(api.entries.list).mockImplementation(
      (params: { entry_types?: string[] } | undefined) => {
        if (params?.entry_types?.includes("person")) {
          return Promise.resolve(
            buildSitemapEntryListResponse([
              buildSitemapEntry({ type: "person", slug: "jane-doe" }),
              buildSitemapEntry({ type: "person", slug: "" }),
            ]),
          );
        }
        return Promise.resolve(
          buildSitemapEntryListResponse([
            buildSitemapEntry({
              type: "organization",
              slug: "acme",
              updated_at: "2024-04-02T00:00:00Z",
            }),
          ]),
        );
      },
    );

    const body = await readSitemapXml();
    expect(body).toContain("https://atlas.rebuildingus.org/profiles/people/jane-doe");
    expect(body).toContain("https://atlas.rebuildingus.org/profiles/organizations/acme");
    expect(body).toContain("https://atlas.rebuildingus.org/directories/tenant-kc");
    expect(body).toContain("<lastmod>2024-04-03</lastmod>");
    expect(body).toContain("<lastmod>2024-04-01</lastmod>");
    expect(body).not.toContain("/profiles/people/null");
  });

  it("lists a never-published directory without inventing a last-modified date", async () => {
    const { api } = await import("@rebuildingamerica/atlas-api-client");
    vi.mocked(api.publicDirectories.list).mockResolvedValue({
      directories: [
        {
          org_id: "prairie-network",
          record_count: 0,
          last_published_at: null,
        },
      ],
    });
    vi.mocked(api.entries.list).mockResolvedValue(buildSitemapEntryListResponse([]));

    const body = await readSitemapXml();
    const directoryBlock = body
      .split("<url>")
      .find((block) => block.includes("/directories/prairie-network"));

    expect(directoryBlock).toContain(
      "<loc>https://atlas.rebuildingus.org/directories/prairie-network</loc>",
    );
    expect(directoryBlock).not.toContain("<lastmod>");
  });

  it("paginates entry lists inside the public API limit", async () => {
    const { api } = await import("@rebuildingamerica/atlas-api-client");
    vi.mocked(api.publicDirectories.list).mockResolvedValue({ directories: [] });
    vi.mocked(api.entries.list).mockImplementation((params) => {
      if (params?.entry_types?.includes("person") && params.offset === 100) {
        return Promise.resolve(
          buildSitemapEntryListResponse(
            [buildSitemapEntry({ type: "person", slug: "ada-lovelace" })],
            {
              limit: 100,
              offset: 100,
              total: 101,
            },
          ),
        );
      }

      if (params?.entry_types?.includes("person")) {
        return Promise.resolve(
          buildSitemapEntryListResponse([buildSitemapEntry({ type: "person", slug: "jane-doe" })], {
            hasMore: true,
            limit: 100,
            offset: 0,
            total: 101,
          }),
        );
      }

      return Promise.resolve(
        buildSitemapEntryListResponse(
          [buildSitemapEntry({ type: "organization", slug: "prairie-network" })],
          {
            limit: 100,
            offset: 0,
            total: 1,
          },
        ),
      );
    });

    const body = await readSitemapXml();
    const entryListCalls = vi.mocked(api.entries.list).mock.calls.map(([params]) => params);

    expect(body).toContain("/profiles/people/jane-doe");
    expect(body).toContain("/profiles/people/ada-lovelace");
    expect(entryListCalls).toEqual([
      { entry_types: ["person"], limit: 100, offset: 0 },
      { entry_types: ["organization"], limit: 100, offset: 0 },
      { entry_types: ["person"], limit: 100, offset: 100 },
    ]);
    expect(entryListCalls.every((params) => params?.limit === 100)).toBe(true);
  });

  it("caps how many pages are in flight at once", async () => {
    const { api } = await import("@rebuildingamerica/atlas-api-client");
    vi.mocked(api.publicDirectories.list).mockResolvedValue({ directories: [] });

    // 1,001 people is 11 pages: one to read the total, then ten more that must
    // not all leave at the same time.
    const PEOPLE_TOTAL = 1001;
    let inFlight = 0;
    let peakInFlight = 0;

    vi.mocked(api.entries.list).mockImplementation(async (params) => {
      if (!params?.entry_types?.includes("person")) {
        return buildSitemapEntryListResponse([]);
      }
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return buildSitemapEntryListResponse(
        [buildSitemapEntry({ type: "person", slug: `page-${params.offset ?? 0}` })],
        { limit: 100, offset: params.offset, total: PEOPLE_TOTAL },
      );
    });

    const body = await readSitemapXml();

    expect(peakInFlight).toBeLessThanOrEqual(6);
    expect(body).toContain("/profiles/people/page-1000");
  });

  it("refuses to page when the API reports a nonsense total", async () => {
    const { api } = await import("@rebuildingamerica/atlas-api-client");
    vi.mocked(api.publicDirectories.list).mockResolvedValue({ directories: [] });
    vi.mocked(api.entries.list).mockResolvedValue(
      buildSitemapEntryListResponse([buildSitemapEntry({ type: "person", slug: "jane-doe" })], {
        total: Number.NaN,
      }),
    );

    await expect(readSitemapXml()).rejects.toThrow(/reported a total of NaN/);
  });

  it("requests every later page at once rather than one after another", async () => {
    const { api } = await import("@rebuildingamerica/atlas-api-client");
    vi.mocked(api.publicDirectories.list).mockResolvedValue({ directories: [] });

    const requestedLaterOffsets: number[] = [];
    let releaseLaterPages: () => void = () => undefined;
    const laterPagesReleased = new Promise<void>((resolve) => {
      releaseLaterPages = resolve;
    });

    vi.mocked(api.entries.list).mockImplementation(async (params) => {
      if (!params?.entry_types?.includes("person")) {
        return buildSitemapEntryListResponse([]);
      }
      if (params.offset === 0) {
        return buildSitemapEntryListResponse(
          [buildSitemapEntry({ type: "person", slug: "jane-doe" })],
          { hasMore: true, limit: 100, offset: 0, total: 201 },
        );
      }
      requestedLaterOffsets.push(params.offset ?? 0);
      await laterPagesReleased;
      return buildSitemapEntryListResponse(
        [buildSitemapEntry({ type: "person", slug: `page-${params.offset}` })],
        { limit: 100, offset: params.offset, total: 201 },
      );
    });

    const bodyPromise = readSitemapXml();
    await vi.waitFor(() => {
      expect(requestedLaterOffsets).toEqual([100, 200]);
    });
    releaseLaterPages();

    const body = await bodyPromise;
    expect(body).toContain("/profiles/people/page-100");
    expect(body).toContain("/profiles/people/page-200");
  });

  it("uses the configured public origin for sitemap URLs", async () => {
    vi.stubEnv("ATLAS_PUBLIC_URL", "https://preview.atlas.example/app");
    const { api } = await import("@rebuildingamerica/atlas-api-client");
    vi.mocked(api.publicDirectories.list).mockResolvedValue({ directories: [] });
    vi.mocked(api.entries.list).mockResolvedValue(
      buildSitemapEntryListResponse([buildSitemapEntry({ type: "person", slug: "jane-doe" })]),
    );

    const body = await readSitemapXml();

    expect(body).toContain("https://preview.atlas.example/profiles/people/jane-doe");
    expect(body).toContain("https://preview.atlas.example/browse");
    expect(body).not.toContain("https://atlas.rebuildingus.org/profiles/people/jane-doe");
  });

  it("renders the static sitemap header when no entries are returned", async () => {
    const { api } = await import("@rebuildingamerica/atlas-api-client");
    vi.mocked(api.publicDirectories.list).mockResolvedValue({ directories: [] });
    vi.mocked(api.entries.list).mockResolvedValue(buildSitemapEntryListResponse([]));

    const body = await readSitemapXml();
    expect(body).toContain("https://atlas.rebuildingus.org</loc>");
    expect(body).toContain("https://atlas.rebuildingus.org/browse</loc>");
  });
});
