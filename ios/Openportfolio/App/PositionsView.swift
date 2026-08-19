import SwiftUI

// Positions folded by symbol. The same name held in an ISA, a pension and an
// exchange is one exposure; seeing it split three ways is how a position gets
// to twice the size anyone intended. Tap a row for the accounts behind it.
struct PositionsView: View {
    @EnvironmentObject var state: AppState
    @State private var balances: [Balance] = []
    @State private var accounts: [Account] = []
    @State private var currency = "USD"
    @State private var error: String?
    @State private var loading = false
    @State private var folded = true

    private var exposures: [Exposure] { Exposure.fold(balances) }
    private var total: Double { balances.reduce(0.0) { $0 + $1.valueBase } }

    var body: some View {
        NavigationStack {
            LoadState(configured: Convex.configured,
                      error: error,
                      empty: balances.isEmpty,
                      emptyTitle: "No positions",
                      emptyHint: "Balances appear once an account has synced.",
                      loading: loading) {
                List {
                    if folded { foldedRows } else { accountRows }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle("Positions")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { folded.toggle() } label: {
                        Text(folded ? "By name" : "By account").font(.caption.bold())
                    }
                    .buttonStyle(.bordered)
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .onChange(of: state.reloadNonce) { _, _ in Task { await load() } }
            .overlay { if loading && balances.isEmpty { ProgressView() } }
        }
    }

    @ViewBuilder
    var foldedRows: some View {
        Section {
            ForEach(exposures) { e in
                NavigationLink {
                    ExposureDetail(exposure: e,
                                   rows: balances.filter { $0.symbol == e.symbol },
                                   accounts: accounts,
                                   currency: currency)
                } label: {
                    ExposureRow(e: e, currency: currency, share: total > 0 ? e.valueBase / total : 0)
                }
            }
        } footer: {
            Text(String(format: String(localized: "%d names across %d holdings"), exposures.count, balances.count))
        }
    }

    @ViewBuilder
    var accountRows: some View {
        ForEach(accounts) { account in
            let rows = balances.filter { $0.accountKey == account.accountKey }
            if !rows.isEmpty {
                Section {
                    ForEach(rows.sorted { $0.valueBase > $1.valueBase }) { row in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.symbol).font(.subheadline.weight(.medium))
                                Text(qtyText(row.qty)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(money(row.valueBase, currency, compact: true)).font(.subheadline.monospacedDigit())
                        }
                    }
                } header: {
                    HStack {
                        Text(account.label)
                        Spacer()
                        Text(account.venue).font(.caption2).foregroundStyle(.secondary)
                    }
                } footer: {
                    Text(String(format: String(localized: "synced %@"), relAge(account.syncedAt ?? 0)))
                }
            }
        }
    }

    func load() async {
        guard Convex.configured else { return }
        loading = true
        defer { loading = false }
        do {
            balances = try await Convex.balances()
            accounts = try await Convex.accounts()
            if let net = try await Convex.netWorth() { currency = net.baseCurrency }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ExposureRow: View {
    let e: Exposure
    let currency: String
    let share: Double

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Theme.assetClassColor(e.assetClass))
                .frame(width: 3, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.symbol).font(.subheadline.weight(.semibold))
                HStack(spacing: 6) {
                    Text(qtyText(e.qty)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    if e.accounts.count > 1 {
                        Pill(text: String(format: String(localized: "%d accounts"), e.accounts.count), color: .orange)
                    }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(money(e.valueBase, currency, compact: true)).font(.subheadline.monospacedDigit())
                HStack(spacing: 6) {
                    if let pnl = e.pnl {
                        Text(pnl >= 0 ? "+\(money(pnl, currency, compact: true))" : money(pnl, currency, compact: true))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Theme.pnlColor(pnl))
                    }
                    Text(percent(share, digits: 0)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

struct ExposureDetail: View {
    let exposure: Exposure
    let rows: [Balance]
    let accounts: [Account]
    let currency: String

    private func label(_ accountKey: String) -> String {
        accounts.first { $0.accountKey == accountKey }?.label ?? accountKey
    }

    var body: some View {
        List {
            Section {
                LabeledContent("Quantity", value: qtyText(exposure.qty))
                LabeledContent("Value", value: money(exposure.valueBase, currency))
                if let pnl = exposure.pnl {
                    LabeledContent("P&L") {
                        Text(money(pnl, currency)).foregroundStyle(Theme.pnlColor(pnl))
                    }
                }
                LabeledContent("Asset class", value: exposure.assetClass)
            }
            Section("Held in") {
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(label(row.accountKey)).font(.subheadline)
                            Spacer()
                            Text(money(row.valueBase, currency, compact: true)).font(.subheadline.monospacedDigit())
                        }
                        HStack(spacing: 6) {
                            Text(qtyText(row.qty)).font(.caption2.monospacedDigit())
                            if let price = row.lastPrice {
                                Text("@ \(money(price, row.currency))").font(.caption2.monospacedDigit())
                            }
                            Spacer()
                            Text(relAge(row.asOf)).font(.caption2)
                        }
                        .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .navigationTitle(exposure.symbol)
        .navigationBarTitleDisplayMode(.inline)
    }
}
