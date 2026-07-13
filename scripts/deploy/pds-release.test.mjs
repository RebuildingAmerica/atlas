import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pdsHealthUrl, probePdsHealth } from "./pds-release.mjs";

void describe("PDS release health probe", () => {
  void it("targets the canonical XRPC health endpoint from an HTTPS PDS origin", () => {
    assert.equal(
      pdsHealthUrl("https://pds.atlas.example/"),
      "https://pds.atlas.example/xrpc/_health",
    );
  });

  void it("rejects non-HTTPS PDS origins before making a network request", () => {
    assert.throws(
      () => pdsHealthUrl("http://pds.atlas.example"),
      /ATLAS_PDS_PUBLIC_URL must use HTTPS/,
    );
  });

  void it("requires a healthy XRPC response with an upstream version", async () => {
    await assert.doesNotReject(() =>
      probePdsHealth("https://pds.atlas.example", async (url) => {
        assert.equal(url, "https://pds.atlas.example/xrpc/_health");
        return new Response(JSON.stringify({ version: "0.4.219" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await assert.rejects(
      () =>
        probePdsHealth("https://pds.atlas.example", async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      /PDS health response did not include a version/,
    );
  });
});
