import { useEffect, useRef, type ReactNode } from "react";
import { editorialTitleClass } from "@rebuildingamerica/atlas-ui/styles/typography";

interface PurchaseFlowProps {
  header: ReactNode;
  children: ReactNode;
  action: ReactNode;
}

export const purchaseFlowLayoutClass =
  "flex w-full flex-1 flex-col gap-8 lg:grid lg:grid-cols-2 lg:gap-16";
interface PurchaseFlowSlotProps {
  children: ReactNode;
}

export function PurchaseFlowContent({ children }: PurchaseFlowSlotProps) {
  return <div className="flex flex-1 flex-col gap-8">{children}</div>;
}
export function PurchaseFlowAction({ children }: PurchaseFlowSlotProps) {
  return (
    <section aria-label="Next step" className="mt-auto space-y-4">
      {children}
    </section>
  );
}
/** Keep plan context, decisions and the next action in the same places across signup. */
export function PurchaseFlow({ header, children, action }: PurchaseFlowProps) {
  return (
    <div className={purchaseFlowLayoutClass}>
      {header}
      <PurchaseFlowContent>
        {children}
        <PurchaseFlowAction>{action}</PurchaseFlowAction>
      </PurchaseFlowContent>
    </div>
  );
}

interface PurchaseFlowHeadingProps {
  productLabel: string;
  title: string;
  description: string;
}

export function PurchaseFlowHeading({
  productLabel,
  title,
  description,
}: PurchaseFlowHeadingProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  return (
    <header className="space-y-6">
      <p className="type-label-large text-ink-soft">{productLabel}</p>
      <h1 ref={heading} tabIndex={-1} className={editorialTitleClass}>
        {title}
      </h1>
      <p className="type-body-large text-ink-soft">{description}</p>
    </header>
  );
}
