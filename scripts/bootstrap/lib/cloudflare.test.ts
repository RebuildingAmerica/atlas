import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCloudflareTokenPromptMessage } from "./cloudflare.js";

void describe("Cloudflare prompt guidance", () => {
  void it("explains where to create a token and which scope to use", () => {
    const message = formatCloudflareTokenPromptMessage({
      permissionLines: [
        "DNS & Zones > DNS > Edit",
        "DNS & Zones > Zone > Read",
        "App Security > Zone WAF Rules > Edit",
        "Rules & Configuration > Zone Transform Rules > Edit",
      ],
      tokenNameHint: "Atlas Cloudflare API Edge",
      zoneHint: "rebuildingus.org",
    });

    assert.match(
      message,
      /dash\.cloudflare\.com\/e34437d6da60fe58537bafc5eb760cfc\/api-tokens/,
    );
    assert.match(message, /Manage account > Account API tokens/);
    assert.match(message, /Create token/);
    assert.match(message, /Atlas Cloudflare API Edge/);
    assert.match(message, /Specified Domains/);
    assert.match(message, /rebuildingus\.org/);
    assert.match(message, /DNS & Zones > DNS > Edit/);
    assert.match(message, /DNS & Zones > Zone > Read/);
    assert.match(message, /App Security > Zone WAF Rules > Edit/);
    assert.match(
      message,
      /Rules & Configuration > Zone Transform Rules > Edit/,
    );
    assert.match(message, /Do not select Entire Account/);
    assert.match(message, /Do not select HTTP DDoS Managed Ruleset/);
    assert.doesNotMatch(message, /Rulesets/);
    assert.match(message, /Continue to summary/);
    assert.match(message, /Paste the token here/);
    assert.match(message, /chmod 600/);
  });
});
