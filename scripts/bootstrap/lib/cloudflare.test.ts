import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCloudflareTokenPromptMessage } from "./cloudflare.js";

void describe("Cloudflare prompt guidance", () => {
  void it("explains where to create a token and which scope to use", () => {
    const message = formatCloudflareTokenPromptMessage({
      permissionsHint: "Zone:DNS:Edit and Account:Rulesets:Edit",
      zoneHint: "rebuildingus.org",
    });

    assert.match(message, /dash\.cloudflare\.com\/profile\/api-tokens/);
    assert.match(message, /Create a custom token/);
    assert.match(message, /Zone:DNS:Edit and Account:Rulesets:Edit/);
    assert.match(message, /Restrict the token to the rebuildingus\.org zone/);
    assert.match(message, /Paste the token here/);
    assert.match(message, /chmod 600/);
  });
});
