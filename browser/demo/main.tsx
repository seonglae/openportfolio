import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../src/App.tsx";
import "../src/index.css";
import "./demo.css";

type Theme = "light" | "dark";
const STORAGE_KEY = "openportfolio-demo-theme";

// Light unless the visitor says otherwise. The screenshots and the homepage are
// both light, and a dashboard that flips to dark on first paint reads as a
// different product than the one in the screenshot above it.
function initialTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark") return "dark";
  return "light";
}

// ?bare=1 drops the banner for product screenshots. The hosted demo never
// sets it, so a visitor always sees the disclosure.
const BARE = new URLSearchParams(window.location.search).has("bare");

function Demo() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  if (BARE) return <App />;

  return (
    <>
      <div className="demo-banner">
        <span>
          <strong>Demo.</strong> Every figure on this page is invented. No real account is connected.
        </span>
        <span className="demo-banner-actions">
          <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "Dark" : "Light"}
          </button>
          <a href="https://github.com/seonglae/openportfolio">Source</a>
        </span>
      </div>
      <App />
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
