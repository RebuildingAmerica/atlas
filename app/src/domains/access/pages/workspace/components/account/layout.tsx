import type { ReactNode } from "react";
import { AccountNotice } from "./notice";
import { AccountTabs, type AccountTab } from "./tabs";

interface AccountLayoutProps {
  children: ReactNode;
  email: string | undefined;
  errorMessage: string | null;
  flashMessage: string | null;
  name: string | null | undefined;
  tabs: AccountTab[];
}

export function AccountLayout({
  children,
  email,
  errorMessage,
  flashMessage,
  name,
  tabs,
}: AccountLayoutProps) {
  const nameText = name?.trim() || null;
  const visibleIdentity = nameText || email || null;
  const avatarInitial = (visibleIdentity ?? "A").trim().charAt(0).toUpperCase() || "A";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="border-border flex flex-wrap items-end justify-between gap-5 border-b pb-6">
        <div className="min-w-0">
          <h1 className="type-display-small text-ink-strong">Account</h1>
        </div>

        {visibleIdentity ? (
          <div className="border-border bg-surface-container-lowest flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="bg-civic text-surface flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
              {avatarInitial}
            </div>
            <div className="min-w-0">
              {nameText ? (
                <p className="type-title-small text-ink-strong truncate">{nameText}</p>
              ) : null}
              {email ? <p className="type-body-small text-ink-soft truncate">{email}</p> : null}
            </div>
          </div>
        ) : null}
      </header>

      <AccountTabs tabs={tabs} />

      <div className="mt-8 space-y-10">
        {flashMessage ? <AccountNotice tone="success">{flashMessage}</AccountNotice> : null}
        {errorMessage ? <AccountNotice tone="error">{errorMessage}</AccountNotice> : null}
        {children}
      </div>
    </div>
  );
}
