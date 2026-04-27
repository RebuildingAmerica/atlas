import { Link, createFileRoute } from "@tanstack/react-router";

/**
 * Landing page Atlas advertises as the `post_logout_redirect_uri` when it
 * sends a user through the IdP's OIDC RP-Initiated Logout endpoint.  The
 * local session is already cleared by the time the IdP bounces the browser
 * back, so this page just confirms the flow finished and offers a way home.
 */
export const Route = createFileRoute("/_public/post-logout")({
  ssr: false,
  component: PostLogoutRoute,
});

function PostLogoutRoute() {
  return (
    <div className="space-y-6 py-12">
      <div className="space-y-3">
        <p className="type-label-medium text-outline">Signed out</p>
        <h1 className="type-display-small text-on-surface">You have signed out of Atlas.</h1>
        <p className="type-body-large text-outline">
          Your identity provider has also ended this session.
        </p>
      </div>

      <Link to="/" className="text-accent type-label-medium hover:underline">
        Back to Atlas &rarr;
      </Link>
    </div>
  );
}
