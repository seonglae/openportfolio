import type { ReactNode } from "react";
import { ClerkProvider, Show, SignIn, UserButton, useAuth } from "@clerk/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ConvexReactClient } from "convex/react";

import { Mark } from "./Mark.tsx";

/**
 * Sign-in, and the reason it is optional.
 *
 * The backend has always had three ways to answer "whose book is this"
 * (convex/auth.ts): a service key, a Clerk identity, or OPENPORTFOLIO_DEV_TENANT.
 * Only the first and third were reachable, because the browser had no identity
 * provider at all. That made the app usable exactly one way -- on localhost with
 * the dev tenant set -- and it is why there was no honest one-click deploy: a
 * fresh deployment rendered a shell where every query threw "authentication
 * required", and the only way to make it work was to set the dev tenant on a
 * public URL, which scopes every anonymous visitor to the same book.
 *
 * So Clerk is wired here, and wired CONDITIONALLY. With
 * VITE_CLERK_PUBLISHABLE_KEY set the app requires a sign-in and Convex receives
 * a real identity. Without it, nothing changes from before: the plain provider
 * is used and the dev tenant carries a fresh checkout. That keeps
 * `convex dev` + `vite` working with zero auth setup, which is the whole point of
 * the escape hatch, while making a deployed instance private by construction
 * rather than by remembering to unset a variable.
 *
 * The two are not interchangeable and must not be silently confused, so the app
 * says which mode it is in.
 */
type Props = { client: ConvexReactClient; children: ReactNode };

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function clerkConfigured(): boolean {
  return typeof PUBLISHABLE_KEY === "string" && PUBLISHABLE_KEY.length > 0;
}

function SignInScreen(): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-screen max-w-[420px] flex-col items-center justify-center gap-6 px-6">
      <div className="flex items-center gap-3">
        <Mark />
        <span className="serif text-[25px] leading-none font-normal tracking-[-0.01em]">openportfolio</span>
      </div>
      <p className="text-center text-sm text-ink-3">Your book is private. Sign in to the deployment you own.</p>
      <SignIn routing="hash" />
    </div>
  );
}

/**
 * One component, not a SignedIn/SignedOut pair: @clerk/react 6 replaced both with
 * `Show`, which also returns null while auth is still loading, so the sign-in
 * screen cannot flash for a signed-in visitor on first paint.
 */
function Gate({ children }: { children: ReactNode }): ReactNode {
  return (
    <Show when="signed-in" fallback={<SignInScreen />}>
      {children}
    </Show>
  );
}

export function AuthProvider({ client, children }: Props): React.ReactElement {
  if (!clerkConfigured()) {
    // Caller renders the plain ConvexProvider in this case; see main.tsx. This
    // branch exists so a missing key is a loud programming error rather than a
    // ClerkProvider constructed with an empty string.
    throw new Error("AuthProvider used without VITE_CLERK_PUBLISHABLE_KEY");
  }
  // Telemetry off. Clerk's SDK reports usage from development instances by
  // default (its own postinstall says so), and a tool whose pitch is that it
  // holds no provider key and runs on your machine does not get to phone home
  // about your book on the way past.
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} telemetry={false}>
      <ConvexProviderWithClerk client={client} useAuth={useAuth}>
        <Gate>{children}</Gate>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

/** Sign-out control, rendered in the header only when Clerk is the auth path. */
export function AuthButton(): React.ReactElement | null {
  if (!clerkConfigured()) return null;
  return <UserButton />;
}
