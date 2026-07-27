import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPublicDirectory } from "@/domains/catalog/server/public-directory";
import type { PublicDirectoryResponse } from "@/domains/catalog/server/public-directory";
import { stubFetch } from "../../../../helpers/stub-fetch";
import type { StubbedFetch } from "../../../../helpers/stub-fetch";

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

describe("loadPublicDirectory", () => {
  let http: StubbedFetch;

  beforeEach(() => {
    vi.stubEnv("ATLAS_PUBLIC_URL", "https://atlas.example.org");
    vi.stubEnv("ATLAS_SERVER_API_PROXY_TARGET", "");
  });

  function directory(): PublicDirectoryResponse {
    return {
      entries: [],
      methodology: {
        correction_path_template: "/corrections/{id}",
        correction_policy: "Corrections are published with the record.",
        missing_context_path_template: "/context/{id}",
        review_policy: "Every record is reviewed before publication.",
        source_policy: "Every claim carries a public source.",
        summary: "How this directory is built.",
      },
      publication: { private_notes_exposed: false, visibility: "public" },
      scope: {
        entry_types: ["organization"],
        geography_labels: ["Mississippi"],
        issue_area_ids: [],
      },
      stats: {
        last_reviewed_at: "2026-05-01T00:00:00Z",
        record_count: 12,
        source_backed_record_count: 12,
        source_count: 40,
      },
      title: "Delta Housing Directory",
      trust_footer: {
        body: "Every record links to its sources.",
        label: "How to trust this",
        provenance_required: true,
      },
      workspace: { id: "org_1", name: "Delta Collective" },
    };
  }

  it("returns the published directory for a workspace", async () => {
    http = stubFetch({ body: directory() });

    const result = await loadPublicDirectory({ data: { orgId: "org_1" } });

    expect(result).toEqual(directory());
    expect(http.requests[0]?.url).toBe(
      "https://atlas.example.org/api/orgs/org_1/entries/public-directory",
    );
    expect(http.requests[0]?.init?.headers).toEqual({ Accept: "application/json" });
  });

  it("escapes a workspace id so it cannot reshape the request path", async () => {
    http = stubFetch({ body: directory() });

    await loadPublicDirectory({ data: { orgId: "org 1/../secrets" } });

    expect(http.requests[0]?.url).toBe(
      "https://atlas.example.org/api/orgs/org%201%2F..%2Fsecrets/entries/public-directory",
    );
  });

  it("reaches the API through the server proxy target when one is configured", async () => {
    vi.stubEnv("ATLAS_SERVER_API_PROXY_TARGET", "http://api.internal:8000");
    http = stubFetch({ body: directory() });

    await loadPublicDirectory({ data: { orgId: "org_1" } });

    expect(http.requests[0]?.url).toBe(
      "http://api.internal:8000/api/orgs/org_1/entries/public-directory",
    );
  });

  it("fails rather than rendering a directory from an error body", async () => {
    stubFetch({ body: { detail: "no such workspace" }, status: 404 });

    await expect(loadPublicDirectory({ data: { orgId: "org_1" } })).rejects.toThrow(
      "Public directory could not be loaded.",
    );
  });

  it("refuses an empty workspace id before touching the network", async () => {
    http = stubFetch({ body: directory() });

    await expect(loadPublicDirectory({ data: { orgId: "" } })).rejects.toThrow();
    expect(http.requests).toHaveLength(0);
  });
});
