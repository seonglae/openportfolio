import Foundation

// A string worth showing, or nothing.
//
// `as? String ?? fallback` only fires the fallback when the key is absent, and
// Convex stores a string field the caller left blank as "" rather than omitting
// it. So `d["label"] as? String ?? key` finds a value in the empty string and
// draws a row with no text on it, which reads as a loading bug rather than a
// blank field. Both `label` and `name` are v.string() in the schema with no
// minimum length, so this is reachable without anything going wrong.
func text(_ d: [String: Any], _ key: String) -> String? {
    guard let s = d[key] as? String else { return nil }
    let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func num(_ d: [String: Any], _ k: String) -> Double? { (d[k] as? NSNumber)?.doubleValue }

// netWorth:current. Computed on read, so it is the live number rather than the
// last thing a cron happened to write.
struct NetWorth {
    let baseCurrency: String
    let totalBase: Double
    let byVenue: [Slice]
    let byAssetClass: [Slice]
    let accountCount: Int

    struct Slice: Identifiable {
        let label: String
        let valueBase: Double
        var id: String { label }
    }

    init?(_ d: [String: Any]) {
        guard let total = num(d, "totalBase") else { return nil }
        totalBase = total
        baseCurrency = d["baseCurrency"] as? String ?? "USD"
        accountCount = (d["accountCount"] as? NSNumber)?.intValue ?? 0
        byVenue = NetWorth.slices(d["byVenue"], key: "venue")
        byAssetClass = NetWorth.slices(d["byAssetClass"], key: "assetClass")
    }

    private static func slices(_ raw: Any?, key: String) -> [Slice] {
        let rows = (raw as? [[String: Any]]) ?? []
        var out: [Slice] = []
        for row in rows {
            guard let label = row[key] as? String, let value = num(row, "valueBase") else { continue }
            out.append(Slice(label: label, valueBase: value))
        }
        return out.sorted { $0.valueBase > $1.valueBase }
    }
}

// netWorth:history, oldest first (the backend reverses for us).
struct Snapshot: Identifiable {
    let id: String
    let at: Double
    let totalBase: Double

    init?(_ d: [String: Any]) {
        guard let id = d["_id"] as? String, let at = num(d, "at"), let total = num(d, "totalBase") else { return nil }
        self.id = id
        self.at = at
        self.totalBase = total
    }
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

struct Account: Identifiable {
    let id: String
    let accountKey: String
    let venue: String
    let kind: String
    let label: String
    let currency: String
    let syncedAt: Double?

    init?(_ d: [String: Any]) {
        guard let id = d["_id"] as? String, let key = d["accountKey"] as? String else { return nil }
        self.id = id
        accountKey = key
        venue = d["venue"] as? String ?? ""
        kind = d["kind"] as? String ?? ""
        label = text(d, "label") ?? key
        currency = d["currency"] as? String ?? ""
        syncedAt = num(d, "syncedAt")
    }
}

struct Balance: Identifiable {
    let id: String
    let accountKey: String
    let symbol: String
    let assetClass: String
    let qty: Double
    let lastPrice: Double?
    let valueBase: Double
    let currency: String
    let pnl: Double?
    let asOf: Double

    init?(_ d: [String: Any]) {
        guard let id = d["_id"] as? String, let symbol = d["symbol"] as? String else { return nil }
        self.id = id
        self.symbol = symbol
        accountKey = d["accountKey"] as? String ?? ""
        assetClass = d["assetClass"] as? String ?? ""
        qty = num(d, "qty") ?? 0
        lastPrice = num(d, "lastPrice")
        valueBase = num(d, "valueBase") ?? 0
        currency = d["currency"] as? String ?? ""
        pnl = num(d, "pnl")
        asOf = num(d, "asOf") ?? 0
    }
}

// The same name held in an ISA, a pension and an exchange is one exposure.
// Positions are shown folded by symbol for exactly that reason.
struct Exposure: Identifiable {
    let symbol: String
    let assetClass: String
    let qty: Double
    let valueBase: Double
    let pnl: Double?
    let accounts: [String]
    var id: String { symbol }

    static func fold(_ rows: [Balance]) -> [Exposure] {
        var order: [String] = []
        var grouped: [String: [Balance]] = [:]
        for row in rows {
            if grouped[row.symbol] == nil { order.append(row.symbol) }
            grouped[row.symbol, default: []].append(row)
        }
        var out: [Exposure] = []
        for symbol in order {
            let group = grouped[symbol] ?? []
            var qty = 0.0
            var value = 0.0
            var pnl = 0.0
            var sawPnl = false
            var accounts: [String] = []
            for row in group {
                qty += row.qty
                value += row.valueBase
                if let p = row.pnl { pnl += p; sawPnl = true }
                if !accounts.contains(row.accountKey) { accounts.append(row.accountKey) }
            }
            let first = group.first
            out.append(Exposure(symbol: symbol,
                                assetClass: first?.assetClass ?? "",
                                qty: qty,
                                valueBase: value,
                                pnl: sawPnl ? pnl : nil,
                                accounts: accounts))
        }
        return out.sorted { $0.valueBase > $1.valueBase }
    }
}

struct Forecast: Identifiable {
    let id: String
    let subject: String
    let probability: Double
    let resolutionCriterion: String
    let author: String
    let status: String      // open | resolved | void
    let createdAt: Double
    let dueAt: Double
    let outcome: Bool?
    let brier: Double?

    init?(_ d: [String: Any]) {
        guard let id = d["_id"] as? String, let subject = d["subject"] as? String else { return nil }
        self.id = id
        self.subject = subject
        probability = num(d, "probability") ?? 0
        resolutionCriterion = d["resolutionCriterion"] as? String ?? ""
        author = d["author"] as? String ?? ""
        status = d["status"] as? String ?? "open"
        createdAt = num(d, "createdAt") ?? 0
        dueAt = num(d, "dueAt") ?? 0
        outcome = d["outcome"] as? Bool
        brier = num(d, "brier")
    }

    var isOpen: Bool { status == "open" }
}

// forecasts:calibration. The reliability diagram is the product: what was said,
// what happened, and the gap.
struct Calibration {
    let n: Int
    let meanBrier: Double?
    let expectedCalibrationError: Double?
    let randomBaseline: Double
    let buckets: [Bucket]

    // {lower, upper, count, meanProbability, observedRate} from
    // @openportfolio/domain reliabilityBuckets. Empty buckets are kept: a
    // diagram that hides them hides where the forecaster never went.
    struct Bucket: Identifiable {
        let lower: Double
        let upper: Double
        let count: Int
        let meanProbability: Double
        let observedRate: Double
        var id: Double { lower }
    }

    init?(_ d: [String: Any]) {
        guard let n = (d["n"] as? NSNumber)?.intValue else { return nil }
        self.n = n
        meanBrier = num(d, "meanBrier")
        expectedCalibrationError = num(d, "expectedCalibrationError")
        randomBaseline = num(d, "randomBaseline") ?? 0.25
        var out: [Bucket] = []
        for row in (d["buckets"] as? [[String: Any]]) ?? [] {
            guard let lower = num(row, "lower"), let upper = num(row, "upper") else { continue }
            out.append(Bucket(lower: lower,
                              upper: upper,
                              count: (row["count"] as? NSNumber)?.intValue ?? 0,
                              meanProbability: num(row, "meanProbability") ?? 0,
                              observedRate: num(row, "observedRate") ?? 0))
        }
        buckets = out
    }
}

struct Catalyst: Identifiable {
    let id: String
    let title: String
    let at: Double
    let assets: [String]
    let venue: String?
    let note: String?

    init?(_ d: [String: Any]) {
        guard let id = d["_id"] as? String, let title = d["title"] as? String, let at = num(d, "at") else { return nil }
        self.id = id
        self.title = title
        self.at = at
        assets = (d["assets"] as? [String]) ?? []
        venue = d["venue"] as? String
        note = d["note"] as? String
    }
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

// "Wait until the Fed meets" is a conclusion with an expiry, and one nobody
// wrote down is one that gets dropped.
struct Decision: Identifiable {
    let id: String
    let title: String
    let detail: String?
    let triggerCondition: String
    let dueAt: Double?

    init?(_ d: [String: Any]) {
        guard let id = d["_id"] as? String, let title = d["title"] as? String else { return nil }
        self.id = id
        self.title = title
        detail = d["detail"] as? String
        triggerCondition = d["triggerCondition"] as? String ?? ""
        dueAt = num(d, "dueAt")
    }
    var isOverdue: Bool {
        guard let dueAt else { return false }
        return dueAt < Date().timeIntervalSince1970 * 1000
    }
}

struct Whoami {
    let tenantName: String
    let tenantSlug: String
    let baseCurrency: String
    let role: String
    let via: String

    init?(_ d: [String: Any]) {
        guard let slug = d["tenantSlug"] as? String else { return nil }
        tenantSlug = slug
        tenantName = text(d, "tenantName") ?? slug
        baseCurrency = d["baseCurrency"] as? String ?? ""
        role = d["role"] as? String ?? ""
        via = d["via"] as? String ?? ""
    }
}
