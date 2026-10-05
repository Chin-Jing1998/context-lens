import AppKit
import WebKit

func validSession(_ value: String) -> Bool {
    value.range(of: "^(claude|codex):[a-zA-Z0-9_-]{1,100}$", options: .regularExpression) != nil
}

func clampedOrigin(_ point: NSPoint, size: NSSize, screen: NSRect) -> NSPoint {
    NSPoint(x: max(screen.minX, min(point.x, screen.maxX - size.width)),
            y: max(screen.minY, min(point.y, screen.maxY - size.height)))
}

@MainActor final class BallView: NSView {
    var toggle: (() -> Void)?
    var moved: (() -> Void)?
    var percent: Double?
    var client = "CL"
    private var mouseStart = NSPoint.zero
    private var windowStart = NSPoint.zero
    private var dragged = false
    override var acceptsFirstResponder: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel("Context Lens 悬浮球；点击展开，拖动移动，右键退出")
    }
    required init?(coder: NSCoder) { fatalError("Not used") }
    override func accessibilityPerformPress() -> Bool { toggle?(); return true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        mouseStart = window?.convertPoint(toScreen: event.locationInWindow) ?? NSEvent.mouseLocation
        windowStart = window?.frame.origin ?? .zero; dragged = false
    }
    override func mouseDragged(with event: NSEvent) {
        let mouse = window?.convertPoint(toScreen: event.locationInWindow) ?? NSEvent.mouseLocation
        if hypot(mouse.x - mouseStart.x, mouse.y - mouseStart.y) < 3 && !dragged { return }
        dragged = true
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main!
        let origin = NSPoint(x: windowStart.x + mouse.x - mouseStart.x, y: windowStart.y + mouse.y - mouseStart.y)
        window?.setFrameOrigin(clampedOrigin(origin, size: bounds.size, screen: screen.visibleFrame))
    }
    override func mouseUp(with event: NSEvent) { if dragged { moved?() } else { toggle?() } }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36 || event.characters == " " { toggle?() } else { super.keyDown(with: event) }
    }
    override func draw(_ dirtyRect: NSRect) {
        let disc = NSBezierPath(ovalIn: bounds.insetBy(dx: 3, dy: 3))
        NSColor.windowBackgroundColor.setFill(); disc.fill()
        let track = NSBezierPath(ovalIn: bounds.insetBy(dx: 6, dy: 6)); track.lineWidth = 3
        NSColor.separatorColor.setStroke(); track.stroke()
        if let p = percent {
            let ring = NSBezierPath(); ring.lineWidth = 3; ring.lineCapStyle = .round
            ring.appendArc(withCenter: NSPoint(x: bounds.midX, y: bounds.midY), radius: bounds.width / 2 - 6,
                           startAngle: 90, endAngle: 90 - CGFloat(min(100, max(0, p))) * 3.6, clockwise: true)
            (p >= 90 ? NSColor.systemRed : p >= 70 ? NSColor.systemOrange : NSColor.systemBlue).setStroke(); ring.stroke()
        }
        let text = percent.map { String(format: "%.0f%%", $0) } ?? "—"
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
        (text as NSString).draw(in: NSRect(x: 3, y: 27, width: bounds.width - 6, height: 20), withAttributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .semibold), .foregroundColor: NSColor.labelColor, .paragraphStyle: paragraph])
        (client as NSString).draw(in: NSRect(x: 4, y: 13, width: bounds.width - 8, height: 13), withAttributes: [
            .font: NSFont.systemFont(ofSize: 9, weight: .medium), .foregroundColor: NSColor.secondaryLabelColor, .paragraphStyle: paragraph])
    }
}

@MainActor final class DetailPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}

