// Sign-in, running inside this deployment and nowhere else.
//
// This used to be Clerk, and Clerk was the wrong answer for a tool whose first
// line is that it holds no provider key and has no hosted tier. Requiring an
// account with an auth SaaS to log into your own portfolio contradicts the
// premise: it is one more company between you and your book, one more signup,
// one more thing that can start charging. Convex Auth's Password provider needs
// no external service at all -- the deployment mints and verifies its own JWTs
// with a key `npx @convex-dev/auth` generates into your own deployment, and
// nothing about a sign-in leaves it.
//
// Named authProvider.ts rather than auth.ts because auth.ts is already the
// tenancy gate, and that gate is untouched by this: it reads identity through
// `ctx.auth.getUserIdentity()`, which Convex Auth populates the same way any
// provider would. The switch cost the gate nothing.
//
// Password only, deliberately. Magic links and OTP need an email service, which
// would put a third party back in the path for a deployment with exactly one
// user who already controls the machine. OAuth would put two there.
//
// Convex Auth is in beta upstream. That is a real caveat and it is in the docs
// rather than only here.
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
