import { createRoot } from "react-dom/client";
import { ConnectionsGraph } from "../components/connections-graph/connections-graph";
import { useConnectionsData } from "../adapters/app-client";
import "../styles/widget.css";

function ConnectionsWidget() {
  const { data, error, loadMore, isLoadingMore } = useConnectionsData();

  if (error) {
    // Never surface `error.message`/details in the UI — log the real error
    // for diagnostics and show a safe, generic message instead.
    console.error(error);
    return (
      <p className="text-ew-ink-soft p-4 text-sm">
        Something went wrong loading these connections.
      </p>
    );
  }

  if (!data) {
    return <p className="text-ew-ink-soft p-4 text-sm">Loading…</p>;
  }

  return (
    <ConnectionsGraph
      data={data}
      onLoadMore={loadMore}
      isLoadingMore={isLoadingMore}
    />
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "connections-graph widget: #root element not found in connections-graph.html",
  );
}

createRoot(rootElement).render(<ConnectionsWidget />);
