import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearProvisioningDemoEnv } from "../../helpers/provisioning-demo-env";

vi.mock("../../../src/domains/access/server/demo-workspace-provisioning", () => ({
  BRIEFING_ROOM_FIRST_SAVED_VIEWS: ["Detroit mutual aid follow-up", "Atlanta housing follow-up"],
  provisionCustomerWorkspace: vi.fn(),
}));

describe("provision briefing room workspace script options", () => {
  beforeEach(() => {
    vi.resetModules();
    clearProvisioningDemoEnv();
  });

  afterEach(() => {
    clearProvisioningDemoEnv();
  });

  it("rejects flag-looking values as missing option values", async () => {
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    expect(() => parseOptions(["--email", "--product", "atlas_team"])).toThrow(
      "--email requires a value.",
    );
  });

  it("requires an operator email from either a flag or the environment", async () => {
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    expect(() => parseOptions([])).toThrow("ATLAS_DEMO_USER_EMAIL or --email is required.");
  });

  it("fills every unset option from its documented default", async () => {
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    expect(parseOptions(["--email", "ops@atlas.test"])).toEqual({
      demoDataSeed: "briefing_room",
      firstSavedViews: ["Detroit mutual aid follow-up", "Atlanta housing follow-up"],
      organizationId: "briefing-room-demo",
      organizationName: "Atlas Briefing Room Demo",
      organizationSlug: "briefing-room-demo",
      product: "atlas_team",
      userEmail: "ops@atlas.test",
      userId: "briefing-room-operator",
      userName: "Briefing Room Operator",
    });
  });

  it("prefers a flag over the environment for the same option", async () => {
    vi.stubEnv("ATLAS_DEMO_ORG_ID", "from-env");
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    expect(
      parseOptions(["--email", "ops@atlas.test", "--org-id", "from-flag"]).organizationId,
    ).toBe("from-flag");
    expect(parseOptions(["--email", "ops@atlas.test"]).organizationId).toBe("from-env");
  });

  it("splits a saved-view list and drops blank entries", async () => {
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    expect(
      parseOptions([
        "--email",
        "ops@atlas.test",
        "--first-saved-views",
        " Detroit follow-up , , Atlanta follow-up ",
      ]).firstSavedViews,
    ).toEqual(["Detroit follow-up", "Atlanta follow-up"]);
  });

  it("rejects a saved-view list that is only separators", async () => {
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    expect(() =>
      parseOptions(["--email", "ops@atlas.test", "--first-saved-views", " , , "]),
    ).toThrow("ATLAS_DEMO_FIRST_SAVED_VIEWS or --first-saved-views must include at least one");
  });

  it("seeds no saved views when demo data is turned off", async () => {
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    const options = parseOptions(["--email", "ops@atlas.test", "--demo-data", "none"]);
    expect(options.demoDataSeed).toBe("none");
    expect(options.firstSavedViews).toEqual([]);
  });

  it("rejects an unknown product or demo seed rather than guessing", async () => {
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    expect(() => parseOptions(["--email", "ops@atlas.test", "--product", "atlas_gold"])).toThrow(
      "Unsupported Atlas product: atlas_gold.",
    );
    expect(() => parseOptions(["--email", "ops@atlas.test", "--demo-data", "everything"])).toThrow(
      "Unsupported demo data seed: everything.",
    );
  });

  it("accepts each supported product identifier", async () => {
    const { parseOptions } = await import("../../../scripts/provision-briefing-room-workspace");

    for (const product of ["atlas_pro", "atlas_team", "atlas_research_pass"]) {
      expect(parseOptions(["--email", "ops@atlas.test", "--product", product]).product).toBe(
        product,
      );
    }
  });

  it("reports what it provisioned", async () => {
    const provisioning =
      await import("../../../src/domains/access/server/demo-workspace-provisioning");
    vi.mocked(provisioning.provisionCustomerWorkspace).mockResolvedValue({
      demoDataSeed: "briefing_room",
      firstSavedViews: ["Detroit mutual aid follow-up"],
      organizationId: "briefing-room-demo",
      product: "atlas_team",
      seedCommand: "pnpm seed",
      userId: "briefing-room-operator",
    });
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const { runProvisioningScript } =
      await import("../../../scripts/provision-briefing-room-workspace");
    await runProvisioningScript(["--email", "ops@atlas.test"]);

    expect(write.mock.calls[0]?.[0]).toContain("org=briefing-room-demo");
    expect(write.mock.calls[0]?.[0]).toContain("firstSavedViews=Detroit mutual aid follow-up");
    expect(write.mock.calls[0]?.[0]).toContain("seedCommand=pnpm seed");
  });

  it("reports none when there is no seed command and no saved views", async () => {
    const provisioning =
      await import("../../../src/domains/access/server/demo-workspace-provisioning");
    vi.mocked(provisioning.provisionCustomerWorkspace).mockResolvedValue({
      demoDataSeed: "none",
      firstSavedViews: [],
      organizationId: "briefing-room-demo",
      product: "atlas_team",
      seedCommand: null,
      userId: "briefing-room-operator",
    });
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const { runProvisioningScript } =
      await import("../../../scripts/provision-briefing-room-workspace");
    await runProvisioningScript(["--email", "ops@atlas.test", "--demo-data", "none"]);

    expect(write.mock.calls[0]?.[0]).toContain("firstSavedViews=none");
    expect(write.mock.calls[0]?.[0]).toContain("seedCommand=none");
  });
});
