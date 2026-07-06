import { createRoot } from "react-dom/client";
import { SearchResultsList } from "../components/search-results-list/search-results-list";
import { useSearchResultsData } from "../adapters/app-client";
import "../styles/widget.css";

function SearchResultsWidget() {
  const { data, error, loadMore, isLoadingMore } = useSearchResultsData();

  if (error) {
    // Never surface `error.message`/details in the UI — log the real error
    // for diagnostics and show a safe, generic message instead.
    console.error(error);
    return (
      <p className="text-ew-ink-soft p-4 text-sm">
        Something went wrong loading these results.
      </p>
    );
  }

  if (!data) {
    return <p className="text-ew-ink-soft p-4 text-sm">Loading…</p>;
  }

  return (
    <SearchResultsList
      data={data}
      onLoadMore={loadMore}
      isLoadingMore={isLoadingMore}
    />
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "search-results widget: #root element not found in search-results.html",
  );
}

createRoot(rootElement).render(<SearchResultsWidget />);
