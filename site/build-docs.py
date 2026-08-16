#!/usr/bin/env python3
"""Renders the docs pages from one template so head, nav and footer cannot drift.

Content lives in PAGES below as raw HTML fragments. There is no build step in
CI and no dependency: run `python3 site/build-docs.py` after editing, and commit
the generated files alongside the source. Keeping the output in git is what lets
Cloudflare Pages serve the directory with no build configured at all.
"""

import html
import pathlib
import re

SITE = "https://openportfolio.app"
OUT = pathlib.Path(__file__).parent / "docs"

NAV = [
    ("Start", [
        ("index.html", "Overview"),
        ("quickstart.html", "Quick start"),
        ("configuration.html", "Configuration"),
    ]),
    ("Concepts", [
        ("forecasts.html", "Forecasts and Brier"),
        ("flows.html", "Flows and catalysts"),
        ("multi-tenancy.html", "Multi-tenancy"),
    ]),
    ("Extend", [
        ("adapters.html", "Venue adapters"),
        ("mcp.html", "MCP and agents"),
    ]),
]

MARK = """<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="hm" gradientUnits="userSpaceOnUse" x1="6" y1="6" x2="46" y2="58"><stop offset="0" stop-color="#8b9cff"/><stop offset=".55" stop-color="#5b6cf0"/><stop offset="1" stop-color="#7c5cf0"/></linearGradient></defs><g fill="url(#hm)"><rect x="4" y="38" width="14" height="20" rx="3" opacity=".55"/><rect x="25" y="24" width="14" height="34" rx="3" opacity=".78"/><rect x="46" y="8" width="14" height="50" rx="3"/></g></svg>"""

# --------------------------------------------------------------- code blocks
#
# Highlighting happens here, at build time, for the same reason the pages are
# generated here: the output is committed and Cloudflare Pages serves it with no
# build configured, so a runtime highlighter would mean either a CDN script on
# every docs page or a bundler this site does not have. A few hundred lines of
# code across eight pages does not justify either.
#
# Blocks are authored as <pre><code class="lang-X">, plain and HTML-escaped. The
# builder unescapes, tokenises, and re-escapes, so the source stays readable and
# comment colouring is not hand-maintained per line.
#
# Classes, one or two letters because they are emitted once per token into a
# file that ships verbatim: c comment, k keyword, s string, t type, f call,
# p property, n number, v variable, a flag, o operator.

TOKENS: dict[str, list[tuple[str, re.Pattern[str]]]] = {}


def _lang(name: str, rules: list[tuple[str, str]], flags: int = 0) -> None:
    TOKENS[name] = [(cls, re.compile(rx, flags)) for cls, rx in rules]


_STR_D = r'"(?:\\.|[^"\\])*"'
_STR_S = r"'(?:\\.|[^'\\])*'"

_lang(
    "bash",
    [
        ("c", r"#[^\n]*"),
        ("s", _STR_D + "|" + _STR_S),
        ("s", r"https?://[^\s\"'<>]+"),
        ("v", r"\$\{[^}]*\}|\$[A-Za-z_]\w*|\$\("),
        # Anchored to a line start so an argument that happens to share a name
        # with a command is not painted as one.
        ("k", r"^[ \t]*(?P<t>npx|npm|pnpm|node|python3|tsx|git|cd|cp|mv|mkdir|export|echo|curl|openssl|chmod|source|sudo|cat)\b"),
        ("a", r"(?<=\s)--?[A-Za-z][\w-]*"),
        ("n", r"\b\d+(?:\.\d+)*\b"),
        ("o", r"[|&;<>()]"),
    ],
    re.M,
)

_lang(
    "json",
    [
        ("c", r"//[^\n]*"),
        ("p", _STR_D + r"(?=\s*:)"),
        ("s", _STR_D),
        ("k", r"\b(?:true|false|null)\b"),
        ("n", r"-?\b\d+(?:\.\d+)?\b"),
        ("o", r"[{}\[\],:]"),
    ],
)

