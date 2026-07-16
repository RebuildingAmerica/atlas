import { describe, expect, it } from "vitest";

describe("Firehose live transport policy", () => {
  it("uses WebSocket on a healthy normal browser connection", async () => {
    const { chooseFirehoseLiveTransport } = await import("./transport");

    expect(
      chooseFirehoseLiveTransport({
        effectiveType: "4g",
        online: true,
        recentSseFailures: 0,
        recentWebSocketFailures: 0,
        saveData: false,
        supportsEventSource: true,
        supportsWebSocket: true,
      }),
    ).toBe("websocket");
  });

  it("uses SSE when the user is saving data or WebSocket recently failed", async () => {
    const { chooseFirehoseLiveTransport } = await import("./transport");

    expect(
      chooseFirehoseLiveTransport({
        effectiveType: "4g",
        online: true,
        recentSseFailures: 0,
        recentWebSocketFailures: 2,
        saveData: false,
        supportsEventSource: true,
        supportsWebSocket: true,
      }),
    ).toBe("sse");
    expect(
      chooseFirehoseLiveTransport({
        effectiveType: "2g",
        online: true,
        recentSseFailures: 0,
        recentWebSocketFailures: 0,
        saveData: true,
        supportsEventSource: true,
        supportsWebSocket: true,
      }),
    ).toBe("sse");
  });

  it("falls back to polling or pauses when live transport cannot run", async () => {
    const { chooseFirehoseLiveTransport } = await import("./transport");

    expect(
      chooseFirehoseLiveTransport({
        effectiveType: "4g",
        online: true,
        recentSseFailures: 2,
        recentWebSocketFailures: 2,
        saveData: false,
        supportsEventSource: true,
        supportsWebSocket: true,
      }),
    ).toBe("polling");
    expect(
      chooseFirehoseLiveTransport({
        effectiveType: "4g",
        online: false,
        recentSseFailures: 0,
        recentWebSocketFailures: 0,
        saveData: false,
        supportsEventSource: true,
        supportsWebSocket: true,
      }),
    ).toBe("paused");
  });
});
