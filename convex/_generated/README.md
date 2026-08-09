# convex/\_generated

Codegen output, committed on purpose.

`npx convex dev` writes these files from `schema.ts` and the module list in this
directory. They are tracked in git so that a fresh checkout typechecks and CI
runs without a Convex deployment or an account: nothing here depends on the
deployment, only on the schema and the file names.

That has one consequence worth knowing. `api.d.ts` lists the modules by hand
because codegen lists them by hand too. Adding a file to `convex/` without
re-running `npx convex dev` leaves it out of `api` and `internal`, and the
reference will not typecheck. Re-run codegen rather than editing the list:

```bash
npx convex dev --once
```

Never hand-edit anything in this directory.
