import SwiftUI
import Charts

// The morning screen: one net worth, where it sits, and what is about to
// happen to it. Catalysts and open decisions live here rather than on a tab of
// their own because a dated event nobody opens is an event nobody sees.
struct BookView: View {
    @EnvironmentObject var state: AppState
    @State private var net: NetWorth?
    @State private var history: [Snapshot] = []
    @State private var catalysts: [Catalyst] = []
    @State private var decisions: [Decision] = []
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            LoadState(configured: Convex.configured,
                      error: error,
                      empty: net == nil,
                      emptyTitle: "No book yet",
                      emptyHint: "Link an account and run a sync; the total appears here.",
                      loading: loading) {
                List {
                    if let net { totalSection(net) }
                    if history.count > 1 { historySection }
                    if let net, !net.byAssetClass.isEmpty { breakdown("By asset class", net.byAssetClass, net.baseCurrency, colored: true) }
                    if let net, !net.byVenue.isEmpty { breakdown("By venue", net.byVenue, net.baseCurrency, colored: false) }
                    if !catalysts.isEmpty { catalystSection }
                    if !decisions.isEmpty { decisionSection }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle("Book")
            .refreshable { await load() }
            .task { await load() }
            .onChange(of: state.reloadNonce) { _, _ in Task { await load() } }
            .overlay { if loading && net == nil { ProgressView() } }
        }
    }

    @ViewBuilder
    func totalSection(_ net: NetWorth) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(money(net.totalBase, net.baseCurrency))
                    .font(.system(size: 34, weight: .semibold, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text(String(format: String(localized: "%d accounts"), net.accountCount))
                    if let change = changeText(net) {
                        Text(change.0).foregroundStyle(change.1)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
    }

    // Against the oldest snapshot on the chart, so the number under the total
    // and the line above it are talking about the same window.
    func changeText(_ net: NetWorth) -> (String, Color)? {
        guard let first = history.first, first.totalBase > 0 else { return nil }
        let delta = net.totalBase - first.totalBase
        let pct = delta / first.totalBase
        let sign = delta >= 0 ? "+" : ""
        let label = "\(sign)\(money(delta, net.baseCurrency, compact: true)) (\(sign)\(percent(pct)))"
        return (label, Theme.pnlColor(delta))
    }

    @ViewBuilder
    var historySection: some View {
        Section("History") {
            Chart(history) { point in
                AreaMark(x: .value("Date", point.date), y: .value("Total", point.totalBase))
                    .foregroundStyle(Theme.accent.opacity(0.15))
                LineMark(x: .value("Date", point.date), y: .value("Total", point.totalBase))
                    .foregroundStyle(Theme.accent)
                    .interpolationMethod(.monotone)
            }
            .chartYScale(domain: .automatic(includesZero: false))
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
            .frame(height: 140)
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    func breakdown(_ title: LocalizedStringKey, _ slices: [NetWorth.Slice], _ currency: String, colored: Bool) -> some View {
        let total = slices.reduce(0.0) { $0 + abs($1.valueBase) }
        Section(title) {
            ForEach(slices) { slice in
                let share = total > 0 ? abs(slice.valueBase) / total : 0
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(slice.label).font(.subheadline)
                        Spacer()
                        Text(money(slice.valueBase, currency, compact: true)).font(.subheadline.monospacedDigit())
                        Text(percent(share, digits: 0))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .trailing)
                    }
                    ProgressView(value: share)
                        .tint(colored ? Theme.assetClassColor(slice.label) : Theme.accent)
                }
                .padding(.vertical, 2)
            }
        }
    }

    @ViewBuilder
    var catalystSection: some View {
        Section("Ahead") {
            ForEach(catalysts) { c in
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.title).font(.subheadline)
                    HStack(spacing: 6) {
                        Text("\(shortDate(c.date)) · \(daysAway(c.date))")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                        ForEach(c.assets.prefix(4), id: \.self) { a in Pill(text: a, color: Theme.accent) }
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    @ViewBuilder
    var decisionSection: some View {
        Section("Waiting on") {
            ForEach(decisions) { d in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(d.title).font(.subheadline)
                        Spacer()
                        if d.isOverdue { Pill(text: String(localized: "overdue"), color: .red) }
                    }
                    Text(d.triggerCondition).font(.caption).foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
        }
    }

    func load() async {
        guard Convex.configured else { return }
        loading = true
        defer { loading = false }
        do {
            net = try await Convex.netWorth()
            history = try await Convex.netWorthHistory()
            catalysts = try await Convex.catalysts()
            decisions = try await Convex.openDecisions()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
