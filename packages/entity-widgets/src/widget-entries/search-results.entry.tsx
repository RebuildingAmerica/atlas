import { createRoot } from "react-dom/client";
import { SearchResultsList } from "../components/search-results-list/search-results-list";
import { useSearchResultsData } from "../adapters/app-client";
import { WidgetStatus } from "../lib/widget-status";
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
