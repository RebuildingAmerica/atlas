import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatExistingPublisherKeypairPromptMessage,
  formatMcpTxtMismatchMessage,
  formatMcpTxtUpdatePromptMessage,
  shouldAutofixMcpTxtMismatch,
} from "./mcp-registry.js";

void describe("MCP Registry prompt guidance", () => {
  void it("explains the publisher keypair keep-or-rotate decision", () => {
    const message = formatExistingPublisherKeypairPromptMessage();

    assert.match(message, /found a local publisher keypair/);
    assert.match(message, /Rotate only if/);
    assert.match(message, /requires updating the Cloudflare TXT proof/);
    assert.match(
      message,
      /If you rotate, bootstrap will update Cloudflare next/,
    );
  });

  void it("explains the DNS proof update options", () => {
    const message = formatMcpTxtUpdatePromptMessage();

    assert.match(message, /MCPv1 TXT record/);
    assert.match(message, /Choose Cloudflare API/);
    assert.match(message, /wait for DNS and verify/);
    assert.match(
      message,
      /Stop if you are not sure which publisher key is correct/,
    );
  });

  void it("explains an out-of-sync DNS proof as an operator decision", () => {
    const message = formatMcpTxtMismatchMessage({
      domain: "rebuildingus.org",
      liveTxt: "v=MCPv1; k=ed25519; p=live-key",
      expectedTxt: "v=MCPv1; k=ed25519; p=local-key",
    });

    assert.match(
      message,
      /Cloudflare currently trusts a different publisher key/,
    );
    assert.match(
      message,
      /Publishing will fail until DNS and the local key agree/,
    );
    assert.match(message, /Update Cloudflare if you intentionally rotated/);
    assert.match(message, /Stop and restore the previous local publisher key/);
    assert.match(message, /Current DNS proof/);
    assert.match(message, /Local key bootstrap wants/);
  });

  void it("autofixes DNS only when the local key change proves intent", () => {
    assert.equal(
      shouldAutofixMcpTxtMismatch({
        keypairAction: "rotated",
        liveTxt: "v=MCPv1; k=ed25519; p=old-key",
        doctorMode: false,
      }),
      true,
    );
    assert.equal(
      shouldAutofixMcpTxtMismatch({
        keypairAction: "created",
        liveTxt: null,
        doctorMode: false,
      }),
      true,
    );
    assert.equal(
      shouldAutofixMcpTxtMismatch({
        keypairAction: "created",
        liveTxt: "v=MCPv1; k=ed25519; p=old-key",
        doctorMode: false,
      }),
      false,
    );
    assert.equal(
      shouldAutofixMcpTxtMismatch({
        keypairAction: "kept",
        liveTxt: "v=MCPv1; k=ed25519; p=old-key",
        doctorMode: false,
      }),
      false,
    );
    assert.equal(
      shouldAutofixMcpTxtMismatch({
        keypairAction: "rotated",
        liveTxt: "v=MCPv1; k=ed25519; p=old-key",
        doctorMode: true,
      }),
      false,
    );
  });
});
