import type { ReactNode } from "react";

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
        <h1 className="text-ink-strong font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">
          {title}
        </h1>
        <p className="type-body-large text-ink-soft">{description}</p>
      </div>
      {children}
    </section>
  );
}
