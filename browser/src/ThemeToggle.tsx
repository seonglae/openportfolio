import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

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

  // Both glyphs render and CSS picks one off [data-theme], which is the same
  // mechanism the static marketing pages use. Branching here instead would
  // need a second mechanism for the same control.
  return (
    <button className="theme-toggle glass" type="button" onClick={flip} title="Toggle dark mode" aria-label="Toggle dark mode">
      <Moon className="i-light" size={17} strokeWidth={1.7} aria-hidden="true" />
      <Sun className="i-dark" size={17} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}
