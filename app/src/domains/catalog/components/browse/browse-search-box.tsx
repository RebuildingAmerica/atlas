import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";

interface BrowseSearchBoxProps {
  initialQuery: string;
  onSearch: (query: string) => void;
  placeholder?: string;
}

/**
 * Keeps the browse search input locally editable while resetting cleanly when
 * the route search param changes. Submits on Enter — no separate button.
 */
export function BrowseSearchBox({
  initialQuery,
  onSearch,
  placeholder = "Try housing in Detroit",
}: BrowseSearchBoxProps) {
  const [queryDraft, setQueryDraft] = useState(initialQuery);
  const inputId = useId();

  useEffect(() => {
    setQueryDraft(initialQuery);
  }, [initialQuery]);

  return (
    <form
      className="bg-surface-container-lowest flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        const submittedValue = new FormData(event.currentTarget).get("browse-query");
        onSearch(typeof submittedValue === "string" ? submittedValue : queryDraft);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Search people and groups by issue, place, or name
      </label>
      <Search className="text-ink-muted h-4 w-4 shrink-0" />
      <input
        id={inputId}
        name="browse-query"
        value={queryDraft}
        onChange={(event) => {
          setQueryDraft(event.target.value);
        }}
        placeholder={placeholder}
        className="type-body-large text-ink-strong placeholder:text-ink-muted w-full bg-transparent outline-none"
      />
      <button
        type="submit"
        className="type-label-large bg-accent hover:bg-accent-deep shrink-0 rounded-full px-3 py-1 text-white transition-colors"
      >
        Search
      </button>
    </form>
  );
}
