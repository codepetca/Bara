import Foundation

enum DisplayState: String {
    case closed, readable
}

enum DisplayPolicy {
    static let url = URL(string: "https://bara.codepet.ca/display")!

    // Query strings and fragments do not change the document's origin or path.
    static func isDisplayDocument(_ url: URL?) -> Bool {
        guard let url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme?.lowercased() == "https"
            && parts.host?.lowercased() == "bara.codepet.ca"
            && (parts.port == nil || parts.port == 443)
            && parts.user == nil && parts.password == nil
            && parts.percentEncodedPath == "/display"
    }

    static func brightness(for state: DisplayState?, baseline: CGFloat) -> CGFloat {
        state == .closed ? min(baseline, 0.20) : max(baseline, 0.55)
    }

    static func state(body: Any, isExpectedWebView: Bool, isMainFrame: Bool,
                      originScheme: String, originHost: String, originPort: Int,
                      frameURL: URL?, currentURL: URL?) -> DisplayState? {
        guard isExpectedWebView, isMainFrame,
              originScheme.lowercased() == "https", originHost.lowercased() == "bara.codepet.ca",
              originPort == 0 || originPort == 443, isDisplayDocument(frameURL),
              isDisplayDocument(currentURL), let value = body as? String else { return nil }
        return DisplayState(rawValue: value)
    }
}
