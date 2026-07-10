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
    assert.match(message, /My Profile > API Tokens/);
    assert.match(message, /Create Token/);
    assert.match(message, /Edit zone DNS/);
    assert.match(message, /Zone Resources/);
    assert.match(message, /Include > Specific zone > rebuildingus\.org/);
    assert.match(message, /Zone:DNS:Edit and Account:Rulesets:Edit/);
    assert.match(message, /Continue to summary/);
    assert.match(message, /Paste the token here/);
    assert.match(message, /chmod 600/);
  });
});
