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
    <div className="bg-surface flex min-h-dvh flex-col">
      <header className="border-outline-variant bg-surface border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 sm:px-10 lg:px-16">
          <Link to="/" className="type-label-large text-on-surface no-underline">
            Atlas
          </Link>
          <Link to="/pricing" className="type-label-medium text-outline hover:text-on-surface">
            Pricing
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pt-12 pb-8 sm:px-10 sm:pt-16 lg:px-16">
        <Outlet />
      </main>
    </div>
  );
}
