import { PlaceSection, PlaceSectionNav } from "./place-page";
import { SECTION_NAV_ITEMS } from "./place-page-utils";

const PLACEHOLDER_BLOCK = "bg-surface-container-lowest animate-pulse rounded-lg";

/** One key per slot in the summary strip, which fills five columns on a wide screen. */
const SUMMARY_FACT_PLACEHOLDERS = ["first", "second", "third", "fourth", "fifth"] as const;

/**
 * The place page's layout while its data is still on the way.
 *
 * It keeps every section and its heading where the real page puts them, so a
 * visitor can read the page's shape and use the section links while the API
 * recovers, and the content lands without the layout jumping.
 */
export function PlacePageSkeleton() {
  return (
    <main aria-busy="true" className="bg-page-bg text-ink-strong">
      <p role="status" className="sr-only">
        Loading this place
      </p>
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header aria-hidden="true" className="grid gap-5 lg:grid-cols-2">
          <div className="bg-surface-container-low rounded-2xl p-5 sm:p-7 lg:p-8">
            <div className={`${PLACEHOLDER_BLOCK} h-5 w-40`} />
            <div className={`${PLACEHOLDER_BLOCK} mt-4 h-12 w-3/4 sm:h-14`} />
            <div className={`${PLACEHOLDER_BLOCK} mt-6 h-8 w-2/3 rounded-full`} />
          </div>
          <div className="bg-surface-container-low min-h-48 animate-pulse rounded-2xl" />
        </header>

        <div aria-hidden="true" className="bg-surface-container mt-3 rounded-2xl p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {SUMMARY_FACT_PLACEHOLDERS.map((key) => (
              <div key={key} className={`${PLACEHOLDER_BLOCK} h-16`} />
            ))}
          </div>
        </div>

        <PlaceSectionNav label="Place sections" />

        <div className="mt-4 grid gap-5">
          {SECTION_NAV_ITEMS.map((item) => (
            <PlaceSection key={item.id} id={item.id} title={item.label}>
              <div aria-hidden="true" className="grid gap-3">
                <div className={`${PLACEHOLDER_BLOCK} h-20`} />
                <div className={`${PLACEHOLDER_BLOCK} h-20`} />
              </div>
            </PlaceSection>
          ))}
        </div>
      </div>
    </main>
  );
}
