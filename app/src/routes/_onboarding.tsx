import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

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
    <div className="bg-surface flex min-h-screen flex-col">
      <header className="border-outline-variant bg-surface-container-lowest/90 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="type-label-large text-on-surface no-underline">
            Atlas
          </Link>
          <Link to="/pricing" className="type-label-medium text-outline hover:text-on-surface">
            Pricing
          </Link>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="w-full max-w-6xl">
          <Outlet />
        </div>
      </main>

      <footer className="flex items-center justify-center gap-4 px-6 pb-8">
        <Link to="/privacy" className="type-body-small text-ink-muted hover:text-ink">
          Privacy policy
        </Link>
        <span className="text-ink-muted text-xs">·</span>
        <Link to="/terms" className="type-body-small text-ink-muted hover:text-ink">
          Terms of service
        </Link>
      </footer>
    </div>
  );
}
