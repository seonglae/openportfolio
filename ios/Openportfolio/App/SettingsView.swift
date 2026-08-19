import SwiftUI

// The connection, and nothing else. A service key is issued per book
// (tenants:issueServiceKey) and carries its own tenant, so this screen never
// asks which book to open. Values baked in at build time (Secrets.xcconfig)
// are the default; anything entered here overrides on this device only and
// never leaves it.
struct SettingsView: View {
    @EnvironmentObject var state: AppState
    @State private var url = Convex.cloudURL
    @State private var key = Convex.serviceKey
    @State private var slug = Convex.tenantSlug
    @State private var who: Whoami?
    @State private var msg: String?
    @State private var checking = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Book") {
                    if let who {
                        LabeledContent("Name", value: who.tenantName)
                        LabeledContent("Base currency", value: who.baseCurrency)
                        LabeledContent("Role", value: who.role)
                    } else {
                        Text(Convex.configured ? "Not checked yet." : "No deployment configured.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Button {
                        Task { await check() }
                    } label: { Text(checking ? "Checking…" : "Test connection") }
                    .disabled(checking || !Convex.configured)
                }

                Section {
                    TextField("Deployment URL", text: $url)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    SecureField("Service key", text: $key)
                    TextField("Tenant slug (only if you have several)", text: $slug)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Save") {
                        Convex.setURL(url.trimmingCharacters(in: .whitespacesAndNewlines))
                        Convex.setServiceKey(key.trimmingCharacters(in: .whitespacesAndNewlines))
                        Convex.setTenantSlug(slug.trimmingCharacters(in: .whitespacesAndNewlines))
                        msg = String(localized: "Saved")
                        state.reloadAll()
                        Task { await check() }
                    }
                } header: {
                    Text("Connection")
                } footer: {
                    Text("Ends in .convex.cloud. The key is stored on this device and sent only to that deployment.")
                }

                if let msg {
                    Section { Text(msg).font(.caption).foregroundStyle(.secondary) }
                }

                Section("About") {
                    LabeledContent("Version", value: versionLabel)
                    Link("openportfolio.app", destination: URL(string: "https://openportfolio.app")!)
                }
            }
            .navigationTitle("Settings")
            .task { await check() }
        }
    }

    var versionLabel: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(short) (\(build))"
    }

    func check() async {
        guard Convex.configured else { return }
        checking = true
        defer { checking = false }
        do {
            who = try await Convex.whoami()
            msg = nil
        } catch {
            who = nil
            msg = error.localizedDescription
        }
    }
}
