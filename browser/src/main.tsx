import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App.tsx";
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
  createRoot(root).render(
    <StrictMode>
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    </StrictMode>,
  );
}
