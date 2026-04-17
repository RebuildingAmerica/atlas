import type { ReactNode } from "react";

interface PageLayoutProps {
  children: ReactNode;
  className?: string;
}

export function PageLayout({ children, className }: PageLayoutProps) {
  return (
    <div className={`mx-auto w-full max-w-[88rem] flex-1 px-6 py-8 ${className || ""}`}>
      {children}
    </div>
  );
}
