import UIKit
import WebKit

final class DisplayViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private static let displayStateHandler = "baraDisplayState"
    private var webView: WKWebView!
    private let retryButton = UIButton(type: .system)
    private var originalBrightness: CGFloat?
    private var originalIdleTimerDisabled: Bool?
    private var displayState: DisplayState?
    private var retryCount = 0
    private var retryWork: DispatchWorkItem?
    private let retryDelays: [TimeInterval] = [2, 5, 15, 60, 120]
    private var active = false
    private var activeScreen: UIScreen?
    private var needsFreshDisplay = false
    private var hasCommittedDisplay = false

    override var prefersStatusBarHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: Self.displayStateHandler)
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        retryButton.setTitle("Unable to load display. Tap to retry.", for: .normal)
        retryButton.backgroundColor = .systemBackground
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.isHidden = true
        view.addSubview(retryButton)
        NSLayoutConstraint.activate([
            retryButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            retryButton.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            retryButton.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -40)
        ])
        loadDisplay()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        restoreDeviceSettings()
    }

    func activate(on screen: UIScreen) {
        guard !active else { return }
        active = true
        activeScreen = screen
        originalBrightness = screen.brightness
        originalIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        if needsFreshDisplay {
            needsFreshDisplay = false
            loadDisplay()
            return
        }
        applyBrightness()
        if retryButton.isHidden == false { scheduleRetry() }
    }

    func deactivate() { restoreDeviceSettings() }

    func invalidateAfterBackgrounding() {
        // An idle result from before suspension may no longer describe this room.
        needsFreshDisplay = true
        hasCommittedDisplay = false
        displayState = nil
    }

    func disconnect() {
        deactivate()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.displayStateHandler)
    }

    private func restoreDeviceSettings() {
        guard active else { return }
        active = false
        retryWork?.cancel()
        retryWork = nil
        if let brightness = originalBrightness { activeScreen?.brightness = brightness }
        if let idle = originalIdleTimerDisabled { UIApplication.shared.isIdleTimerDisabled = idle }
        originalBrightness = nil
        activeScreen = nil
        originalIdleTimerDisabled = nil
    }

    private func applyBrightness() {
        guard active, let baseline = originalBrightness, let screen = activeScreen else { return }
        screen.brightness = DisplayPolicy.brightness(for: displayState, baseline: baseline)
    }

    private func loadDisplay() {
        retryWork?.cancel()
        retryWork = nil
        hasCommittedDisplay = false
        displayState = nil
        applyBrightness()
        webView.load(URLRequest(url: DisplayPolicy.url))
    }

    @objc private func retryTapped() {
        retryCount = 0
        retryButton.isHidden = true
        loadDisplay()
    }

    private func failed() {
        hasCommittedDisplay = false
        displayState = nil
        applyBrightness()
        retryButton.isHidden = false
        scheduleRetry()
    }

    private func scheduleRetry() {
        guard active, retryWork == nil else { return }
        let delay = retryDelays[min(retryCount, retryDelays.count - 1)]
        retryCount = min(retryCount + 1, retryDelays.count - 1)
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.active else { return }
            self.retryWork = nil
            self.loadDisplay()
        }
        retryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard hasCommittedDisplay, !needsFreshDisplay,
              let state = DisplayPolicy.state(body: message.body, isExpectedWebView: message.webView === webView,
                                              isMainFrame: message.frameInfo.isMainFrame,
                                              originScheme: message.frameInfo.securityOrigin.protocol,
                                              originHost: message.frameInfo.securityOrigin.host,
                                              originPort: message.frameInfo.securityOrigin.port,
                                              frameURL: message.frameInfo.request.url, currentURL: webView.url) else { return }
        displayState = state
        applyBrightness()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.targetFrame?.isMainFrame == true,
              DisplayPolicy.isDisplayDocument(navigationAction.request.url) else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard navigationResponse.isForMainFrame,
              DisplayPolicy.isDisplayDocument(navigationResponse.response.url),
              let response = navigationResponse.response as? HTTPURLResponse,
              (200..<400).contains(response.statusCode) else {
            decisionHandler(.cancel)
            failed()
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        hasCommittedDisplay = false
        displayState = nil
        applyBrightness()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        hasCommittedDisplay = DisplayPolicy.isDisplayDocument(webView.url)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retryCount = 0
        retryWork?.cancel()
        retryWork = nil
        retryButton.isHidden = true
    }

    private func handleNavigationError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        failed()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { handleNavigationError(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { handleNavigationError(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failed() }
}