_lang(
    "ts",
    [
        ("c", r"//[^\n]*|/\*.*?\*/"),
        ("s", _STR_D + "|" + _STR_S + r"|`(?:\\.|[^`\\])*`"),
        ("k", r"\b(?:type|interface|const|let|var|function|return|import|export|from|extends|implements|async|await|new|class|if|else|for|of|in|readonly|boolean|string|number|void|null|undefined|true|false)\b"),
        ("t", r"\b[A-Z][A-Za-z0-9_]*\b"),
        # `?` before the paren so an optional method still reads as a call.
        ("f", r"\b[a-z_$][\w$]*(?=\??\s*\()"),
        ("p", r"\b[A-Za-z_$][\w$]*(?=\??\s*:)"),
        ("n", r"\b\d+(?:\.\d+)?\b"),
        ("o", r"[{}()\[\];,.<>?:=|&+\-*/!]"),
    ],
    re.S,
)


def highlight(code: str, lang: str) -> str:
    """Wrap tokens of `code` in spans. Unknown language: escape and return."""
    rules = TOKENS.get(lang)
    if rules is None:
        return html.escape(code)

    # (class or None, text). Runs are accumulated first and merged after, so a
    # line of punctuation is one span instead of one per character -- this file
    # ships as-is, so the markup it emits is the markup that is served.
    runs: list[tuple[str | None, str]] = []

    def add(cls: str | None, text: str) -> None:
        if not text:
            return
        if runs and runs[-1][0] == cls:
            runs[-1] = (cls, runs[-1][1] + text)
        else:
            runs.append((cls, text))

    pos = 0
    while pos < len(code):
        for cls, rx in rules:
            m = rx.match(code, pos)
            if m is None:
                continue
            # A rule may name the part it wants painted; anything before it is
            # matched only to establish position and stays plain.
            key = "t" if "t" in rx.groupindex else 0
            text = m.group(key)
            if not text:
                continue
            add(None, code[pos : m.start(key)])
            add(cls, text)
            pos = m.end(key)
            break
        else:
            add(None, code[pos])
            pos += 1

    return "".join(
        html.escape(text) if cls is None else f'<span class="{cls}">{html.escape(text)}</span>'
        for cls, text in runs
    )


COPY = (
    '<button class="copy" type="button" aria-label="Copy code to clipboard">'
    '<svg class="i-copy" viewBox="0 0 24 24" aria-hidden="true">'
    '<rect x="9" y="9" width="11" height="11" rx="2" />'
    '<path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>'
    '<svg class="i-ok" viewBox="0 0 24 24" aria-hidden="true">'
    '<path d="m5 13 4 4L19 7" /></svg>'
    "</button>"
)

CODE_BLOCK = re.compile(
    r'<pre><code class="lang-(?P<lang>[a-z]+)">(?P<code>.*?)</code></pre>', re.S
)


def render_code(body: str) -> str:
    def one(m: re.Match[str]) -> str:
        lang = m.group("lang")
        # Strip any hand-written spans first, then unescape: the stored fragment
        # is HTML, and the tokeniser wants the source the reader would copy.
        source = html.unescape(re.sub(r"</?span[^>]*>", "", m.group("code")))
        return (
            f'<div class="code">{COPY}'
            f'<pre><code class="lang-{lang}">{highlight(source, lang)}</code></pre></div>'
        )

    return CODE_BLOCK.sub(one, body)


