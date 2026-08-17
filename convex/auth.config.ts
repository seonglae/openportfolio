// The issuer this deployment trusts, which is this deployment.
//
// Convex Auth signs its tokens with a key held by your own deployment, so the
// issuer is `CONVEX_SITE_URL` -- a variable Convex sets itself. There is no
// third-party domain to configure, no account to create, and nothing to keep in
// sync when you move deployments.
//
// It replaced `CLERK_ISSUER_URL`. Anyone upgrading can drop that variable:
// `npx convex env unset CLERK_ISSUER_URL`.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
