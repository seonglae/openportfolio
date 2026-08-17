import { useState } from "react";
import type { ReactNode } from "react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, Unauthenticated, useConvexAuth } from "convex/react";
import type { ConvexReactClient } from "convex/react";

import { Mark } from "./Mark.tsx";

/**
 * Sign-in, running inside this deployment and nowhere else.
 *
 * This was Clerk for about an hour, and Clerk was the wrong answer: a tool whose
 * first line is that it holds no provider key and has no hosted tier cannot
 * require an account with an auth company to log into your own portfolio. That
 * is one more firm between you and your book, one more signup, one more thing
 * that can start charging or go away. Convex Auth's Password provider needs no
 * external service: your deployment mints and verifies its own tokens, and a
 * sign-in never leaves it.
 *
 * The backend gate did not change. convex/auth.ts reads identity through
 * `ctx.auth.getUserIdentity()`, which this populates the same way any provider
 * would, so the tenancy rules are exactly the ones that were already tested.
 *
 * Still conditional, for the same reason as before. With no auth configured the
 * plain provider is used and OPENPORTFOLIO_DEV_TENANT carries a fresh localhost
 * checkout, so `convex dev` + `vite` works with nothing to set up. The
 * difference from the Clerk version is that turning auth ON now costs nothing
 * either: there is no key to go and fetch, so a deployment is private by default
 * rather than private if you bothered.
 */
type Props = { client: ConvexReactClient; children: ReactNode };

// Opt out only. Auth is on unless a deployment says otherwise, because the
// alternative default is a public net worth.
const DISABLED = import.meta.env.VITE_DISABLE_AUTH === "1";

export function authEnabled(): boolean {
  return !DISABLED;
}

const FIELD =
  "w-full rounded-lg border border-rule bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3";
const FLOW_LABEL: Record<Flow, string> = { signIn: "Sign in", signUp: "Create account" };
const FLOW_SWITCH: Record<Flow, string> = {
  signIn: "First time here? Create the account that owns this deployment.",
  signUp: "Already have an account? Sign in.",
};
const OTHER: Record<Flow, Flow> = { signIn: "signUp", signUp: "signIn" };

type Flow = "signIn" | "signUp";

function SignInScreen(): React.ReactElement {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<Flow>("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const data = new FormData(event.currentTarget);
    data.set("flow", flow);
    try {
      await signIn("password", data);
    } catch (e) {
      // Convex Auth returns one opaque error for a bad password and for an
      // unknown account, which is correct: distinguishing them tells an attacker
      // which addresses exist. Say what the user can act on instead.
      setError(flow === "signIn" ? "Could not sign in with that email and password." : "Could not create that account.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[360px] flex-col items-center justify-center gap-6 px-6">
      <div className="flex items-center gap-3">
        <Mark />
        <span className="serif text-[25px] leading-none font-normal tracking-[-0.01em]">openportfolio</span>
      </div>
      <p className="text-center text-sm text-ink-3">
        Your book is private. This deployment holds its own accounts, so there is nothing to sign up
        for anywhere else.
      </p>
      <form className="flex w-full flex-col gap-3" onSubmit={submit}>
        <input className={FIELD} name="email" type="email" autoComplete="email" placeholder="Email" required />
        <input
          className={FIELD}
          name="password"
          type="password"
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
          placeholder="Password"
          required
        />
        <button
          className="glass rounded-lg px-3.5 py-2 text-sm font-medium text-ink disabled:opacity-60"
          type="submit"
          disabled={busy}
        >
          {FLOW_LABEL[flow]}
        </button>
      </form>
      {error === null ? null : <p className="text-center text-sm text-loss">{error}</p>}
      <button
        className="text-xs text-ink-3 underline decoration-rule underline-offset-4 hover:text-ink"
        type="button"
        onClick={() => {
          setFlow(OTHER[flow]);
          setError(null);
        }}
      >
        {FLOW_SWITCH[flow]}
      </button>
    </div>
  );
}

export function AuthProvider({ client, children }: Props): React.ReactElement {
  if (DISABLED) throw new Error("AuthProvider used while VITE_DISABLE_AUTH=1");
  return (
    <ConvexAuthProvider client={client}>
      <Authenticated>{children}</Authenticated>
      <Unauthenticated>
        <SignInScreen />
      </Unauthenticated>
    </ConvexAuthProvider>
  );
}

/** Sign-out control, rendered in the header only when auth is the access path. */
export function AuthButton(): React.ReactElement | null {
  const { signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  if (DISABLED || !isAuthenticated) return null;
  return (
    <button
      className="text-xs text-ink-3 hover:text-ink"
      type="button"
      onClick={() => {
        void signOut();
      }}
    >
      Sign out
    </button>
  );
}
