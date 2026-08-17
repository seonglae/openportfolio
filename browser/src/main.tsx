import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App.tsx";
import { AuthProvider, authEnabled } from "./Auth.tsx";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL;

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

// Without a URL there is no backend to talk to, and every view would render an
// endless spinner. Say which variable is missing instead.
//
// Worth knowing when a bundle looks impossibly small: Vite inlines
// import.meta.env at build time, so building with VITE_CONVEX_URL unset makes
// this branch statically true and Rollup drops the whole else -- App, the
// providers, convex, all of it. The output is a page that can only print the
// message below, and the build still exits 0. That is fine for `vite dev` before
// you have configured anything, and not fine for a deployment, so vercel.json
// refuses to build without either a deploy key or a URL rather than shipping it.
if (!url) {
  root.textContent = "VITE_CONVEX_URL is not set. Copy browser/.env.local.example to browser/.env.local.";
} else {
  const client = new ConvexReactClient(url);

  // Two providers. The authenticated one is the default: sign-in runs inside
  // this deployment, so there is no key to fetch and no reason to make privacy
  // the opt-in. VITE_DISABLE_AUTH=1 selects the plain provider, which lets the
  // backend fall through to OPENPORTFOLIO_DEV_TENANT -- the localhost hatch that
  // makes `convex dev` + `vite` work on a fresh checkout. See Auth.tsx.
  function Shell(): React.ReactElement {
    if (authEnabled()) {
      return (
        <AuthProvider client={client}>
          <App />
        </AuthProvider>
      );
    }
    return (
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    );
  }

  createRoot(root).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
}