TEMPLATE = """<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>{title} · openportfolio docs</title>
    <meta name="description" content="{description}" />
    <link rel="canonical" href="{url}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="openportfolio" />
    <meta property="og:url" content="{url}" />
    <meta property="og:title" content="{title} · openportfolio docs" />
    <meta property="og:description" content="{description}" />
    <meta property="og:image" content="{site}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="{site}/og.png" />
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/assets/style.css" />
    <script type="application/ld+json">
      {{
        "@context": "https://schema.org",
        "@type": "TechArticle",
        "headline": "{title}",
        "description": "{description}",
        "url": "{url}",
        "isPartOf": {{ "@type": "WebSite", "name": "openportfolio", "url": "{site}/" }},
        "author": {{ "@type": "Person", "name": "Seonglae Cho" }},
        "license": "https://www.apache.org/licenses/LICENSE-2.0",
        "breadcrumb": {{
          "@type": "BreadcrumbList",
          "itemListElement": [
            {{ "@type": "ListItem", "position": 1, "name": "Home", "item": "{site}/" }},
            {{ "@type": "ListItem", "position": 2, "name": "Docs", "item": "{site}/docs/" }},
            {{ "@type": "ListItem", "position": 3, "name": "{title}" }}
          ]
        }}
      }}
    </script>
    <script>
      // Light is the default outright, not "light unless the OS says dark".
      (function () {{
        try {{
          document.documentElement.dataset.theme =
            localStorage.getItem("openportfolio-theme") === "dark" ? "dark" : "light";
        }} catch (e) {{
          document.documentElement.dataset.theme = "light";
        }}
      }})();
    </script>
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-head">
      <div class="wrap">
        <a class="brand" href="/" aria-label="openportfolio home">{mark} openportfolio</a>
        <nav class="site-nav" aria-label="Primary">
          <a href="/docs/">Docs</a>
          <a href="/demo/">Demo</a>
          <button class="theme-toggle" type="button" id="theme" aria-label="Toggle dark mode" title="Toggle dark mode">
            <svg class="i-light" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
            <svg class="i-dark" viewBox="0 0 24 24" aria-hidden="true">
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
          <a class="cta" href="https://github.com/seonglae/openportfolio">GitHub</a>
        </nav>
      </div>
    </header>
    <div class="wrap">
      <div class="docs">
        <nav class="docs-nav" aria-label="Documentation">{sidebar}</nav>
        <article class="prose" id="main">
{body}
        </article>
      </div>
    </div>
    <footer class="site-foot">
      <div class="wrap">
        <span>openportfolio · Apache-2.0 · built by <a href="https://github.com/seonglae">Seonglae Cho</a></span>
        <nav aria-label="Footer">
          <a href="/docs/">Docs</a>
          <a href="/demo/">Demo</a>
          <a href="https://github.com/seonglae/openportfolio">GitHub</a>
        </nav>
      </div>
    </footer>
    <script>
      (function () {{
        var btn = document.getElementById("theme");
        if (!btn) return;
        var root = document.documentElement;
        // No label to keep in sync: CSS picks the glyph off the attribute.
        btn.addEventListener("click", function () {{
          root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
          try {{ localStorage.setItem("openportfolio-theme", root.dataset.theme); }} catch (e) {{}}
        }});
      }})();
    </script>
    <script>
      // Delegated, so a page can hold any number of blocks without per-block
      // wiring. The clipboard gets pre.innerText, and the button is a sibling of
      // the <pre> rather than a child, so its own label cannot land in there.
      (function () {{
        var HELD = 1400;
        function done(btn) {{
          btn.classList.add("ok");
          btn.setAttribute("aria-label", "Copied");
          setTimeout(function () {{
            btn.classList.remove("ok");
            btn.setAttribute("aria-label", "Copy code to clipboard");
          }}, HELD);
        }}
        function legacy(text, btn) {{
          // execCommand is deprecated, and it is still the only path when the
          // page is opened over http:// or from a file.
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try {{ document.execCommand("copy"); done(btn); }} catch (e) {{}}
          document.body.removeChild(ta);
        }}
        document.addEventListener("click", function (e) {{
          var btn = e.target.closest && e.target.closest(".copy");
          if (!btn) return;
          var pre = btn.parentNode.querySelector("pre");
          if (!pre) return;
          var text = pre.innerText;
          if (navigator.clipboard && window.isSecureContext) {{
            navigator.clipboard.writeText(text).then(
              function () {{ done(btn); }},
              function () {{ legacy(text, btn); }}
            );
          }} else {{
            legacy(text, btn);
          }}
        }});
      }})();
    </script>
  </body>
</html>
"""


# Cloudflare Pages 308s /x.html to /x, so every link written with the extension
# costs a redirect hop. Files keep the extension on disk; URLs never carry it.
def url_for(slug: str) -> str:
    return "/docs/" if slug == "index.html" else "/docs/" + slug.removesuffix(".html")


def sidebar(current: str) -> str:
    out = []
    for heading, items in NAV:
        out.append(f"<strong>{heading}</strong>")
        for slug, label in items:
            mark = ' aria-current="page"' if slug == current else ""
            out.append(f'<a href="{url_for(slug)}"{mark}>{label}</a>')
    return "".join(out)


PAGES: dict[str, tuple[str, str, str]] = {}


def page(slug: str, title: str, description: str, body: str) -> None:
    PAGES[slug] = (title, description, body)


