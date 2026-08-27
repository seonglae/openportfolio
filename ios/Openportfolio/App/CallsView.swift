import SwiftUI
import Charts

// The scored record. The reliability diagram sits at the top because it is the
// product: what was said, what happened, and the gap between them. A mean Brier
// above the 0.25 baseline means the calls were worse than a coin, and the
// screen says so rather than showing the number without its yardstick.
struct CallsView: View {
    @EnvironmentObject var state: AppState
    @State private var calls: [Forecast] = []
    @State private var calibration: Calibration?
    @State private var error: String?
    @State private var loading = false
    @State private var openOnly = false

    private let diagonal: [Double] = [0, 1]

    private var visible: [Forecast] {
        if openOnly { return calls.filter { $0.isOpen } }
        return calls
    }

    var body: some View {
        NavigationStack {
            LoadState(configured: Convex.configured,
                      error: error,
                      empty: calls.isEmpty,
                      emptyTitle: "No calls yet",
                      emptyHint: "A call registered before the fact, with the condition that settles it, shows up here.",
                      loading: loading) {
                List {
                    if let calibration, calibration.n > 0 { scoreSection(calibration) }
                    Section {
                        ForEach(visible) { call in CallRow(call: call) }
                    } header: {
                        Text(String(format: String(localized: "%d calls"), visible.count))
                    }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle("Calls")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { openOnly.toggle() } label: {
                        Text(openOnly ? "Open" : "All").font(.caption.bold())
                    }
                    .buttonStyle(.bordered)
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .onChange(of: state.reloadNonce) { _, _ in Task { await load() } }
            .overlay { if loading && calls.isEmpty { ProgressView() } }
        }
    }

    @ViewBuilder
    func scoreSection(_ c: Calibration) -> some View {
        Section("Track record") {
            HStack {
                scoreBox(String(localized: "Resolved"), "\(c.n)", .secondary)
                Divider()
                scoreBox(String(localized: "Mean Brier"), brierText(c), brierColor(c))
                Divider()
                scoreBox(String(localized: "Cal. error"), errorText(c), .secondary)
            }
            .padding(.vertical, 2)

            if c.buckets.contains(where: { $0.count > 0 }) {
                Chart {
                    // The 45 degree line a perfectly calibrated forecaster sits on.
                    ForEach(diagonal, id: \.self) { p in
                        LineMark(x: .value("Said", p),
                                 y: .value("Happened", p),
                                 series: .value("Series", "ideal"))
                            .foregroundStyle(.secondary.opacity(0.4))
                    }
                    ForEach(c.buckets.filter { $0.count > 0 }) { b in
                        PointMark(x: .value("Said", b.meanProbability),
                                  y: .value("Happened", b.observedRate))
                            .foregroundStyle(Theme.accent)
                            .symbolSize(by: .value("Count", b.count))
                    }
                }
                .chartXScale(domain: 0...1)
                .chartYScale(domain: 0...1)
                .chartLegend(.hidden)
                .frame(height: 150)
                .padding(.vertical, 4)
            }
            Text("Points on the diagonal are calibrated: a 70% call came true 70% of the time.")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    func scoreBox(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.title3.monospacedDigit().weight(.semibold)).foregroundStyle(color)
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    func brierText(_ c: Calibration) -> String {
        guard let mean = c.meanBrier else { return "-" }
        return String(format: "%.3f", mean)
    }
    // Green only when it beats the random baseline the backend ships with it.
    func brierColor(_ c: Calibration) -> Color {
        guard let mean = c.meanBrier else { return .secondary }
        if mean <= c.randomBaseline { return .green }
        return .red
    }
    func errorText(_ c: Calibration) -> String {
        guard let ece = c.expectedCalibrationError else { return "-" }
        return String(format: "%.3f", ece)
    }

    func load() async {
        guard Convex.configured else { return }
        loading = true
        defer { loading = false }
        do {
            calls = try await Convex.forecasts()
            calibration = try await Convex.calibration()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct CallRow: View {
    let call: Forecast

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(percent(call.probability, digits: 0))
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 46, alignment: .leading)
                Text(call.subject).font(.subheadline).lineLimit(2)
                Spacer()
                statusPill
            }
            Text(call.resolutionCriterion)
                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            HStack(spacing: 6) {
                Text(call.author).font(.caption2)
                Text(dueLabel).font(.caption2.monospacedDigit())
                if let brier = call.brier {
                    Text(String(format: String(localized: "Brier %.3f"), brier)).font(.caption2.monospacedDigit())
                }
            }
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder
    var statusPill: some View {
        if call.isOpen {
            Pill(text: String(localized: "open"), color: Theme.accent)
        } else if call.status == "void" {
            Pill(text: String(localized: "void"), color: .secondary)
        } else if let outcome = call.outcome {
            Pill(text: outcome ? String(localized: "hit") : String(localized: "miss"), color: outcome ? .green : .red)
        } else {
            Pill(text: String(localized: "resolved"), color: .secondary)
        }
    }

    var dueLabel: String {
        let due = Date(timeIntervalSince1970: call.dueAt / 1000)
        if call.isOpen { return String(format: String(localized: "due %@"), daysAway(due)) }
        return shortDate(due)
    }
}
