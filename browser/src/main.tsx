import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App.tsx";
import { AuthProvider, clerkConfigured } from "./Auth.tsx";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL;

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

// Without a URL there is no backend to talk to, and every view would render an
// endless spinner. Say which variable is missing instead.
if (!url) {
  root.textContent = "VITE_CONVEX_URL is not set. Copy browser/.env.local.example to browser/.env.local.";
} else {
  const client = new ConvexReactClient(url);

  // Two providers, chosen by whether an identity provider is configured. With
  // Clerk the app is private and Convex sees a real identity; without it the
  // backend falls through to OPENPORTFOLIO_DEV_TENANT, which is how a fresh
  // localhost checkout works before any auth exists. See Auth.tsx for why this
  // is a switch rather than a hard requirement.
  function Shell(): React.ReactElement {
    if (clerkConfigured()) {
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