@MainActor final class LensApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var ball: NSPanel!
    private var ballView: BallView!
    private var panel: DetailPanel!
    private var web: WKWebView!
    private var status: NSStatusItem!
    private var backend: Process?
    private var timer: Timer?
    private var terminationSignal: DispatchSourceSignal?
    private var keyMonitor: Any?
    private var loading = false
    private var automatic = UserDefaults.standard.object(forKey: "automatic") as? Bool ?? true
    private var targetClient: String?
    private var targetPid: Int?
    private var origin: URL!
    private var selection = UserDefaults.standard.string(forKey: "session") ?? ""
    private var view = UserDefaults.standard.string(forKey: "view") == "model" ? "model" : "budget"

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !validSession(selection) { selection = "" }
        makeWindows()
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53, self?.panel.isVisible == true { self?.panel.orderOut(nil); return nil }
            return event
        }
        signal(SIGTERM, SIG_IGN)
        terminationSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        terminationSignal?.setEventHandler { NSApp.terminate(nil) }; terminationSignal?.resume()
        let notifications = NSWorkspace.shared.notificationCenter
        notifications.addObserver(self, selector: #selector(workspaceChanged(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        notifications.addObserver(self, selector: #selector(workspaceChanged(_:)), name: NSWorkspace.didLaunchApplicationNotification, object: nil)
        if let app = NSWorkspace.shared.frontmostApplication { follow(app) }
        Task { await connect() }
    }

    private func makeWindows() {
        let screen = NSScreen.main!.visibleFrame
        ball = NSPanel(contentRect: NSRect(x: screen.maxX - 90, y: screen.midY, width: 68, height: 68),
                       styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        ball.title = "Context Lens 悬浮球"; ball.level = .floating; ball.isOpaque = false; ball.backgroundColor = .clear
        ball.hasShadow = true; ball.hidesOnDeactivate = false; ball.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        ballView = BallView(frame: NSRect(x: 0, y: 0, width: 68, height: 68))
        ballView.toggle = { [weak self] in self?.togglePanel() }
        ballView.moved = { [weak self] in
            guard let self else { return }
            UserDefaults.standard.set(NSStringFromPoint(self.ball.frame.origin), forKey: "position")
        }
        if let saved = UserDefaults.standard.string(forKey: "position") {
            let point = NSPointFromString(saved)
            let display = NSScreen.screens.first { $0.visibleFrame.contains(point) }?.visibleFrame ?? screen
            ball.setFrameOrigin(clampedOrigin(point, size: ball.frame.size, screen: display))
        }
        let menu = NSMenu()
        let show = menu.addItem(withTitle: "展开 / 收起 Context Lens", action: #selector(togglePanel), keyEquivalent: ""); show.target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Context Lens", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        ballView.menu = menu; ball.contentView = ballView
        if !CommandLine.arguments.contains("--background") { ball.orderFrontRegardless() }
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "scope", accessibilityDescription: "Context Lens")
        status.menu = menu
        panel = DetailPanel(contentRect: NSRect(x: 0, y: 0, width: min(1000, screen.width - 100), height: min(860, screen.height - 80)),
                            styleMask: [.titled, .closable, .resizable, .utilityWindow], backing: .buffered, defer: false)
        panel.title = "Context Lens · 点击悬浮球收起"; panel.level = .floating; panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; panel.minSize = NSSize(width: 360, height: 480)
        panel.isReleasedWhenClosed = false; panel.delegate = self
        let config = WKWebViewConfiguration(); config.userContentController.add(self, name: "lens")
        web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self
        panel.contentView = web
    }

    @objc private func togglePanel() {
        if panel.isVisible { panel.orderOut(nil); return }
        let screen = ball.screen?.visibleFrame ?? NSScreen.main!.visibleFrame
        let size = panel.frame.size
        let point = NSPoint(x: ball.frame.minX - size.width - 12, y: ball.frame.maxY - size.height)
        panel.setFrameOrigin(clampedOrigin(point, size: size, screen: screen))
        NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); return false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { if !panel.isVisible { togglePanel() }; return true }
    func applicationWillTerminate(_ notification: Notification) { timer?.invalidate(); if backend?.isRunning == true { backend?.terminate() } }

    @objc private func workspaceChanged(_ notification: Notification) {
        if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication { follow(app) }
    }
    private func follow(_ app: NSRunningApplication) {
        let bundle = app.bundleIdentifier ?? ""
        if bundle == "com.openai.codex" { targetClient = "codex" }
        else if bundle == "com.anthropic.claudefordesktop" { targetClient = "claude" }
        else if ["com.apple.Terminal", "com.googlecode.iterm2", "com.mitchellh.ghostty", "dev.warp.Warp-Stable", "net.kovidgoyal.kitty", "org.alacritty"].contains(bundle) { targetClient = nil }
        else { return }
        targetPid = Int(app.processIdentifier)
        ball.orderFrontRegardless()
        Task { await refreshBall() }
    }

    private func json(_ url: URL) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 4))
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw URLError(.badServerResponse) }
        return object
    }
    private func healthy() async -> Bool {
        guard let data = try? await json(origin.appendingPathComponent("api/health")) else { return false }
        return data["app"] as? String == "context-lens" && data["protocol"] as? Int == 1
    }
    private func connect() async {
        do {
            guard let file = Bundle.main.url(forResource: "launch", withExtension: "json"),
                  let config = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any],
                  let port = config["port"] as? Int, (1...65535).contains(port) else { throw URLError(.badURL) }
            let runtime = Bundle.main.resourceURL!.appendingPathComponent("runtime")
            let node = runtime.appendingPathComponent("node").path
            let script = runtime.appendingPathComponent("scripts/context-lens.mjs").path
            origin = URL(string: "http://127.0.0.1:\(port)")!
            if !(await healthy()) {
                let process = Process(); process.executableURL = URL(fileURLWithPath: node)
                process.arguments = [script, "serve", "--port", String(port)]
                process.currentDirectoryURL = URL(fileURLWithPath: script).deletingLastPathComponent().deletingLastPathComponent()
                var environment = ProcessInfo.processInfo.environment
                if let home = config["home"] as? String { environment["CONTEXT_LENS_HOME"] = home }
                process.environment = environment; process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
                try process.run(); backend = process
                for _ in 0..<40 {
                    if await healthy() { break }
                    if !process.isRunning { throw URLError(.cannotConnectToHost) }
                    try await Task.sleep(nanoseconds: 200_000_000)
                }
                guard await healthy() else { throw URLError(.timedOut) }
            }
            var url = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
            url.queryItems = [URLQueryItem(name: "session", value: automatic ? "" : selection), URLQueryItem(name: "view", value: view), URLQueryItem(name: "automatic", value: automatic ? "1" : "0")]
            web.load(URLRequest(url: url.url!))
            timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in Task { @MainActor in await self?.refreshBall() } }
            await refreshBall()
        } catch {
            let alert = NSAlert(); alert.messageText = "Context Lens 无法启动本地服务"
            alert.informativeText = "请确认 Node.js 与仓库仍在原路径，端口未被其他程序占用。运行 context-lens serve 可查看具体错误。\n\(error.localizedDescription)"
            alert.addButton(withTitle: "退出"); NSApp.activate(ignoringOtherApps: true); alert.runModal(); NSApp.terminate(nil)
        }
    }

    private func refreshBall() async {
        guard !loading, origin != nil else { return }
        loading = true; defer { loading = false }
        if automatic {
            let followedPid = targetPid; let followedClient = targetClient
            var url = URLComponents(url: origin.appendingPathComponent("api/active"), resolvingAgainstBaseURL: false)!
            url.queryItems = []
            if let targetClient { url.queryItems?.append(URLQueryItem(name: "client", value: targetClient)) }
            if let targetPid { url.queryItems?.append(URLQueryItem(name: "pid", value: String(targetPid))) }
            let data = try? await json(url.url!)
            guard automatic && followedPid == targetPid && followedClient == targetClient else { return }
            selection = data?["selected"] as? String ?? ""
            let reason = data?["reason"] as? String ?? "无法定位活跃会话，请检查本地服务"
            let detail = ["session": selection, "reason": reason]
            if let encoded = try? JSONSerialization.data(withJSONObject: detail, options: [.fragmentsAllowed]), let js = String(data: encoded, encoding: .utf8) {
                _ = try? await web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('context-lens-active',{detail:\(js)}))")
            }
            if validSession(selection) { ball.orderFrontRegardless() }
        }
        guard validSession(selection) else { updateBall(nil, client: "CL", help: "点击选择 Claude / Codex 会话"); return }
        let key = selection; let mode = view
        var url = URLComponents(url: origin.appendingPathComponent("api/snapshot"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "session", value: key), URLQueryItem(name: "view", value: mode)]
        do {
            let data = try await json(url.url!)
            guard key == selection && mode == view else { return }
            let context = data["context"] as? [String: Any] ?? [:]
            let percent = (context["percent"] as? NSNumber)?.doubleValue
            let value = percent.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
            let budget = context["budget"] as? [String: Any] ?? [:]
            updateBall(value, client: key.hasPrefix("claude:") ? "CLAUDE" : "CODEX",
                       help: "\(key)\n\(mode == "budget" ? "Autocompact 预算" : "模型窗口") · \(budget["accuracy"] as? String ?? "unknown")\n点击展开完整统计")
        } catch {
            if key == selection { updateBall(nil, client: "离线", help: "连接中断或会话已移除；点击展开检查") }
        }
    }
    private func updateBall(_ percent: Double?, client: String, help: String) {
        ballView.percent = percent; ballView.client = client; ballView.toolTip = help; ballView.needsDisplay = true
        ballView.setAccessibilityValue(percent.map { String(format: "%@ %.1f%%", client, $0) } ?? "\(client) 未知")
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "http",
              message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == origin?.port,
              let body = message.body as? [String: String], let key = body["session"], key.isEmpty || validSession(key) else { return }
        selection = key; view = body["view"] == "model" ? "model" : "budget"
        automatic = body["automatic"] == "1"; UserDefaults.standard.set(automatic, forKey: "automatic")
        UserDefaults.standard.set(selection, forKey: "session"); UserDefaults.standard.set(view, forKey: "view")
        Task { await refreshBall() }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { Task { await refreshBall() } }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == origin?.port ? .allow : .cancel)
    }
}

@main struct ContextLens {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--self-test") {
            precondition(validSession("codex:abc-123")); precondition(!validSession("codex:../credentials")); precondition(!validSession("https://example.com"))
            precondition(clampedOrigin(NSPoint(x: -10, y: 200), size: NSSize(width: 68, height: 68), screen: NSRect(x: 0, y: 0, width: 100, height: 100)) == NSPoint(x: 0, y: 32))
            print("Context Lens desktop checks passed")
        } else {
            let app = NSApplication.shared
            let delegate = LensApp(); app.delegate = delegate; app.setActivationPolicy(.accessory); app.run()
        }
    }
}
