// Empty when CLERK_ISSUER_URL is unset so a fresh checkout still deploys. With
// no provider configured there are no identities, which is why the dev tenant
// escape hatch exists and why it is off by default.
export default {
  providers: [
    {
      domain: process.env.CLERK_ISSUER_URL ?? "",
      applicationID: "convex",
    },
  ],
};
