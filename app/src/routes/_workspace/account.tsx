import { createFileRoute, redirect } from "@tanstack/react-router";
import { AccountPage } from "@/domains/access";

export const Route = createFileRoute("/_workspace/account")({
  beforeLoad: ({ context }) => {
    const session = (context as { session?: { isLocal?: boolean } }).session;
    if (session?.isLocal) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect pattern
      throw redirect({ to: "/discovery" });
    }
  },
  component: AccountPage,
});