page(
    "index.html",
    "Overview",
    "What openportfolio is, what it deliberately does not do, and how the pieces fit: adapters, the sync worker, the Convex backend, the MCP server and the browser.",
    """
<h1>Overview</h1>
<p>openportfolio is a self-hosted portfolio tracker with three jobs: hold every account as one book, keep the flows behind the price, and score the calls you made before the fact.</p>

<div class="callout"><p><strong>It is not a trading bot.</strong> The backend has no function that places an order, both shipped adapters declare <code>canPlaceOrders: false</code>, and <code>PlaceOrderRequest</code> requires an <code>OrderConfirmation</code> field that has no default. Aggregate, watch, keep score.</p></div>

<h2>The pieces</h2>
<table>
<thead><tr><th>Piece</th><th>What it is</th></tr></thead>
<tbody>
<tr><td><code>convex/</code></td><td>The backend. Schema, tenancy gate, net worth, flows, forecasts, decisions, catalysts, audit, and the resolver cron.</td></tr>
<tr><td><code>packages/core</code></td><td>Money, dates and order primitives. No I/O.</td></tr>
<tr><td><code>packages/domain</code></td><td>The vocabulary: enums, Brier scoring, resolution criteria, the adapter contract.</td></tr>
<tr><td><code>packages/node</code></td><td>Anything that touches the network: Convex transport, keyless FX, the venue adapters.</td></tr>
<tr><td><code>sync-worker.mts</code></td><td>Reads balances through the adapters, re-quotes, converts, writes one snapshot.</td></tr>
<tr><td><code>agent-worker.mts</code></td><td>Dispatches work to an agent CLI. No provider key.</td></tr>
<tr><td><code>mcp/</code></td><td>Stdio MCP server, 25 tools over one tenant's book.</td></tr>
<tr><td><code>browser/</code></td><td>Four views: net worth, flows, track record, decisions.</td></tr>
</tbody>
</table>

<h2>How a number gets on the page</h2>
<ol>
<li>An account is linked with <code>accounts:link</code>, naming the venue that serves it.</li>
<li>The sync worker asks that venue's adapter for balances.</li>
<li>Rows with no usable price are re-quoted through the configured quote venue.</li>
<li>Every row is converted into the tenant's base currency, and <strong>the rate is stored on the row it converted</strong>, so a snapshot records what the book was worth then rather than what today's rates say.</li>
<li>One <code>netWorthSnapshots</code> row is written, and the mutation appends to the audit log.</li>
</ol>

<h2>What is deliberately absent</h2>
<ul>
<li><strong>No provider API key.</strong> Model calls go to an agent CLI you are already signed in to. See <a href="/docs/mcp">MCP and agents</a>.</li>
<li><strong>No keyed broker adapter in the repo.</strong> Credentials belong in your worker process, not in a public tree. See <a href="/docs/adapters">Venue adapters</a>.</li>
<li><strong>No order path.</strong> Not disabled by a flag, absent from the backend.</li>
</ul>

<p>Next: <a href="/docs/quickstart">Quick start</a>.</p>
""",
)

