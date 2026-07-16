import type { ReactNode } from "react";

export interface AuthFlowFrameProps {
  children: ReactNode;
  desktopBrand: ReactNode;
  footer: ReactNode;
  mobileBrand: ReactNode;
}

/**
 * Responsive auth-frame presentation. Application routing, brand content,
 * and legal destinations are supplied as slots by the host application.
 */
export function AuthFlowFrame({
  children,
  desktopBrand,
  footer,
  mobileBrand,
}: AuthFlowFrameProps) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="lg:hidden">{mobileBrand}</div>
      <div className="hidden lg:block lg:w-2/5">{desktopBrand}</div>
      <div className="bg-surface flex flex-1 flex-col lg:w-3/5">
        <main className="flex flex-1 items-start justify-center px-6 pt-16 pb-12 sm:pt-20 lg:px-12 lg:pt-32 lg:pb-16">
          <div className="w-full max-w-[30rem]">{children}</div>
        </main>
        <div className="flex items-center justify-center gap-4 px-6 pb-8">{footer}</div>
      </div>
    </div>
  );
}
