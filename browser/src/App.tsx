import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Mark } from "./Mark.tsx";
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

export function App() {
  const [tab, setTab] = useState<TabKey>("worth");
  const me = useQuery(api.tenants.whoami, {});
  const Panel = PANEL[tab];

  return (
    <div className="app">
      <header>
        <Mark />
        <h1>openportfolio</h1>
        <span className="tenant">{me ? `${me.tenantName ?? me.tenantSlug} · ${me.role}` : "resolving tenant"}</span>
      </header>
      <nav>
        {TABS.map((entry) => (
          <button key={entry.key} className={entry.key === tab ? "on" : ""} onClick={() => setTab(entry.key)}>
            {entry.label}
          </button>
        ))}
      </nav>
      <main>
        <Panel />
      </main>
    </div>
  );
}
