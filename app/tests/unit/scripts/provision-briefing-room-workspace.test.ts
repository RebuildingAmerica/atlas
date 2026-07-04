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
});
