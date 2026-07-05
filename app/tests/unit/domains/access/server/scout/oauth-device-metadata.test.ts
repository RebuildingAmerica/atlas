import { describe, expect, it } from "vitest";
import { deviceAuthUrl } from "@/domains/access/device-auth-paths";
import { buildAuthorizationServerMetadata } from "@/domains/access/oauth-as-metadata";

describe("Scout CLI device auth metadata", () => {
  it("advertises the device authorization endpoint", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.device_authorization_endpoint).toBe(
      deviceAuthUrl("https://atlas.example", "code"),
    );
  });

  it("advertises the device authorization grant", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.grant_types_supported).toContain(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
  });
});
