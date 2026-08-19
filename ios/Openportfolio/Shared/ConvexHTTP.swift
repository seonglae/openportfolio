import Foundation

// Convex function API client. Queries and mutations POST to
// {deployment}.convex.cloud/api/{query,mutation} with {path,args,format:"json"}
// and come back as {status:"success", value} or {errorMessage}.
//
// Auth is the same service key the sync worker uses (convex/auth.ts): the key
// carries its own tenant, so no screen ever names a tenantId. tenantSlug is
// sent only when the operator belongs to more than one book, and the backend
// checks it against the key rather than trusting it.
enum ConvexError: LocalizedError {
    case notConfigured, badURL, server(String), shape
    var errorDescription: String? {
        switch self {
        case .notConfigured: return String(localized: "No deployment configured")
        case .badURL: return String(localized: "Bad URL")
        case .server(let m): return m
        case .shape: return String(localized: "Unexpected response shape")
        }
    }
}

struct Convex {
    static let urlKey = "convexUrl"
    static let serviceKeyKey = "serviceKey"
    static let tenantKey = "tenantSlug"

    private static func plist(_ key: String) -> String {
        let v = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
        // An unfilled xcconfig leaves the literal "$(KEY)" behind; treat that as empty.
        if v.hasPrefix("$(") { return "" }
        return v
    }

    private static func setting(_ defaultsKey: String, _ plistKey: String) -> String {
        let saved = UserDefaults.standard.string(forKey: defaultsKey) ?? ""
        if !saved.isEmpty { return saved }
        return plist(plistKey)
    }

    static var cloudURL: String { setting(urlKey, "OPENPORTFOLIO_CONVEX_URL") }
    static var serviceKey: String { setting(serviceKeyKey, "OPENPORTFOLIO_SERVICE_KEY") }
    static var tenantSlug: String { setting(tenantKey, "OPENPORTFOLIO_TENANT_SLUG") }
    static var configured: Bool { !cloudURL.isEmpty && !serviceKey.isEmpty }

    static func setURL(_ v: String) { UserDefaults.standard.set(v, forKey: urlKey) }
    static func setServiceKey(_ v: String) { UserDefaults.standard.set(v, forKey: serviceKeyKey) }
    static func setTenantSlug(_ v: String) { UserDefaults.standard.set(v, forKey: tenantKey) }

    private static func post(_ kind: String, _ path: String, _ args: [String: Any]) async throws -> Any {
        guard configured else { throw ConvexError.notConfigured }
        guard let url = URL(string: "\(cloudURL)/api/\(kind)") else { throw ConvexError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var scoped = args
        scoped["serviceKey"] = serviceKey
        let slug = tenantSlug
        if !slug.isEmpty { scoped["tenantSlug"] = slug }
        req.httpBody = try JSONSerialization.data(withJSONObject: ["path": path, "args": scoped, "format": "json"])
        let (data, _) = try await URLSession.shared.data(for: req)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ConvexError.shape }
        if (obj["status"] as? String) == "success" { return obj["value"] as Any }
        throw ConvexError.server((obj["errorMessage"] as? String) ?? "convex error")
    }

    static func query(_ path: String, _ args: [String: Any] = [:]) async throws -> Any { try await post("query", path, args) }
    @discardableResult
    static func mutation(_ path: String, _ args: [String: Any] = [:]) async throws -> Any { try await post("mutation", path, args) }

    private static func rows(_ value: Any) -> [[String: Any]] { (value as? [[String: Any]]) ?? [] }

    // MARK: - the book
    static func netWorth() async throws -> NetWorth? {
        NetWorth(try await query("netWorth:current") as? [String: Any] ?? [:])
    }
    static func netWorthHistory(limit: Int = 90) async throws -> [Snapshot] {
        rows(try await query("netWorth:history", ["limit": limit])).compactMap(Snapshot.init)
    }
    static func accounts() async throws -> [Account] {
        rows(try await query("accounts:list")).compactMap(Account.init)
    }
    static func balances() async throws -> [Balance] {
        rows(try await query("balances:list")).compactMap(Balance.init)
    }

    // MARK: - the record
    static func forecasts(limit: Int = 60) async throws -> [Forecast] {
        rows(try await query("forecasts:list", ["limit": limit])).compactMap(Forecast.init)
    }
    static func calibration(windowDays: Int? = nil) async throws -> Calibration? {
        var args: [String: Any] = [:]
        if let windowDays { args["windowDays"] = windowDays }
        return Calibration(try await query("forecasts:calibration", args) as? [String: Any] ?? [:])
    }

    // MARK: - what is coming
    static func catalysts(windowDays: Int = 30) async throws -> [Catalyst] {
        rows(try await query("catalysts:upcoming", ["windowDays": windowDays])).compactMap(Catalyst.init)
    }
    static func openDecisions() async throws -> [Decision] {
        rows(try await query("decisions:list", ["status": "open"])).compactMap(Decision.init)
    }

    // MARK: - identity
    static func whoami() async throws -> Whoami? {
        Whoami(try await query("tenants:whoami") as? [String: Any] ?? [:])
    }
}
