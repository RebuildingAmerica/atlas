export interface AccountTab {
  id: string;
  label: string;
}

interface AccountTabsProps {
  tabs: AccountTab[];
}

export function AccountTabs({ tabs }: AccountTabsProps) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Account settings"
      className="border-border bg-surface/95 sticky top-0 z-20 -mx-4 overflow-x-auto border-b px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            href={`#${tab.id}`}
            className="type-label-large text-ink-soft hover:bg-surface-container hover:text-ink-strong focus-visible:ring-civic rounded-full px-3 py-2 no-underline transition-[background-color,color] duration-150 outline-none focus-visible:ring-2"
          >
            {tab.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
