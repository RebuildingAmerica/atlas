import { createRoot } from "react-dom/client";
import {
  SearchResultsList,
  WidgetStatus,
} from "@rebuildingamerica/entity-widgets";
import { useSearchResultsData } from "../adapters/app-client";
import "../styles/widget.css";

function SearchResultsWidget() {
  const state = useSearchResultsData();
  return (
    <WidgetStatus
      state={state}
      errorMessage="Something went wrong loading these results."
    >
      {(data) => (
        <SearchResultsList
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
    "search-results widget: #root element not found in search-results.html",
  );
}

createRoot(rootElement).render(<SearchResultsWidget />);
