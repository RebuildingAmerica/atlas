import { usePublicFirehoseLive } from "./firehose-feed-page-live";
import { FirehoseFeedView } from "./firehose-feed-page-view";
import type { PublicFirehoseSnapshot } from "./public-feed";

interface FirehoseFeedPageProps {
  initialSnapshot: PublicFirehoseSnapshot;
}

export { FirehoseFeedView } from "./firehose-feed-page-view";

export function FirehoseFeedPage({ initialSnapshot }: FirehoseFeedPageProps) {
  const live = usePublicFirehoseLive(initialSnapshot);
  return (
    <FirehoseFeedView
      liveState={live.liveState}
      onApplyPendingSignals={live.applyPendingSignals}
      onReadingLatestChange={live.setReadingLatest}
      onRefreshSignals={live.refreshSignals}
      pendingSignalCount={live.pendingSignalCount}
      snapshot={live.snapshot}
    />
  );
}
