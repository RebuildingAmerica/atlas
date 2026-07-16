import { describe, expect, it } from "vitest";
import { resolveCapabilities, serializeResolvedCapabilities } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import { requireWorkspaceScimAccess } from "@/domains/access/scim.functions";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";

describe("scim.functions", () => {
  it("allows managed Team workspaces with the SCIM capability", () => {
    const session = createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeProducts: ["atlas_team"],
        resolvedCapabilities: serializeResolvedCapabilities(resolveCapabilities(["atlas_team"])),
      }),
    });

    expect(requireWorkspaceScimAccess(session).id).toBe("org_team");
  });

  it("rejects Research Pass workspaces even though their quota matches Team", () => {
    const session = createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeProducts: ["atlas_research_pass"],
        resolvedCapabilities: serializeResolvedCapabilities(
          resolveCapabilities(["atlas_research_pass"]),
        ),
      }),
    });

    expect(() => requireWorkspaceScimAccess(session)).toThrow("SCIM setup is available");
  });
});
