import type { ReactNode } from "react";
import { editorialTitleClass } from "@rebuildingamerica/atlas-ui/styles/typography";

export function PurchaseStepPanel({
  children,
  description,
  productLabel,
  title,
}: {
  children: ReactNode;
  description: string;
  productLabel?: string;
  title: string;
}) {
  return (
    <section className="w-full max-w-lg space-y-6">
      <div className="space-y-3">
        {productLabel ? <p className="type-label-large text-ink-soft">{productLabel}</p> : null}
        <h1 className={editorialTitleClass}>{title}</h1>
        <p className="type-body-large text-ink-soft">{description}</p>
      </div>
      {children}
    </section>
  );
}
