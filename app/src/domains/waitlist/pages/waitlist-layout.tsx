import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonStyles } from "@rebuildingamerica/atlas-ui/ui/button";
import {
  controlFocusClass,
  disclosureSummaryClass,
} from "@rebuildingamerica/atlas-ui/styles/controls";
import { editorialTitleClass } from "@rebuildingamerica/atlas-ui/styles/typography";

interface WaitlistLayoutProps {
  children: ReactNode;
  wide?: boolean;
}
export function WaitlistLayout({ children, wide = false }: WaitlistLayoutProps) {
  return (
    <div className={cn("flex w-full max-w-lg flex-1 flex-col gap-8", wide && "lg:max-w-none")}>
      {children}
    </div>
  );
}
export const waitlistSecondaryActionClass = `type-label-medium text-ink-soft hover:text-ink-strong inline-flex min-h-11 items-center gap-2 rounded-sm hover:underline ${controlFocusClass}`;
export const waitlistHeadingClass = editorialTitleClass;
export const waitlistTextLinkClass = `type-label-large text-accent-deep hover:text-ink-strong inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 ${controlFocusClass}`;
export const waitlistPrimaryLinkClass = `${buttonStyles({ size: "lg" })} text-center`;
export const waitlistSummaryClass = disclosureSummaryClass;
export function WaitlistError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="type-body-medium text-ink-strong break-words">
      {message}
    </p>
  ) : null;
}
