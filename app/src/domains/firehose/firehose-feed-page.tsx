import { useEffect, useMemo, useState } from "react";
import {
  buildPublicFirehoseSearchParams,
  isPublicFirehoseEvent,
  listPublicFirehoseSignals,
  mergePublicFirehoseSignal,
  type PublicFirehoseLiveState,
  type PublicFirehoseSignal,
  type PublicFirehoseSnapshot,
} from "./public-feed";
import { chooseFirehoseLiveTransport, readFirehoseConnectionHints } from "./transport";

interface FirehoseFeedPageProps {
  initialSnapshot: PublicFirehoseSnapshot;
}

interface FirehoseFeedViewProps {
  liveState: PublicFirehoseLiveState;
  snapshot: PublicFirehoseSnapshot;
}

interface FirehoseSignalRowProps {
  signal: PublicFirehoseSignal;
}

interface LiveFailureState {
  sse: number;
  websocket: number;
}

const LIVE_SOCKET_PROTOCOL = "atlas.firehose.public.v1";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
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

function usePublicFirehoseLive(initialSnapshot: PublicFirehoseSnapshot): {
  liveState: PublicFirehoseLiveState;
  snapshot: PublicFirehoseSnapshot;
} {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [liveState, setLiveState] = useState<PublicFirehoseLiveState>("updated-manually");
  const [failures, setFailures] = useState<LiveFailureState>({ sse: 0, websocket: 0 });

  useEffect(() => {
    setSnapshot(initialSnapshot);
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
        setSnapshot((current) =>
          snapshotWithSignals(current, mergePublicFirehoseSignal(current.signals, parsed.signal)),
        );
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
        setSnapshot((current) =>
          snapshotWithSignals(current, mergePublicFirehoseSignal(current.signals, parsed.signal)),
        );
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
      setSnapshot(listPublicFirehoseSignals(initialSnapshot.query));
      setLiveState("updated-manually");
    }, 30000);
    return () => {
      window.clearInterval(interval);
    };
  }, [failures.sse, failures.websocket, initialSnapshot]);

  return { liveState, snapshot };
}

function liveStateLabel(value: PublicFirehoseLiveState): string {
  if (value === "live") {
    return "Live";
  }
  if (value === "reconnecting") {
    return "Reconnecting";
  }
  if (value === "offline") {
    return "Offline";
  }
  return "Updated manually";
}

function signalTypeLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function FirehoseSignalRow({ signal }: FirehoseSignalRowProps) {
  const labels = useMemo(
    () => [
      ...signal.places.map((place) => place.label),
      ...signal.issues.map((issue) => issue.label),
    ],
    [signal.issues, signal.places],
  );

  return (
    <li className="border-outline-variant border-t py-6">
      <article className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <time className="type-label-small text-ink-muted" dateTime={signal.detected_at}>
          {formatTimestamp(signal.detected_at)}
        </time>
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="type-label-small text-accent">{signalTypeLabel(signal.signal_type)}</p>
            <h2 className="type-title-large text-ink-strong">{signal.title}</h2>
          </div>
          <p className="type-body-large text-ink-soft">{signal.summary}</p>
          <p className="type-body-small text-ink-muted border-outline-variant border-l pl-3">
            {signal.evidence.passage}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {labels.map((label) => (
              <span
                className="type-label-small bg-surface-container text-ink-soft rounded-full px-2 py-1"
                key={label}
              >
                {label}
              </span>
            ))}
          </div>
          <a
            className="type-label-medium text-ink-strong inline-flex underline underline-offset-4"
            href={signal.evidence.source_url}
            rel="noreferrer"
            target="_blank"
          >
            Open source
          </a>
        </div>
      </article>
    </li>
  );
}

export function FirehoseFeedView({ liveState, snapshot }: FirehoseFeedViewProps) {
  const rssParams = buildPublicFirehoseSearchParams(snapshot.query).toString();
  const rssHref = rssParams ? `/firehose.rss?${rssParams}` : "/firehose.rss";

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
      <header className="border-outline-variant space-y-4 border-b pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="type-display-small text-ink-strong">Firehose</h1>
          <span className="type-label-medium bg-surface-container text-ink-strong rounded-full px-3 py-1">
            {liveStateLabel(liveState)}
          </span>
        </div>
        <p className="type-body-large text-ink-soft">Latest source-backed public civic updates.</p>
        <a className="type-label-medium text-accent underline underline-offset-4" href={rssHref}>
          RSS feed
        </a>
      </header>

      {snapshot.signals.length === 0 ? (
        <p className="type-body-medium text-ink-strong py-8">No public signals listed.</p>
      ) : (
        <ol>
          {snapshot.signals.map((signal) => (
            <FirehoseSignalRow key={signal.id} signal={signal} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function FirehoseFeedPage({ initialSnapshot }: FirehoseFeedPageProps) {
  const live = usePublicFirehoseLive(initialSnapshot);
  return <FirehoseFeedView liveState={live.liveState} snapshot={live.snapshot} />;
}
