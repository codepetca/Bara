import XCTest
@testable import BaraDisplay

final class DisplayPolicyTests: XCTestCase {
    func testDocumentBoundary() {
        XCTAssertTrue(DisplayPolicy.isDisplayDocument(URL(string: "https://bara.codepet.ca:443/display?x=1#screen")))
        for value in ["http://bara.codepet.ca/display", "https://evil.example/display", "https://bara.codepet.ca:444/display", "https://bara.codepet.ca/display/", "https://bara.codepet.ca/display%2F"] {
            XCTAssertFalse(DisplayPolicy.isDisplayDocument(URL(string: value)), value)
        }
    }

    func testBrightness() {
        XCTAssertEqual(DisplayPolicy.brightness(for: .closed, baseline: 0.8), 0.2)
        XCTAssertEqual(DisplayPolicy.brightness(for: .closed, baseline: 0.1), 0.1)
        XCTAssertEqual(DisplayPolicy.brightness(for: .readable, baseline: 0.1), 0.55)
        XCTAssertEqual(DisplayPolicy.brightness(for: nil, baseline: 0.8), 0.8)
    }

    func testMessageBoundary() {
        let url = DisplayPolicy.url
        XCTAssertNil(DisplayPolicy.state(body: "closed", isExpectedWebView: true, isMainFrame: true, originScheme: "https", originHost: "evil.example", originPort: 443, frameURL: url, currentURL: url))
        XCTAssertNil(DisplayPolicy.state(body: "closed", isExpectedWebView: true, isMainFrame: true, originScheme: "https", originHost: "bara.codepet.ca", originPort: 444, frameURL: url, currentURL: url))
        XCTAssertEqual(DisplayPolicy.state(body: "closed", isExpectedWebView: true, isMainFrame: true, originScheme: "https", originHost: "bara.codepet.ca", originPort: 443, frameURL: url, currentURL: url), .closed)
        XCTAssertEqual(DisplayPolicy.state(body: "readable", isExpectedWebView: true, isMainFrame: true, originScheme: "https", originHost: "bara.codepet.ca", originPort: 443, frameURL: url, currentURL: url), .readable)
        XCTAssertNil(DisplayPolicy.state(body: "Closed", isExpectedWebView: true, isMainFrame: true, originScheme: "https", originHost: "bara.codepet.ca", originPort: 443, frameURL: url, currentURL: url))
        XCTAssertNil(DisplayPolicy.state(body: "closed", isExpectedWebView: false, isMainFrame: true, originScheme: "https", originHost: "bara.codepet.ca", originPort: 443, frameURL: url, currentURL: url))
        XCTAssertNil(DisplayPolicy.state(body: "closed", isExpectedWebView: true, isMainFrame: false, originScheme: "https", originHost: "bara.codepet.ca", originPort: 443, frameURL: url, currentURL: url))
        XCTAssertNil(DisplayPolicy.state(body: "closed", isExpectedWebView: true, isMainFrame: true, originScheme: "https", originHost: "bara.codepet.ca", originPort: 443, frameURL: url, currentURL: URL(string: "https://evil.example/display")))
    }
}
