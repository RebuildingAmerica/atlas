import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PRODUCTION_API_ORIGIN,
  buildVercelEnvVars,
  formatMintlifyDocsOriginPromptMessage,
  formatProductionApiProxyPromptMessage,
  formatProductionAppUrlPromptMessage,
  resolveHostedOriginPromptValue,
} from "./env-routing.js";

void describe("hosted routing prompts", () => {
  void it("uses the shown production API default when the submitted value is blank", () => {
    assert.equal(
      resolveHostedOriginPromptValue(
        "",
        DEFAULT_PRODUCTION_API_ORIGIN,
        "ATLAS_SERVER_API_PROXY_TARGET",
      ),
      DEFAULT_PRODUCTION_API_ORIGIN,
    );
  });

  void it("explains the production app URL prompt at the point of entry", () => {
    const message = formatProductionAppUrlPromptMessage();

    assert.match(message, /Open the Vercel project/);
    assert.match(message, /Press Enter to accept the shown default/);
    assert.match(message, /ATLAS_PUBLIC_URL/);
  });

  void it("explains the API proxy origin prompt at the point of entry", () => {
    const message = formatProductionApiProxyPromptMessage();

    assert.match(message, /proxy \/api traffic/);
    assert.match(message, /Do not paste a path/);
    assert.match(message, /ATLAS_SERVER_API_PROXY_TARGET/);
  });

  void it("explains the Mintlify docs origin prompt at the point of entry", () => {
    const message = formatMintlifyDocsOriginPromptMessage();

    assert.match(message, /Open the Mintlify project dashboard/);
    assert.match(message, /Host at \/docs/);
    assert.match(message, /ATLAS_DOCS_URL/);
  });

  void it("syncs operator access to production and preview apps", () => {
    const vars = buildVercelEnvVars(
      new Map([["ATLAS_OPERATOR_ALLOWED_EMAILS", "operator@example.org"]]),
    );

    assert.deepEqual(
      vars.find((item) => item.key === "ATLAS_OPERATOR_ALLOWED_EMAILS"),
      {
        key: "ATLAS_OPERATOR_ALLOWED_EMAILS",
        value: "operator@example.org",
        environments: ["production", "preview"],
      },
    );
  });
});
