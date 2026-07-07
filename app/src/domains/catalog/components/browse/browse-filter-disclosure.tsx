import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface FilterDisclosureItem {
  active: boolean;
  icon?: LucideIcon;
  key: string;
  label: string;
  onClick: () => void;
}

interface FilterDisclosureProps {
  count: number;
  icon?: LucideIcon;
  items: FilterDisclosureItem[];
  label: string;
}

/**
 * Compact filter disclosure used in the browse header.
 */
export function FilterDisclosure({ count, icon: Icon, items, label }: FilterDisclosureProps) {
  return (
    <Popover className="relative lg:min-w-44 lg:flex-1">
      <PopoverButton className="bg-surface-container-lowest hover:bg-surface-container focus-visible:ring-accent flex w-full cursor-pointer items-center justify-between gap-3 rounded-[1rem] px-3 py-2 transition-colors outline-none focus-visible:ring-2">
        <span className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="text-ink-muted h-4 w-4 shrink-0" aria-hidden /> : null}
          <span className="type-label-large text-ink-strong truncate">{label}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="type-body-small text-ink-muted">
            {count > 0 ? `${count} selected` : "All"}
          </span>
          <ChevronDown className="text-ink-muted ui-open:rotate-180 h-3.5 w-3.5 transition-transform" />
        </span>
      </PopoverButton>

      <PopoverPanel
        transition
        anchor="bottom start"
        className="border-border bg-surface shadow-soft z-40 mt-2 w-72 origin-top rounded-2xl border p-3 transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {items.map((item) => {
            const ItemIcon = item.icon;

            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={item.active}
                onClick={item.onClick}
                className={[
                  "type-label-large inline-flex items-center gap-1.5 rounded-full py-1.5 pr-2.5 pl-2 transition-colors",
                  item.active
                    ? "bg-surface-container-highest text-accent-ink"
                    : "bg-surface-container-low text-ink-soft hover:bg-surface-container-high hover:text-ink-strong",
                ].join(" ")}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {ItemIcon ? <ItemIcon className="h-3.5 w-3.5" aria-hidden /> : null}
                </span>
                <span>{item.label}</span>
                {item.active ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </PopoverPanel>
    </Popover>
  );
}
