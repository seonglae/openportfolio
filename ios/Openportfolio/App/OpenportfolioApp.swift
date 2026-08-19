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
            .environmentObject(state)
        }
    }
}
