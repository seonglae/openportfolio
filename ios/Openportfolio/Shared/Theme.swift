import SwiftUI
import UIKit

// Design tokens shared with the browser: the openportfolio indigo as accent.
// One place, so every screen agrees.
enum Theme {
    // Each accent is a pair. The single values these replaced were picked for
    // the browser's warm paper, so on a dark screen the indigo used for tint,
    // pills and the net worth ring sat at a fraction of the contrast it has on
    // white. The light half is unchanged, so nothing moves in light mode.
    static let accent = pair(light: 0x5b_6c_f0, dark: 0x8b_9c_ff)
    static let accentSoft = pair(light: 0x8b_9c_ff, dark: 0xb4_be_ff)
    // A link should not be the system's cornflower blue, which belongs to no
    // palette here, nor the accent, which already means "this book".
    static let link = pair(light: 0x5b_4b_8a, dark: 0xb0_a0_e0)

    static func pair(light: Int, dark: Int) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
    }

    private static func rgb(_ hex: Int) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1
        )
    }

    static func pnlColor(_ v: Double?) -> Color {
        guard let v, v != 0 else { return .secondary }
        if v > 0 { return .green }
        return .red
    }

    // One colour per asset class, stable across the venue and class breakdowns.
    static func assetClassColor(_ assetClass: String) -> Color {
        switch assetClass {
        case "equity": return accent
        case "etf": return accentSoft
        case "fund": return .indigo
        case "bond": return .teal
        case "crypto": return .orange
        case "cash": return .green
        case "derivative": return .pink
        default: return .secondary
        }
    }
}

struct Pill: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule())
            .overlay(Capsule().stroke(color.opacity(0.35), lineWidth: 0.5))
            .foregroundStyle(color)
    }
}

// A value with its currency, in the reader's locale. The book's base currency
// travels with the number rather than being assumed, because a total in the
// wrong currency is a total that gets acted on.
func money(_ value: Double, _ currency: String, compact: Bool = false) -> String {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = currency.isEmpty ? "USD" : currency
    f.locale = Locale.autoupdatingCurrent
    f.maximumFractionDigits = fractionDigits(currency, value: value, compact: compact)
    f.minimumFractionDigits = 0
    return f.string(from: NSNumber(value: value)) ?? "\(value)"
}

private func fractionDigits(_ currency: String, value: Double, compact: Bool) -> Int {
    if currency == "KRW" || currency == "JPY" { return 0 }
    if compact || abs(value) >= 1000 { return 0 }
    return 2
}

func percent(_ fraction: Double, digits: Int = 1) -> String {
    String(format: "%.\(digits)f%%", fraction * 100)
}

func qtyText(_ qty: Double) -> String {
    if qty == qty.rounded() && abs(qty) < 1e12 { return Int(qty).formatted() }
    return String(format: "%.4f", qty)
}

// Relative age for list rows.
func relAge(_ epochMs: Double) -> String {
    guard epochMs > 0 else { return String(localized: "never") }
    let d = Date().timeIntervalSince1970 - epochMs / 1000
    if d < 60 { return String(localized: "just now") }
    if d < 3600 { return String(format: String(localized: "%d min ago"), Int(d / 60)) }
    if d < 86400 { return String(format: String(localized: "%d h ago"), Int(d / 3600)) }
    return String(format: String(localized: "%d d ago"), Int(d / 86400))
}

// Days until a dated event, from the reader's own day boundary.
func daysAway(_ date: Date) -> String {
    let cal = Calendar.current
    let days = cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: date)).day ?? 0
    if days == 0 { return String(localized: "today") }
    if days == 1 { return String(localized: "tomorrow") }
    if days < 0 { return String(format: String(localized: "%d d ago"), -days) }
    return String(format: String(localized: "in %d d"), days)
}

func shortDate(_ date: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale.autoupdatingCurrent
    f.dateFormat = "d MMM"
    return f.string(from: date)
}

// Every screen loads the same way, so it fails the same way too.
struct LoadState<Content: View>: View {
    let configured: Bool
    let error: String?
    let empty: Bool
    let emptyTitle: LocalizedStringKey
    let emptyHint: LocalizedStringKey
    let loading: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        if !configured {
            ContentUnavailableView("Setup needed", systemImage: "gearshape",
                                   description: Text("Enter the deployment URL and service key in Settings."))
        } else if let error {
            ContentUnavailableView("Could not load", systemImage: "wifi.exclamationmark", description: Text(error))
        } else if empty && !loading {
            ContentUnavailableView(emptyTitle, systemImage: "tray", description: Text(emptyHint))
        } else {
            content()
        }
    }
}


// Light / dark / follow the phone. Stored rather than derived because the
// point of the setting is to disagree with the system when the reader wants to.
enum ThemeChoice: String, CaseIterable, Identifiable {
    case system, light, dark

    static let storageKey = "appearance"

    var id: String { rawValue }

    var label: LocalizedStringKey {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
