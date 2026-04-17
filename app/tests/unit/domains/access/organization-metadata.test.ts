import { describe, expect, it } from "vitest";
import {
  mergeAtlasOrganizationMetadata,
  normalizeAtlasOrganizationMetadata,
} from "@/domains/access/organization-metadata";

describe("organization-metadata", () => {
  it("normalizes JSON-string metadata returned by Better Auth adapters", () => {
    const metadata = normalizeAtlasOrganizationMetadata('{"workspaceType":"team"}');

    expect(metadata).toEqual({
      ssoPrimaryProviderId: null,
      workspaceType: "team",
    });
  });

  it("preserves stored values when merging string metadata", () => {
    const metadata = mergeAtlasOrganizationMetadata(
      '{"workspaceType":"team","ssoPrimaryProviderId":"provider_123"}',
      {
        ssoPrimaryProviderId: "provider_456",
      },
    );

    expect(metadata).toEqual({
      ssoPrimaryProviderId: "provider_456",
      workspaceType: "team",
    });
  });
});
