import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatExistingPublisherKeypairPromptMessage,
  formatMcpTxtUpdatePromptMessage,
} from "./mcp-registry.js";

void describe("MCP Registry prompt guidance", () => {
  void it("explains the publisher keypair keep-or-rotate decision", () => {
    const message = formatExistingPublisherKeypairPromptMessage();

    assert.match(message, /found a local publisher keypair/);
    assert.match(message, /Rotate only if/);
    assert.match(message, /requires updating the Cloudflare TXT proof/);
  });

  void it("explains the DNS proof update options", () => {
    const message = formatMcpTxtUpdatePromptMessage();

    assert.match(message, /MCPv1 TXT record/);
    assert.match(message, /Choose Cloudflare API/);
    assert.match(message, /wait for DNS and verify/);
  });
});