page(
    "quickstart.html",
    "Quick start",
    "Clone, install, create a Convex deployment, create the first book, and get a real net worth on screen from a manual holdings file.",
    """
<h1>Quick start</h1>
<p>Node 22+, pnpm, and a <a href="https://convex.dev">Convex</a> account. The free tier is enough.</p>

<h2>1. Install</h2>
<pre><code class="lang-bash">git clone https://github.com/seonglae/openportfolio.git
cd openportfolio
pnpm install

cp .env.example .env.local
npx convex dev --once          <span class="c"># creates the deployment</span></code></pre>

<h2>2. Create the first book</h2>
<p>On localhost with no identity provider configured, the deployment will only create the tenant named by <code>OPENPORTFOLIO_DEV_TENANT</code>.</p>
<pre><code class="lang-bash">npx convex env set OPENPORTFOLIO_DEV_TENANT home
npx convex run tenants:create '{"slug":"home","name":"Home","baseCurrency":"GBP"}'</code></pre>

<h2>3. Start the UI</h2>
<pre><code class="lang-bash">cp browser/.env.local.example browser/.env.local   <span class="c"># set VITE_CONVEX_URL</span>
pnpm --filter openportfolio-browser dev            <span class="c"># http://localhost:6101</span></code></pre>

<h2>4. Sync</h2>
<pre><code class="lang-bash">npx tsx sync-worker.mts --once</code></pre>
<p>With nothing linked it registers the venues it can serve and records a net worth of zero, which is correct.</p>

<h2>5. Put something in it</h2>
<p>A manual holdings file is how a pension, a property or an unlisted holding gets into the total instead of being left out of it.</p>
<pre><code class="lang-json"><span class="c">// holdings.json</span>
[
  { "accountKey": "isa",    "symbol": "VWRL", "assetClass": "etf",    "qty": 40,   "price": 118.2, "currency": "GBP" },
  { "accountKey": "wallet", "symbol": "BTC",  "assetClass": "crypto", "qty": 0.15, "price": 0,     "currency": "USD" }
]</code></pre>
<pre><code class="lang-bash">export OPENPORTFOLIO_MANUAL_HOLDINGS=$PWD/holdings.json
npx convex run accounts:link '{"accountKey":"isa","venue":"manual","kind":"brokerage","label":"ISA","currency":"GBP"}'
npx convex run accounts:link '{"accountKey":"wallet","venue":"manual","kind":"wallet","label":"Wallet","currency":"USD"}'
npx tsx sync-worker.mts --once</code></pre>
<p>The BTC row is priced at 0 on purpose: the worker re-quotes crypto through the keyless CoinGecko adapter, converts both rows into GBP, and writes one total.</p>

<h2>6. Before exposing it</h2>
<div class="callout"><p><strong>Two things are open on localhost.</strong> While <code>OPENPORTFOLIO_DEV_TENANT</code> is set, any unauthenticated caller is scoped to that tenant. Unset it and configure Clerk before the deployment is reachable from the internet.</p></div>
<pre><code class="lang-bash">npx convex env set CLERK_ISSUER_URL https://your-app.clerk.accounts.dev
npx convex env unset OPENPORTFOLIO_DEV_TENANT

KEY="$(openssl rand -hex 32)"
npx convex run tenants:issueServiceKey "{\\"key\\":\\"$KEY\\",\\"label\\":\\"sync-worker\\",\\"role\\":\\"member\\"}"
echo "OPENPORTFOLIO_SERVICE_KEY=$KEY" >> .env.local</code></pre>
<p>Keys are stored as hashes. One key maps to exactly one tenant and carries its own role, so a worker that only reads can be issued a <code>viewer</code> key and will be refused every write.</p>
""",
)

page(
    "configuration.html",
    "Configuration",
    "Every environment variable openportfolio reads, which of them also have to be set on the Convex deployment, and what happens when each is missing.",
    """
<h1>Configuration</h1>
<p>Values marked <em>deployment</em> also have to be set on Convex itself with <code>npx convex env set</code>; the deployment does not read <code>.env.local</code>.</p>

<h2>Required</h2>
<table>
<thead><tr><th>Variable</th><th>Meaning</th></tr></thead>
<tbody>
<tr><td><code>CONVEX_DEPLOYMENT</code></td><td>Written by <code>npx convex dev</code> on first run.</td></tr>
<tr><td><code>OPENPORTFOLIO_SERVICE_KEY</code></td><td>Shared secret the workers and MCP server present instead of a browser session. Generate with <code>openssl rand -hex 32</code> and register only its hash.</td></tr>
<tr><td><code>VITE_CONVEX_URL</code></td><td>In <code>browser/.env.local</code>. The deployment URL the UI talks to.</td></tr>
</tbody>
</table>

<h2>Tenancy</h2>
<table>
<thead><tr><th>Variable</th><th>Meaning</th></tr></thead>
<tbody>
<tr><td><code>OPENPORTFOLIO_TENANT</code></td><td>Which book a worker acts on. Only needed when one identity belongs to several tenants; a service key is never ambiguous.</td></tr>
<tr><td><code>OPENPORTFOLIO_DEV_TENANT</code> <em>(deployment)</em></td><td>Localhost escape hatch. While set, any unauthenticated caller is scoped to that tenant. Unset before the deployment is reachable.</td></tr>
<tr><td><code>CLERK_ISSUER_URL</code> <em>(deployment)</em></td><td>Clerk JWT issuer. Required once more than one person uses the deployment.</td></tr>
</tbody>
</table>

<h2>Venues</h2>
<table>
<thead><tr><th>Variable</th><th>Meaning</th></tr></thead>
<tbody>
<tr><td><code>OPENPORTFOLIO_MANUAL_HOLDINGS</code></td><td>Path to a JSON array of manually maintained holdings.</td></tr>
<tr><td><code>OPENPORTFOLIO_QUOTE_VENUE</code></td><td>Which registered venue prices symbols the holding venue cannot. Defaults to <code>coingecko</code>, which needs no key.</td></tr>
</tbody>
</table>

<div class="callout"><p><strong>There is no model provider key.</strong> Not omitted from this table: there is no variable to set. See <a href="/docs/mcp">MCP and agents</a>.</p></div>
""",
)

