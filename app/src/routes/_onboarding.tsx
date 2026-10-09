import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { controlFocusClass } from "@rebuildingamerica/atlas-ui/styles/controls";

export const Route = createFileRoute("/_onboarding")({
  head: () => ({
    meta: [
      { title: "Set up Atlas" },
      { name: "description", content: "Set up your Atlas workspace." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: SetupLayout,
});

function SetupLayout() {
  return (
    <div className="bg-surface flex min-h-dvh flex-col">
      <header className="border-outline-variant bg-surface border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-2 sm:px-10 lg:px-16">
          <Link
            to="/"
            className={`type-label-large text-ink-strong hover:text-accent-deep inline-flex min-h-11 min-w-11 touch-manipulation items-center rounded-sm underline-offset-4 hover:underline ${controlFocusClass}`}
          >
            Atlas
          </Link>
          <Link
            to="/pricing"
            className={`type-label-medium text-ink-soft hover:text-ink-strong inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-end rounded-sm underline-offset-4 hover:underline ${controlFocusClass}`}
          >
            Pricing
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pt-12 pb-[calc(var(--spacing)*8+env(safe-area-inset-bottom))] sm:px-10 sm:pt-16 lg:px-16">
        <Outlet />
      </main>
    </div>
  );
}
