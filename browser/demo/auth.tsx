// Stands in for `src/Auth.tsx` in the demo build, via an alias in
// vite.demo.config.ts.
//
// The demo has no deployment to sign in to, so the point is not to render a
// signed-out state: it is to keep the auth module out of the bundle entirely.
// The real one imports `@convex-dev/auth/react`, which imports
// `ConvexProviderWithAuth` from `convex/react`, which the demo has already
// aliased to a fixture table that does not export it. Without this second alias
// the demo build fails on four missing exports it has no use for.
//
// This module is demo-only. Nothing in the shipped app imports it.

// App.tsx renders this in the header. There is nothing to sign out of.
export function AuthButton(): null {
  return null;
}