page(
    "forecasts.html",
    "Forecasts and Brier",
    "How a call is registered with a probability, a horizon and a resolution criterion, how it settles itself, and how to read the reliability diagram it produces.",
    """
<h1>Forecasts and Brier</h1>
<p>Market commentary is unaccountable, and became more so the moment a model would produce a confident directional view on anything you asked it. The problem is not that views are wrong. It is that being wrong costs nothing and leaves no trace, so a forecaster worth reading and one who is merely fluent are indistinguishable from the outside, and from the inside too.</p>

<h2>Registering a call</h2>
<p>Three things are required before the fact, and none of them can be added afterwards.</p>
<table>
<thead><tr><th>Field</th><th>Why it is mandatory</th></tr></thead>
<tbody>
<tr><td><code>probability</code></td><td>A direction with no number cannot be scored. 0.5 is an admission, not an answer.</td></tr>
<tr><td><code>horizon</code></td><td>A call with no deadline is never wrong, only early.</td></tr>
<tr><td><code>resolutionCriterion</code></td><td>Settled by the string, not by argument afterwards. <code>CSPX close &gt; 742.00</code> leaves nothing to interpret.</td></tr>
</tbody>
</table>

<h2>Settlement</h2>
<p>Criteria that parse into a comparison resolve themselves: a cron sweeps every book's due calls, evaluates the criterion against the stored price series and scores the result. Nothing waits on you remembering that you made a prediction three weeks ago.</p>
<p>The sweep is the one deliberate exception to tenant scoping. It runs on a tenant-less index and is an <code>internalMutation</code> for exactly that reason, unreachable from any client, with a test asserting each book is scored against its own prices.</p>

<h2>The score</h2>
<p>Brier is the mean squared error of the probabilities you gave:</p>
<pre><code class="lang-ts">brier = mean((probability - outcome)²)   <span class="c">// outcome is 1 or 0</span></code></pre>
<table>
<thead><tr><th>Value</th><th>Reading</th></tr></thead>
<tbody>
<tr><td>0.00</td><td>Perfect, and if you see it, check the criteria.</td></tr>
<tr><td>0.25</td><td>What a coin flip earns. The bar, not the goal.</td></tr>
<tr><td>&gt; 0.25</td><td>Worse than saying 50% to everything.</td></tr>
</tbody>
</table>

<h2>Reading the reliability diagram</h2>
<p>A mean Brier alone hides the direction you are wrong in. The diagram buckets calls by what you said and shows what actually happened in each bucket, as two overlaid bars. The gap between them is the entire point.</p>
<ul>
<li><strong>Observed below said, at the top end.</strong> Overconfidence. The usual failure: your 90% calls land 70% of the time.</li>
<li><strong>Observed above said, at the bottom end.</strong> Underconfidence, which costs less but is still a miscalibration.</li>
<li><strong>Bars level across every bucket.</strong> Calibrated. Your 70% means 70%.</li>
</ul>
<p>Calibration and discrimination are different things. A forecaster who says 50% to everything is perfectly calibrated and completely useless, which is why the bucket counts are on the page next to the rates.</p>
""",
)

