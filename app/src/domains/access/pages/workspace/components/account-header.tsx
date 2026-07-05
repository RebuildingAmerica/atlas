interface AccountHeaderProps {
  email: string | undefined;
  name: string | null | undefined;
}

export function AccountHeader({ email, name }: AccountHeaderProps) {
  const nameText = name?.trim() || null;
  const visibleIdentity = nameText || email || null;
  const avatarInitial = (visibleIdentity ?? "A").trim().charAt(0).toUpperCase() || "A";

  return (
    <section id="profile" className="scroll-mt-24">
      <div className="border-border flex flex-wrap items-end justify-between gap-5 border-b pb-6">
        <div className="min-w-0">
          <h1 className="type-display-small text-ink-strong">Account</h1>
        </div>

        {visibleIdentity ? (
          <div className="bg-surface-container-lowest flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-black/5">
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
      </div>
    </section>
  );
}
