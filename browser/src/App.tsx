import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AuthButton } from "./Auth.tsx";
import { Mark } from "./Mark.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { NetWorthView } from "./views/NetWorthView.tsx";
import { RecordView } from "./views/RecordView.tsx";
import { DecisionsView } from "./views/DecisionsView.tsx";
import { FlowsView } from "./views/FlowsView.tsx";

// One tab per pillar, plus the queue that keeps the third one honest.
const TABS = [
  { key: "worth", label: "Net worth" },
  { key: "flows", label: "Flows" },
  { key: "record", label: "Track record" },
  { key: "decisions", label: "Decisions" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const PANEL: Record<TabKey, () => React.ReactElement> = {
  worth: NetWorthView,
  flows: FlowsView,
  record: RecordView,
  decisions: DecisionsView,
};

const TAB_BASE = "rounded-lg px-3.5 py-2 text-sm font-medium leading-none transition-colors";

// The selected tab takes its border from .glass. Handing the base string a
// border utility instead would win the cascade against it, because Tailwind
// utilities sit in a later layer than the component classes.
const TAB_STATE: Record<"on" | "off", string> = {
  on: "glass text-ink",
  off: "border border-transparent text-ink-3 hover:text-ink",
};

type Whoami = { tenantSlug: string | null; tenantName: string | null; role: string; via: string };

/**
 * Which book, and on whose authority.
 *
 * `via` is shown because the two auth paths are not interchangeable and look
 * identical otherwise. "dev" means OPENPORTFOLIO_DEV_TENANT is set on the
 * deployment, so ANY unauthenticated caller reaches this book -- correct on
 * localhost, a data leak on a public URL. Saying so in the header is cheaper
 * than finding out later.
 */
function tenantLabel(me: Whoami | undefined): string {
  if (me === undefined) return "resolving tenant";
  const book = me.tenantName ?? me.tenantSlug ?? "unknown book";
  if (me.via === "dev") return `${book} · ${me.role} · dev tenant, no sign-in required`;
  return `${book} · ${me.role}`;
}

export function App() {
  const [tab, setTab] = useState<TabKey>("worth");
  const me = useQuery(api.tenants.whoami, {});
  const Panel = PANEL[tab];

  return (
    <div className="mx-auto max-w-[1120px] px-6 pt-7 pb-20">
      <header className="flex items-center gap-3 border-b border-rule pb-3.5">
        <Mark />
        <h1 className="serif text-[25px] leading-none font-normal tracking-[-0.01em]">openportfolio</h1>
        <span className="ml-auto font-mono text-xs text-ink-3">{tenantLabel(me)}</span>
        <ThemeToggle />
        <AuthButton />
      </header>
      <nav className="mt-[18px] mb-1 flex gap-0.5">
        {TABS.map((entry) => {
          const state = entry.key === tab ? "on" : "off";
          return (
            <button key={entry.key} className={`${TAB_BASE} ${TAB_STATE[state]}`} onClick={() => setTab(entry.key)}>
              {entry.label}
            </button>
          );
        })}
      </nav>
      <main>
        <Panel />
      </main>
    </div>
  );
}
