import { useCallback, useEffect, useRef, useState } from "react";
import { applyIncomingFirehoseSignal, flushPendingFirehoseSignals } from "./feed-model";
import {
  buildPublicFirehoseSearchParams,
  isPublicFirehoseEvent,
  listPublicFirehoseSignals,
  type PublicFirehoseLiveState,
  type PublicFirehoseSignal,
  type PublicFirehoseSnapshot,
} from "./public-feed";
import { chooseFirehoseLiveTransport, readFirehoseConnectionHints } from "./transport";
import { LIVE_SOCKET_PROTOCOL } from "./firehose-feed-page-utils";

interface FirehoseLiveSnapshotState {
  pendingSignals: PublicFirehoseSignal[];
  snapshot: PublicFirehoseSnapshot;
}

export interface FirehoseLiveResult {
  applyPendingSignals: () => void;
  liveState: PublicFirehoseLiveState;
  pendingSignalCount: number;
  refreshSignals: () => void;
  setReadingLatest: (readingLatest: boolean) => void;
  snapshot: PublicFirehoseSnapshot;
}

interface LiveFailureState {
  sse: number;
  websocket: number;
}

function transportUrl(pathname: string, snapshot: PublicFirehoseSnapshot): string {
  const params = buildPublicFirehoseSearchParams(snapshot.query);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `${pathname}${suffix}`;
}

function websocketUrl(snapshot: PublicFirehoseSnapshot): string {
  const basePath = transportUrl("/api/firehose/public/socket", snapshot);
  if (typeof window === "undefined") {
    return basePath;
  }
  const url = new URL(basePath, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function snapshotWithSignals(
  snapshot: PublicFirehoseSnapshot,
  signals: PublicFirehoseSignal[],
): PublicFirehoseSnapshot {
  return {
    ...snapshot,
    signals,
    summary: {
      latest_detected_at: signals[0]?.detected_at ?? null,
      total_signals: signals.length,
      visible_signals: signals.length,
    },
  };
}

export function usePublicFirehoseLive(initialSnapshot: PublicFirehoseSnapshot): FirehoseLiveResult {
  const [streamState, setStreamState] = useState<FirehoseLiveSnapshotState>(() => ({
    pendingSignals: [],
    snapshot: initialSnapshot,
  }));
  const [liveState, setLiveState] = useState<PublicFirehoseLiveState>("updated-manually");
  const [failures, setFailures] = useState<LiveFailureState>({ sse: 0, websocket: 0 });
  const readingLatestRef = useRef(true);

  const applyLiveSignal = useCallback((incomingSignal: PublicFirehoseSignal) => {
    setStreamState((current) => {
      const nextSignals = applyIncomingFirehoseSignal(
        {
          pendingSignals: current.pendingSignals,
          signals: current.snapshot.signals,
        },
        incomingSignal,
        readingLatestRef.current,
      );
      return {
        pendingSignals: nextSignals.pendingSignals,
        snapshot: snapshotWithSignals(current.snapshot, nextSignals.signals),
      };
    });
  }, []);

  const applyPendingSignals = useCallback(() => {
    setStreamState((current) => {
      const nextSignals = flushPendingFirehoseSignals({
        pendingSignals: current.pendingSignals,
        signals: current.snapshot.signals,
      });
      return {
        pendingSignals: nextSignals.pendingSignals,
        snapshot: snapshotWithSignals(current.snapshot, nextSignals.signals),
      };
    });
    readingLatestRef.current = true;
  }, []);

  const refreshSignals = useCallback(() => {
    setStreamState({
      pendingSignals: [],
      snapshot: listPublicFirehoseSignals(initialSnapshot.query),
    });
    readingLatestRef.current = true;
    setLiveState("updated-manually");
  }, [initialSnapshot]);

  const setReadingLatest = useCallback((readingLatest: boolean) => {
    readingLatestRef.current = readingLatest;
  }, []);

  useEffect(() => {
    setStreamState({
      pendingSignals: [],
      snapshot: initialSnapshot,
    });
  }, [initialSnapshot]);

  useEffect(() => {
    const hints = readFirehoseConnectionHints();
    const transport = chooseFirehoseLiveTransport({
      ...hints,
      recentSseFailures: failures.sse,
      recentWebSocketFailures: failures.websocket,
    });
    if (transport === "paused") {
      setLiveState("offline");
      return undefined;
    }

    if (transport === "websocket" && typeof window.WebSocket !== "undefined") {
      setLiveState("reconnecting");
      const socket = new WebSocket(websocketUrl(initialSnapshot), LIVE_SOCKET_PROTOCOL);
      socket.addEventListener("open", () => {
        setLiveState("live");
      });
      socket.addEventListener("message", (message: MessageEvent<string>) => {
        const parsed: unknown = JSON.parse(message.data);
        if (!isPublicFirehoseEvent(parsed) || parsed.type !== "firehose.signal") {
          return;
        }
        applyLiveSignal(parsed.signal);
      });
      socket.addEventListener("close", () => {
        setLiveState("reconnecting");
        setFailures((current) => ({ ...current, websocket: current.websocket + 1 }));
      });
      socket.addEventListener("error", () => {
        setLiveState("reconnecting");
        setFailures((current) => ({ ...current, websocket: current.websocket + 1 }));
      });
      return () => {
        socket.close();
      };
    }

    if (transport === "sse" && typeof window.EventSource !== "undefined") {
      setLiveState("reconnecting");
      const source = new EventSource(transportUrl("/api/firehose/public/events", initialSnapshot));
      source.addEventListener("open", () => {
        setLiveState("live");
      });
      source.addEventListener("firehose.signal", (event) => {
        const message = event as MessageEvent<string>;
        const parsed: unknown = JSON.parse(message.data);
        if (!isPublicFirehoseEvent(parsed) || parsed.type !== "firehose.signal") {
          return;
        }
        applyLiveSignal(parsed.signal);
      });
      source.addEventListener("error", () => {
        setLiveState("reconnecting");
        setFailures((current) => ({ ...current, sse: current.sse + 1 }));
      });
      return () => {
        source.close();
      };
    }

    const interval = window.setInterval(() => {
      refreshSignals();
    }, 30000);
    return () => {
      window.clearInterval(interval);
    };
  }, [applyLiveSignal, failures.sse, failures.websocket, initialSnapshot, refreshSignals]);

  return {
    applyPendingSignals,
    liveState,
    pendingSignalCount: streamState.pendingSignals.length,
    refreshSignals,
    setReadingLatest,
    snapshot: streamState.snapshot,
  };
}
