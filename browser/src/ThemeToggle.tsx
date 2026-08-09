import { useEffect, useState } from "react";

const STORAGE_KEY = "openportfolio-theme";

type Theme = "light" | "dark";

// Light is the default outright rather than following the OS. The marketing
// page and the demo are both light, so a dashboard that flips to dark on first
// paint reads as a different product than the one that was linked to. The key
// is shared with the marketing site, which is same-origin, so a visitor who
// picks dark on the homepage keeps it here.
function stored(): Theme {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark") return "dark";
  return "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function flip() {
    if (theme === "dark") setTheme("light");
    else setTheme("dark");
  }

  // Hand-drawn rather than pulled from an icon set: the crescent every set
  // ships now is two arcs that land within a stroke width of each other at this
  // size and renders as a bitten circle. This markup is character-identical to
  // the copy in the static pages, which cannot import a component, so the one
  // control looks the same on every surface.
  // Both glyphs render and CSS picks one off [data-theme], so the icon is right
  // at first paint instead of after the effect below runs.
  return (
    <button
      className="theme-toggle glass"
      type="button"
      onClick={flip}
      title="Toggle dark mode"
      aria-label="Toggle dark mode"
    >
      <svg className="i-light" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      <svg className="i-dark" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    </button>
  );
}
