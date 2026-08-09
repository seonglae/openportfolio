// Shared convex-test bootstrap. Named with two dots on purpose: the Convex
// bundler skips any filename containing more than one dot, so this never gets
// pushed to the deployment (a plain `setup.ts` here is pushed and dies on
// `import.meta.glob`). Vitest's include is `test/**/*.test.ts`, so it is not
// collected as a test file either.

import { convexTest } from "convex-test";
import schema from "../schema";
import { hashServiceKey } from "../auth";
import type { Id } from "../_generated/dataModel";
import type { MemberRole } from "@openportfolio/domain";

// Typed inline rather than through vite/client: vite is a browser-only
// devDependency and does not resolve from convex/. The glob is resolved
// relative to this file, which is why it has to live inside convex/.
const modules = (import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }).glob(
  "../**/*.ts",
);

export const withConvex = () => convexTest(schema, modules);

export type Harness = ReturnType<typeof withConvex>;

export type SeededTenant = {
  tenantId: Id<"tenants">;
  slug: string;
  serviceKey: string;
};

// Seeds through raw db access rather than through `tenants:create`, so a test
// of the gate is not standing on the gate.
export async function seedTenant(
  t: Harness,
  slug: string,
  opts: { baseCurrency?: string; members?: Array<{ userId: string; role: MemberRole }>; keyRole?: MemberRole } = {},
): Promise<SeededTenant> {
  const serviceKey = `key-${slug}-000000000000000000000000000000`;
  const keyHash = await hashServiceKey(serviceKey);
  const tenantId = await t.run(async (ctx) => {
    const now = 1_700_000_000_000;
    const id = await ctx.db.insert("tenants", {
      slug,
      name: slug,
      baseCurrency: opts.baseCurrency ?? "USD",
      createdAt: now,
      updatedAt: now,
    });
    for (const member of opts.members ?? []) {
      await ctx.db.insert("memberships", { tenantId: id, userId: member.userId, role: member.role, createdAt: now });
    }
    await ctx.db.insert("serviceKeys", {
      tenantId: id,
      keyHash,
      label: `${slug}-worker`,
      role: opts.keyRole ?? "member",
      createdAt: now,
    });
    return id;
  });
  return { tenantId, slug, serviceKey };
}
