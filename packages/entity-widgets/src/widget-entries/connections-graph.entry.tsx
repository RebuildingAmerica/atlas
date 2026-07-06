import { createRoot } from "react-dom/client";
import { ConnectionsGraph } from "../components/connections-graph/connections-graph";
import { useConnectionsData } from "../adapters/app-client";
import { WidgetStatus } from "../lib/widget-status";
import "../styles/widget.css";

function ConnectionsWidget() {
  const state = useConnectionsData();
  return (
    <WidgetStatus
      state={state}
      errorMessage="Something went wrong loading these connections."
    >
      {(data) => (
        <ConnectionsGraph
          data={data}
          onLoadMore={state.loadMore}
          isLoadingMore={state.isLoadingMore}
        />
      )}
    </WidgetStatus>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "connections-graph widget: #root element not found in connections-graph.html",
  );
}

createRoot(rootElement).render(<ConnectionsWidget />);
