export type FirehoseEffectiveConnectionType = "slow-2g" | "2g" | "3g" | "4g" | "unknown";
export type FirehoseLiveTransport = "websocket" | "sse" | "polling" | "paused";

export interface FirehoseLiveTransportInput {
  effectiveType: FirehoseEffectiveConnectionType;
  online: boolean;
  recentSseFailures: number;
  recentWebSocketFailures: number;
  saveData: boolean;
  supportsEventSource: boolean;
  supportsWebSocket: boolean;
}

export interface FirehoseConnectionHints {
  effectiveType: FirehoseEffectiveConnectionType;
  online: boolean;
  saveData: boolean;
  supportsEventSource: boolean;
  supportsWebSocket: boolean;
}

interface NavigatorConnectionLike {
  effectiveType?: string;
  saveData?: boolean;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NavigatorConnectionLike;
}

function normalizeEffectiveType(value: string | undefined): FirehoseEffectiveConnectionType {
  if (value === "slow-2g" || value === "2g" || value === "3g" || value === "4g") {
    return value;
  }
  return "unknown";
}

export function readFirehoseConnectionHints(): FirehoseConnectionHints {
  if (typeof window === "undefined") {
    return {
      effectiveType: "unknown",
      online: true,
      saveData: false,
      supportsEventSource: false,
      supportsWebSocket: false,
    };
  }

  const navigatorWithConnection = window.navigator as NavigatorWithConnection;
  return {
    effectiveType: normalizeEffectiveType(navigatorWithConnection.connection?.effectiveType),
    online: window.navigator.onLine,
    saveData: navigatorWithConnection.connection?.saveData ?? false,
    supportsEventSource: "EventSource" in window,
    supportsWebSocket: "WebSocket" in window,
  };
}

export function chooseFirehoseLiveTransport(
  input: FirehoseLiveTransportInput,
): FirehoseLiveTransport {
  if (!input.online) {
    return "paused";
  }

  if (input.recentWebSocketFailures >= 2 && input.recentSseFailures >= 2) {
    return "polling";
  }

  const constrainedConnection =
    input.saveData || input.effectiveType === "slow-2g" || input.effectiveType === "2g";
  if (input.supportsEventSource && (constrainedConnection || input.recentWebSocketFailures >= 2)) {
    return "sse";
  }

  if (input.supportsWebSocket && !constrainedConnection) {
    return "websocket";
  }

  if (input.supportsEventSource) {
    return "sse";
  }

  return "polling";
}
