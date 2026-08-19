# openportfolio (iOS)

A native SwiftUI client over the same Convex backend the browser reads. Not a
web view and not a wrapper: the screens are SwiftUI, the charts are Swift
Charts, and the only thing shared with `browser/` is the backend and the colour
tokens.

Four tabs, one per thing the book is for:

| Tab | Reads | Shows |
| --- | --- | --- |
| Book | `netWorth:current`, `netWorth:history`, `catalysts:upcoming`, `decisions:list` | one total, the change over the charted window, the split by asset class and venue, the dated events ahead, and the open "wait for X" decisions |
| Positions | `balances:list`, `accounts:list` | every name folded to one exposure, because the same holding in an ISA, a pension and an exchange is one position. Toggle to see it by account instead |
| Calls | `forecasts:list`, `forecasts:calibration` | the reliability diagram, mean Brier against the random baseline, and each registered call with the criterion that settles it |
| Settings | `tenants:whoami` | the connection, and a test that names the book it reached |

## Auth

The app authenticates with a service key issued per book
(`tenants:issueServiceKey`). The key carries its own tenant, so no screen ever
names a `tenantId` and no argument can reach another book. `tenantSlug` is sent
only when one operator belongs to several books, and the backend checks it
against the key rather than believing it.

The key is stored in `UserDefaults` on the device and sent only to the
deployment it came from.

## Build

```bash
cp Secrets.xcconfig.example Secrets.xcconfig   # fill in URL, key, team id
xcodegen generate
open Openportfolio.xcodeproj
```

`Secrets.xcconfig`, the generated `Openportfolio.xcodeproj` and `Info.plist`
are gitignored, so a clone carries no deployment and no key. Values baked in
at build time are only defaults: everything is overridable on the Settings
screen, on that device alone.

Simulator build without signing:

```bash
xcodebuild -project Openportfolio.xcodeproj -scheme Openportfolio \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
```

## Source layout

```
project.yml                XcodeGen spec: one target, xcconfig-driven Info.plist
Shared/ConvexHTTP.swift    Convex function API client, service-key scoped
Shared/Models.swift        row decoders, plus Exposure.fold (one name, one exposure)
Shared/Theme.swift         colour tokens, money/percent formatting, shared load states
App/OpenportfolioApp.swift @main TabView shell
App/BookView.swift         net worth, history chart, breakdowns, catalysts, decisions
App/PositionsView.swift    folded exposures and the per-account view
App/CallsView.swift        reliability diagram and the call list
App/SettingsView.swift     connection and the book it reaches
```

Deployment target iOS 17. No third-party dependencies.