page(
    "flows.html",
    "Flows and catalysts",
    "Why net buying by investor type and session turnover are stored as first-class series, and how the catalyst calendar turns a forced seller into a scheduled event.",
    """
<h1>Flows and catalysts</h1>
<p>Price is the output of who was buying and who was made to sell. Earnings are the story the flow tells afterwards.</p>

<h2>Flow rows</h2>
<p>A flow row is one investor type, one session, one market or symbol.</p>
<table>
<thead><tr><th>Field</th><th>Note</th></tr></thead>
<tbody>
<tr><td><code>date</code></td><td>Session date in the venue's local calendar.</td></tr>
<tr><td><code>investorType</code></td><td><code>individual</code>, <code>foreigner</code>, <code>institution</code>, <code>other_corporation</code>.</td></tr>
<tr><td><code>netBuyValue</code></td><td>Buy minus sell, in the market's own currency.</td></tr>
<tr><td><code>turnoverValue</code></td><td>Session turnover. Stored on the same row on purpose.</td></tr>
<tr><td><code>source</code></td><td>Where the figure came from, because same-day numbers are provisional until the close.</td></tr>
</tbody>
</table>

<div class="callout"><p><strong>Net buying without turnover is a half-fact.</strong> Foreigners selling on collapsing volume and foreigners selling into a record tape are opposite events with the same net number, so the two fields live on one row and are read together.</p></div>

<h2>Catalysts</h2>
<p>A forced seller is on a schedule, and the schedule is usually public: index deletions, lockup expiries, filing deadlines, scheduled prints. The catalyst table holds dated forward events and the assets each one touches, so position sizing accounts for the next known event rather than only the idea in front of you.</p>
<p>The decisions queue reads the same calendar. A decision whose trigger is "after the print" is not a decision until the print has a date.</p>
""",
)

page(
    "multi-tenancy.html",
    "Multi-tenancy",
    "One deployment, many books. How tenant scoping is derived rather than declared, why a foreign document reads as missing, and how service keys are issued.",
    """
<h1>Multi-tenancy</h1>
<p>One deployment holds many books. The invariant is that <strong>a caller never says which tenant it is</strong>.</p>

<h2>Where the tenant comes from</h2>
<p><code>tenantId</code> is derived from the caller's membership rows, or from the service key's own row. There is no argument a client can set to reach another book. The public API accepts <code>tenantSlug</code>, and only as a disambiguator for a caller who belongs to several tenants; membership is still what decides.</p>

<h2>Missing, not forbidden</h2>
<div class="callout"><p>A document id belonging to another tenant reads as <strong>not found</strong>. Answering "forbidden" would confirm the row exists, which is itself the cross-tenant read you were trying to prevent.</p></div>

<h2>Indexes lead with the tenant</h2>
<p>Every index leads with <code>tenantId</code>, so a query that forgets the scope cannot use an index at all and fails loudly in review rather than quietly returning somebody else's rows.</p>
<p>One exception is deliberate and marked: the resolver cron sweeps every book's due forecasts through a tenant-less index. It is an <code>internalMutation</code> for exactly that reason and is unreachable from any client. A test asserts it scores each book against its own prices.</p>

<h2>Service keys</h2>
<p>Workers and the MCP server have no browser session, so they present a key. The operator generates it locally and registers only its hash, which means the deployment never returns a secret and a leaked database does not leak a credential.</p>
<pre><code class="lang-bash">KEY="$(openssl rand -hex 32)"
npx convex run tenants:issueServiceKey "{\\"key\\":\\"$KEY\\",\\"label\\":\\"sync-worker\\",\\"role\\":\\"viewer\\"}"</code></pre>
<p>One key maps to exactly one tenant and carries its own role. Rotate by issuing a new label and revoking the old one.</p>
""",
)

page(
    "adapters.html",
    "Venue adapters",
    "The adapter contract, the two adapters that ship, and how to add a keyed broker without putting a credential anywhere near the backend or the repository.",
    """
<h1>Venue adapters</h1>
<p>An adapter declares what it can do and implements only that.</p>
<pre><code class="lang-ts">type VenueAdapter = {
  venue: string;
  kind: AccountKind;
  capabilities: { canReadBalances: boolean; canReadQuotes: boolean; canPlaceOrders: boolean };
  readBalances(request: ReadBalancesRequest): Promise&lt;AdapterBalance[]&gt;;
  readQuote(request: ReadQuoteRequest): Promise&lt;AdapterQuote&gt;;
  placeOrder?(request: PlaceOrderRequest): Promise&lt;OrderReceipt&gt;;
};</code></pre>

<h2>What ships</h2>
<table>
<thead><tr><th>Adapter</th><th>Reads balances</th><th>Reads quotes</th><th>Key</th></tr></thead>
<tbody>
<tr><td><code>coingecko</code></td><td>No, on purpose</td><td>Yes</td><td>None</td></tr>
<tr><td><code>manual</code></td><td>Yes, from a JSON file</td><td>No</td><td>None</td></tr>
</tbody>
</table>
<p><code>coingecko</code> refuses balances rather than returning an empty list, because a price source does not know what you hold and an empty list reads as "you hold nothing".</p>

<h2>Adding a keyed broker</h2>
<ol>
<li>Write a module in <code>packages/node/src/adapters/</code>.</li>
<li>Take the credential from the <strong>worker's</strong> environment.</li>
<li>Register it in <code>defaultRegistry()</code>.</li>
</ol>
<div class="callout"><p><strong>Keep the credential in the worker process.</strong> The backend never sees it and neither does this repository. That is why no keyed adapter ships: the useful ones all need a secret, and a public tree is the wrong place to normalise putting one.</p></div>

<h2>If you implement placeOrder</h2>
<pre><code class="lang-ts">type PlaceOrderRequest = {
  <span class="c">// ...</span>
  confirmation: OrderConfirmation;   <span class="c">// { confirmedBy, confirmedAt }</span>
};</code></pre>
<p><code>OrderConfirmation</code> has no default. An order that no human confirmed cannot be constructed, which is a type error rather than a policy someone can forget.</p>
""",
)

