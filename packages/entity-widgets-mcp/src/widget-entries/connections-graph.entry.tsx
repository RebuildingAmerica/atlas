import { createRoot } from "react-dom/client";
import {
  ConnectionsGraph,
  WidgetStatus,
} from "@rebuildingamerica/entity-widgets";
import { useConnectionsData } from "../adapters/app-client";
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
