import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AuthFlowFrame } from "@rebuildingamerica/atlas-ui";
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
    <AuthFlowFrame
      desktopBrand={<AuthBrandPanel />}
      footer={<AuthFlowFooter />}
      mobileBrand={<AuthBrandHeader />}
    >
      {children}
    </AuthFlowFrame>
  );
}

function AuthFlowFooter() {
  return (
    <>
      <Link to="/privacy" className="type-body-small text-ink-muted hover:text-ink">
        Privacy policy
      </Link>
      <span className="text-ink-muted text-xs">·</span>
      <Link to="/terms" className="type-body-small text-ink-muted hover:text-ink">
        Terms of service
      </Link>
    </>
  );
}
