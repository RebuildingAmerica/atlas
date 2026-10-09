import type { ReactNode } from "react";
import { editorialTitleClass } from "@rebuildingamerica/atlas-ui/styles/typography";

export function PurchaseStepPanel({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h1 className={editorialTitleClass}>{title}</h1>
        <p className="type-body-large text-ink-soft">{description}</p>
      </div>
      {children}
    </section>
  );
}
