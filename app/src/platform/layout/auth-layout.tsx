import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AuthBrandHeader, AuthBrandPanel } from "./auth-brand-panel";

interface AuthFlowLayoutProps {
  children: ReactNode;
}

/**
 * Split brand + form layout for auth pages.
 *
 * Desktop: brand panel on the left (~40%), form content on the right (~60%).
 * Mobile: compact brand header at the top, form content below.
 */
export function AuthFlowLayout({ children }: AuthFlowLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Mobile brand header */}
      <div className="lg:hidden">
        <AuthBrandHeader />
      </div>

      {/* Desktop brand panel */}
      <div className="hidden lg:block lg:w-2/5">
        <AuthBrandPanel />
      </div>

      {/* Form content */}
      <div className="bg-surface flex flex-1 flex-col lg:w-3/5">
        <div className="flex flex-1 items-center justify-center px-6 py-12 lg:px-12">
          <div className="w-full max-w-xl">{children}</div>
        </div>

        <div className="px-6 pb-8 text-center">
          <Link to="/" className="type-body-medium text-ink-muted hover:text-ink">
            Back to Atlas
          </Link>
        </div>
      </div>
    </div>
  );
}
