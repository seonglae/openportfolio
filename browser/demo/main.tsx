import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../src/App.tsx";
import "../src/index.css";

// ?bare=1 drops the banner for product screenshots. The hosted demo never
// sets it, so a visitor always sees the disclosure.
const BARE = new URLSearchParams(window.location.search).has("bare");

const SOURCE_LINK =
  "rounded-md border border-rule px-2.5 py-1.5 font-medium text-ink-2 no-underline transition-colors hover:border-accent hover:text-ink";

// The theme control lives in the app header, so it ships with the product
// instead of only existing on this page. demo.html applies the stored choice
// before first paint.
function Demo() {
  if (BARE) return <App />;

  return (
    <>
      <div className="glass-bar flex flex-wrap items-center justify-between gap-3 border-b border-rule px-6 py-2.5 text-[13px] text-ink-2">
        <span>
          <strong className="font-semibold text-ink">Demo.</strong> Every figure on this page is invented. No real account
          is connected.
        </span>
        <a className={SOURCE_LINK} href="https://github.com/seonglae/openportfolio">
          Source
        </a>
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