page(
    "mcp.html",
    "MCP and agents",
    "Why there is no provider API key, how work is dispatched to an agent CLI you already signed in to, and what the 25 MCP tools expose.",
    """
<h1>MCP and agents</h1>
<p>Watching a book is only useful if something is actually watching: reconciling after the close, settling a call the day its horizon passes, noticing that a deferred decision came due three weeks ago.</p>

<h2>Why there is no API key</h2>
<p>Metered inference is the wrong shape for that work. When each run bills per token, every autonomous check becomes a purchase, and a product that spends the operator's money unprompted has to ask first, or batch, or ration. All three turn a portfolio that watches itself into a portfolio that asks permission to look.</p>
<p>So every model call is dispatched to an agent CLI you are already signed in to, with a per-task fallback order. There is no provider key in this repo and no field to put one in.</p>
<div class="callout"><p><strong>This does not make a run free.</strong> Subscription plans have rate limits, and the fallback chain exists partly because one provider runs out before the others do. What changes is the kind of limit: quota and wall clock rather than spend, so a run never has to be justified one invocation at a time.</p></div>

<h2>The provider chain</h2>
<pre><code class="lang-ts"><span class="c">// actor.mts</span>
const ORDERS = {
  sync:    ["codex", "claude"],
  review:  ["claude", "codex"],
  resolve: ["codex", "antigravity", "claude"],
};</code></pre>
<p>Supported today: <code>codex</code>, <code>antigravity</code> (<code>agy</code>), <code>claude</code>. Adding one is an entry in the registry and a spawn shape.</p>

<h2>The MCP server</h2>
<p>A stdio MCP server exposes 25 tools over exactly one tenant's book, so an agent CLI can read and write it directly rather than through a scraped UI. The service key is injected inline rather than passed on the command line, so no secret reaches <code>argv</code>.</p>
<table>
<thead><tr><th>Group</th><th>Examples</th></tr></thead>
<tbody>
<tr><td>Read the book</td><td>net worth, accounts, balances, snapshots</td></tr>
<tr><td>Flows</td><td>record a session, read net buying, read turnover</td></tr>
<tr><td>Forecasts</td><td>register a call, list due, resolve, read calibration</td></tr>
<tr><td>Decisions</td><td>defer, list open, list overdue, close with an outcome</td></tr>
<tr><td>Catalysts</td><td>add a dated event, list what is inside a window</td></tr>
<tr><td>Audit</td><td>read the append-only log, including what the cron did unattended</td></tr>
</tbody>
</table>
<p>There is no order tool, because there is no order function to expose.</p>
""",
)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, (title, description, body) in PAGES.items():
        html = TEMPLATE.format(
            title=title,
            description=description,
            url=SITE + url_for(slug),
            site=SITE,
            mark=MARK,
            sidebar=sidebar(slug),
            body=render_code(body.strip()),
        )
        (OUT / slug).write_text(html, encoding="utf-8")
        print("wrote docs/" + slug)

    urls = ["/"] + [url_for(s) for s in PAGES]
    entries = "\n".join(
        f"  <url><loc>{SITE}{u}</loc><changefreq>weekly</changefreq>"
        f"<priority>{'1.0' if u == '/' else '0.7'}</priority></url>"
        for u in urls
    )
    (OUT.parent / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{entries}\n</urlset>\n",
        encoding="utf-8",
    )
    print(f"wrote sitemap.xml ({len(urls)} urls)")


if __name__ == "__main__":
    main()
