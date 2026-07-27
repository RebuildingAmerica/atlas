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
      className="border-border-strong bg-surface-container-lowest flex min-w-0 flex-1 items-center border"
      onSubmit={(event) => {
        event.preventDefault();
        const submittedValue = new FormData(event.currentTarget).get("browse-query");
        /* v8 ignore next -- the draft arm only satisfies FormData's nullable type: this form always renders the browse-query input, so the field is always present and always text. */
        onSearch(typeof submittedValue === "string" ? submittedValue : queryDraft);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Search people and groups by issue, place, or name
      </label>
      <Search className="text-ink-muted ml-4 h-4 w-4 shrink-0" />
      <input
        id={inputId}
        name="browse-query"
        value={queryDraft}
        onChange={(event) => {
          setQueryDraft(event.target.value);
        }}
        placeholder={placeholder}
        className="type-body-medium text-ink-strong placeholder:text-ink-muted min-h-10 w-full bg-transparent px-3 outline-none"
      />
      <button
        type="submit"
        className="type-label-medium bg-ink-strong text-surface hover:bg-ink border-border-strong min-h-10 shrink-0 border-l px-4 transition-colors duration-150"
      >
        Search
      </button>
    </form>
  );
}
