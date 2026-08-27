import SwiftUI

// openportfolio on the phone. A native SwiftUI client over the same Convex
// backend the browser reads, not a web view: the four tabs are the four things
// the book is for. One net worth, one exposure per name, the scored record,
// and the connection that makes them yours.
enum Tab: Hashable { case book, positions, calls, settings }

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()
    @Published var tab: Tab = .book
    // Bumped whenever a screen wants its siblings to reload (a saved
    // connection, a pull to refresh that changed the tenant).
    @Published var reloadNonce = 0
    func reloadAll() { reloadNonce += 1 }
}

@main
struct OpenportfolioApp: App {
    @StateObject private var state = AppState.shared
    @AppStorage(ThemeChoice.storageKey) private var appearance = ThemeChoice.system

    var body: some Scene {
        WindowGroup {
            TabView(selection: $state.tab) {
                BookView()
                    .tabItem { Label("Book", systemImage: "chart.pie") }
                    .tag(Tab.book)
                PositionsView()
                    .tabItem { Label("Positions", systemImage: "list.bullet") }
                    .tag(Tab.positions)
                CallsView()
                    .tabItem { Label("Calls", systemImage: "target") }
                    .tag(Tab.calls)
                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gearshape") }
                    .tag(Tab.settings)
            }
            .tint(Theme.accent)
            // The tab bar floats over the content on the iOS 26 SDK, and this
            // TabView is what reserves room for it: measured inside the Book
            // list on an iPhone 17 Pro, safeAreaInsets.bottom is 83.0pt, of
            // which 34 is the home indicator. So the last row of a scrollable
            // clears the bar with nothing added, and a bottom contentMargins
            // here would be breathing room rather than a fix. One was added and
            // taken back out in d211b1d; the note survives so the next person
            // measures instead of guessing. Reproduced independently in
            // openworks, which uses listStyle(.plain) inside a NavigationStack
            // and reads the same 83.0, so the inset comes from the TabView and
            // not from anything about the list.
            .environmentObject(state)
            // On the root, so it reaches the dynamic colours in Theme and not
            // only the system chrome: forcing light while the phone is dark is
            // what proves the preference is actually plumbed through.
            .preferredColorScheme(appearance.colorScheme)
        }
    }
}
