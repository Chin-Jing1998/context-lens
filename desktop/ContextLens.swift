import AppKit
import WebKit
import ApplicationServices
import CoreText

@MainActor var lensReduceMotion: Bool {
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion || UserDefaults.standard.bool(forKey: "reduceMotion")
}

func validSession(_ value: String) -> Bool {
    value.range(of: "^(claude|codex|agy|opencode|mimocode|deepseek|zcode):[a-zA-Z0-9_-]{1,100}$", options: .regularExpression) != nil
}

func agentClient(bundle: String, name: String) -> String? {
    if bundle == "com.openai.codex" { return "codex" }
    if bundle == "com.anthropic.claudefordesktop" { return "claude" }
    if bundle == "com.google.antigravity" { return "agy" }
    let lower = name.lowercased().replacingOccurrences(of: " ", with: "")
    if lower == "opencode" { return "opencode" }
    if lower == "mimocode" { return "mimocode" }
    if lower == "deepseekharness" || lower == "dsh" { return "deepseek" }
    if lower == "zcode" { return "zcode" }
    return nil
}
struct FrontmostSession: Equatable {
    var id = "", title = "", cwd = "", tty = ""
    var query: [URLQueryItem] {
        [("visibleId", id), ("visibleTitle", title), ("cwd", cwd), ("tty", tty)].filter { !$0.1.isEmpty }.map { URLQueryItem(name: $0.0, value: $0.1) }
    }
}
func visibleSessionId(_ value: String) -> String? {
    guard value.utf8.count <= 8192 else { return nil }
    let route = value.components(separatedBy: CharacterSet(charactersIn: "?#")).first ?? value
    let codeRoute = route.contains("/code/") || route.contains("/epitaxy/")
    if codeRoute && value.rangeOfCharacter(from: .controlCharacters) != nil { return nil }
    let candidate = codeRoute ? route : value
    let pattern = codeRoute
        ? "/(?:code|epitaxy)/(local_[a-zA-Z0-9_-]{1,94})/?$"
        : "(?:/(?:threads?|sessions?|chats?|conversations?)/|(?:thread|session|chat)[-_:])([a-zA-Z0-9_-]{1,100})(?:[/?#]|$)"
    guard let expression = try? NSRegularExpression(pattern: pattern),
          let match = expression.firstMatch(in: candidate, range: NSRange(candidate.startIndex..., in: candidate)),
          let range = Range(match.range(at: 1), in: candidate) else { return nil }
    return String(candidate[range])
}
func antigravitySessionId(_ value: String) -> String? {
    guard !value.isEmpty, value.utf8.count <= 8192, !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
          let url = URLComponents(string: value), ["http", "https"].contains(url.scheme ?? ""),
          ["127.0.0.1", "localhost", "[::1]"].contains(url.host ?? ""), url.user == nil, url.password == nil,
          url.percentEncodedPath.range(of: #"^/c/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/?$"#,
                                       options: .regularExpression) != nil else { return nil }
    return String(url.percentEncodedPath.dropFirst(3).prefix(36)).lowercased()
}
// Read navigation identity only. The injected reader is shared with native fixtures.
typealias SessionAXRead = (error: AXError, value: CFTypeRef?)
func navigationSession(_ root: AXUIElement, pid: pid_t, client: String?, appName: String,
                       read: (AXUIElement, String) -> SessionAXRead, foreground: () -> pid_t?,
                       now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) -> FrontmostSession {
    guard foreground() == pid else { return FrontmostSession() }
    let deadline = now() + 0.18
    var incomplete = false
    func attribute(_ element: AXUIElement, _ name: String) -> SessionAXRead {
        guard now() < deadline else { incomplete = true; return (.cannotComplete, nil) }
        let result = read(element, name)
        if ![AXError.success, .noValue, .attributeUnsupported].contains(result.error) { incomplete = true }
        return result
    }
    func value(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        let result = attribute(element, name); return result.error == .success ? result.value : nil
    }
    func string(_ element: AXUIElement, _ name: String) -> String { (value(element, name) as? String) ?? "" }
    func flag(_ element: AXUIElement, _ name: String) -> Bool? {
        guard let value = value(element, name), CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }; return value as? Bool
    }
    func element(_ value: CFTypeRef?) -> AXUIElement? {
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }; return (value as! AXUIElement)
    }
    func urlString(_ value: CFTypeRef?) -> String {
        if let url = value as? URL { return url.absoluteString }; return (value as? String) ?? ""
    }
    func navigationId(_ address: String) -> String? {
        if client == "agy" { return antigravitySessionId(address) }
        guard let id = visibleSessionId(address), client != "codex" || !id.hasPrefix("local_") else { return nil }
        return id
    }
    func title(_ value: String) -> String {
        let normalized = value.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, value.count <= 200,
              normalized.caseInsensitiveCompare(appName) != .orderedSame else { return "" }; return normalized
    }
    let focused = attribute(root, kAXFocusedWindowAttribute)
    let window: AXUIElement
    if focused.error == .noValue {
        guard foreground() == pid, let main = element(value(root, kAXMainWindowAttribute)),
              string(main, kAXRoleAttribute) == "AXWindow", let minimized = value(main, kAXMinimizedAttribute),
              CFGetTypeID(minimized) == CFBooleanGetTypeID(), (minimized as? Bool) == false else { return FrontmostSession() }
        window = main
    } else {
        guard focused.error == .success, let found = element(focused.value), string(found, kAXRoleAttribute) == "AXWindow" else { return FrontmostSession() }
        window = found
    }
    var result = FrontmostSession()
    let document = urlString(value(window, kAXDocumentAttribute))
    let documentId = navigationId(document)
    if let url = URL(string: document), url.isFileURL { result.cwd = url.path }
    let rawWindowTitle = string(window, kAXTitleAttribute)
    if let tty = rawWindowTitle.range(of: "ttys?\\d{1,6}", options: .regularExpression) { result.tty = String(rawWindowTitle[tty]) }
    var windowTitle = rawWindowTitle
    for suffix in [" — " + appName, " - " + appName] { if windowTitle.hasSuffix(suffix) { windowTitle = String(windowTitle.dropLast(suffix.count)) } }
    windowTitle = client == nil ? "" : title(windowTitle)
    var ids = Set(documentId.map { [$0] } ?? []), selectedTitles = Set<String>(), headings = Set<String>(), chatTabs: [String] = []
    var queue: [(AXUIElement, Int, String, Bool)] = [(window, 0, "", false)], cursor = 0, mainWebAreas = 0
    while cursor < queue.count && cursor < 900 && now() < deadline {
        let (node, depth, parentRole, insideWeb) = queue[cursor]; cursor += 1
        let role = string(node, kAXRoleAttribute)
        if role.isEmpty { incomplete = true; continue }
        if ["AXTextArea", "AXTextField", "AXSecureTextField", "AXStaticText", "AXLink"].contains(role)
            || role == "AXHeading" && (depth > 10 || insideWeb) { continue }
        var inWeb = insideWeb
        if role == "AXWebArea" {
            if insideWeb { continue } // An embedded preview is not the main document.
            let address = urlString(value(node, kAXURLAttribute))
            if client == "agy" {
                if let id = navigationId(address) { ids.insert(id) }
                continue
            }
            // Claude 的本地桌面壳层不承载会话，其子树也不能提供会话身份。
            if client == "claude", let url = URL(string: address), url.isFileURL,
               url.path.hasSuffix(".app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html"),
               url.query == nil, url.fragment == nil { continue }
            if client != "codex" { mainWebAreas += 1 }
            inWeb = true
            if let id = navigationId(address) {
                ids.insert(id)
                if client == "codex" { mainWebAreas += 1 }
                if client == "claude" { continue }
            }
        }
        if client == "codex", role == "AXRadioButton", parentRole == "AXTabGroup",
           flag(node, kAXSelectedAttribute) == true,
           string(node, "AXDOMIdentifier").hasSuffix("-chat-tab") {
            let identifier = string(node, "AXDOMIdentifier")
            let pattern = #"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?=-chat-tab$)"#
            if let range = identifier.range(of: pattern, options: .regularExpression) { ids.insert(String(identifier[range])) }
            chatTabs.append(title(string(node, kAXTitleAttribute)))
        }
        if depth <= 10 && client != "agy" {
            let identifier = string(node, kAXIdentifierAttribute), selected = flag(node, kAXSelectedAttribute) == true
            if let id = navigationId(identifier), selected || role == "AXHeading" && !inWeb { ids.insert(id) }
            if selected && (role == "AXRow" || parentRole == "AXOutline" || identifier.lowercased().contains("thread")) {
                let current = title(string(node, kAXTitleAttribute)); if !current.isEmpty { selectedTitles.insert(current) }
            }
            if role == "AXHeading", !inWeb { let current = title(string(node, kAXTitleAttribute)); if !current.isEmpty { headings.insert(current) } }
        }
        if let children = value(node, kAXChildrenAttribute) as? [AXUIElement], !children.isEmpty {
            if depth >= 24 { incomplete = true; continue }
            if children.count > 120 { incomplete = true }
            queue.append(contentsOf: children.prefix(120).map { ($0, depth + 1, role, inWeb) })
        }
    }
    if cursor < queue.count || now() >= deadline { incomplete = true }
    guard foreground() == pid else { return FrontmostSession() }
    if client == "agy" {
        if ids.count == 1 && (documentId != nil || !incomplete) { result.id = ids.first! }
        return result
    }
    // Observed conflicts are never repaired by choosing the traversal's first match.
    guard mainWebAreas <= 1, chatTabs.count <= 1, ids.count <= 1 else { return FrontmostSession() }
    if ids.isEmpty, let tab = chatTabs.first, !tab.isEmpty, !windowTitle.isEmpty, tab != windowTitle { return FrontmostSession() }
    if incomplete {
        // Direct window metadata does not depend on the uniqueness of a partial tree.
        result.id = documentId ?? ""
        result.title = documentId == nil ? (client == "codex" ? chatTabs.first ?? windowTitle : windowTitle) : ""
        return result
    }
    if let id = ids.first { result.id = id }
    else if let tab = chatTabs.first, !tab.isEmpty { result.title = tab }
    else if selectedTitles.count == 1 { result.title = selectedTitles.first! }
    else if !windowTitle.isEmpty { result.title = windowTitle }
    else if headings.count == 1 { result.title = headings.first! }
    return result
}
func frontmostSession(_ app: NSRunningApplication, client: String?) -> FrontmostSession {
    guard AXIsProcessTrusted() else { return FrontmostSession() }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 0.03)
    return navigationSession(root, pid: app.processIdentifier, client: client, appName: app.localizedName ?? "",
        read: { element, name in
            var value: CFTypeRef?
            let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
            return (error, value)
        }, foreground: { NSWorkspace.shared.frontmostApplication?.processIdentifier })
}

func checkNavigationFixtures() {
    var nodes: [(AXUIElement, [String: CFTypeRef])] = [], errors: [String: AXError] = [:], calls: [String] = []
    var activePID: pid_t = 42, clock = 0.0, timeoutAt = "", switchAt = ""
    func node(_ fields: [String: CFTypeRef]) -> AXUIElement {
        let item = AXUIElementCreateApplication(pid_t(900000 + nodes.count)); nodes.append((item, fields)); return item
    }
    func index(_ item: AXUIElement) -> Int { nodes.firstIndex { CFEqual($0.0, item) }! }
    func key(_ item: AXUIElement, _ name: String) -> String { "\(index(item)):\(name)" }
    func set(_ item: AXUIElement, _ name: String, _ value: CFTypeRef?) { nodes[index(item)].1[name] = value }
    func children(_ item: AXUIElement, _ values: [AXUIElement]) { set(item, kAXChildrenAttribute, values as CFArray) }
    func check(_ condition: Bool, _ message: String) {
        if !condition { FileHandle.standardError.write(Data("[navigation-fixture] \(message)\n".utf8)) }; precondition(condition, message)
    }
    let window = node([kAXRoleAttribute: "AXWindow" as CFString]), root = node([:])
    func reset(_ title: String = "Window fallback") {
        nodes[index(window)].1 = [kAXRoleAttribute: "AXWindow" as CFString, kAXTitleAttribute: title as CFString]
        nodes[index(root)].1 = [kAXFocusedWindowAttribute: window]
        errors = [:]; calls = []; activePID = 42; clock = 0; timeoutAt = ""; switchAt = ""
    }
    func collect(_ client: String = "codex") -> FrontmostSession {
        navigationSession(root, pid: 42, client: client, appName: client == "codex" ? "Codex" : "Claude", read: { item, name in
            let requested = key(item, name); calls.append(requested)
            if requested == timeoutAt { clock = 1 }; if requested == switchAt { activePID = 99 }
            if let error = errors[requested] { return (error, nil) }
            if let value = nodes[index(item)].1[name] { return (.success, value) }; return (.attributeUnsupported, nil)
        }, foreground: { activePID }, now: { clock })
    }
    func place(_ leaf: AXUIElement, depth: Int, parent: String = "AXGroup") {
        var current = node([kAXRoleAttribute: parent as CFString, kAXChildrenAttribute: [leaf] as CFArray])
        if depth > 2 { for _ in 0..<(depth - 2) { current = node([kAXRoleAttribute: "AXGroup" as CFString, kAXChildrenAttribute: [current] as CFArray]) } }
        children(window, [current])
    }
    reset(); check(collect().title == "Window fallback", "The direct window title remains a fallback")
    errors[key(root, kAXFocusedWindowAttribute)] = .noValue
    set(root, kAXMainWindowAttribute, window); set(window, kAXMinimizedAttribute, kCFBooleanFalse)
    check(collect().title == "Window fallback" && calls.filter { $0 == key(root, kAXMainWindowAttribute) }.count == 1, "Focused noValue permits exactly one valid MainWindow read")
    for minimized: CFTypeRef? in [kCFBooleanTrue, nil, NSNumber(value: 0)] {
        set(window, kAXMinimizedAttribute, minimized); check(collect().title.isEmpty, "MainWindow must explicitly report Boolean false for minimized")
    }
    set(window, kAXMinimizedAttribute, kCFBooleanFalse); set(window, kAXRoleAttribute, "AXGroup" as CFString)
    check(collect().title.isEmpty, "MainWindow must have AXWindow role")
    set(window, kAXRoleAttribute, "AXWindow" as CFString); set(root, kAXMainWindowAttribute, "not an element" as CFString)
    check(collect().title.isEmpty, "A non-element MainWindow is rejected")
    for error in [AXError.apiDisabled, .cannotComplete, .attributeUnsupported] {
        reset(); errors[key(root, kAXFocusedWindowAttribute)] = error; set(root, kAXMainWindowAttribute, window)
        check(collect().title.isEmpty && !calls.contains(key(root, kAXMainWindowAttribute)), "Focused errors do not enumerate or fall back to MainWindow")
    }
    reset(); set(root, kAXFocusedWindowAttribute, "wrong type" as CFString)
    check(collect().title.isEmpty, "A non-element FocusedWindow is rejected")

    let web = node([kAXRoleAttribute: "AXWebArea" as CFString])
    for value: CFTypeRef in [NSURL(string: "https://claude.ai/code/local_url")!, "/code/local_string" as CFString,
                             NSURL(string: "app://claude/epitaxy/local_epitaxy")!, "/epitaxy/local_string?view=code" as CFString] {
        reset(); set(web, kAXURLAttribute, value); children(window, [web])
        check(collect("claude").id.hasPrefix("local_"), "Main WebArea accepts CFURL and String route values")
    }
    for route in ["/epitaxy/local_valid", "/epitaxy/local_valid/", "/epitaxy/local_valid?view=code", "/epitaxy/local_valid#details"] {
        check(visibleSessionId(route) == "local_valid", "epitaxy 路由保留严格的本地会话 ID")
    }
    for route in ["/epitaxy/invalid", "/epitaxy/local_", "/epitaxy/local_valid/extra", "/epitaxy/local_valid\n",
                  "/epitaxy/invalid?redirect=/code/local_query", "/code/invalid#redirect=/epitaxy/local_fragment",
                  "/epitaxy/local_" + String(repeating: "x", count: 95)] {
        check(visibleSessionId(route) == nil, "epitaxy 路由拒绝非法、超长或嵌套会话 ID")
    }
    let shellURL = "file:///Applications/Claude.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html"
    let shellHeading = node([kAXRoleAttribute: "AXHeading" as CFString, kAXIdentifierAttribute: "/code/local_shell" as CFString])
    let shell = node([kAXRoleAttribute: "AXWebArea" as CFString, kAXURLAttribute: shellURL as CFString,
                      kAXChildrenAttribute: [shellHeading] as CFArray])
    reset("Claude"); set(web, kAXURLAttribute, "app://claude/epitaxy/local_active" as CFString)
    for ordered in [[shell, web], [web, shell]] {
        children(window, ordered)
        check(collect("claude").id == "local_active" && !calls.contains(key(shellHeading, kAXRoleAttribute)), "Claude 本地壳层及其内容不参与会话身份选择")
    }
    check(collect("codex").id.isEmpty, "壳层排除仅适用于 Claude")
    for address in ["file:///tmp/index.html", "https://example.invalid/Contents/Resources/app.asar/.vite/renderer/main_window/index.html"] {
        set(shell, kAXURLAttribute, address as CFString)
        check(collect("claude").id.isEmpty, "普通文件或远程网页不能冒充本地桌面壳层")
    }
    set(shell, kAXURLAttribute, shellURL as CFString)
    let other = node([kAXRoleAttribute: "AXWebArea" as CFString, kAXURLAttribute: "/epitaxy/local_other" as CFString])
    children(window, [shell, web, other])
    check(collect("claude").id.isEmpty && collect("claude").title.isEmpty, "壳层排除后仍拒绝两个实际会话页面")
    var body = node([kAXRoleAttribute: "AXGroup" as CFString])
    for _ in 0..<25 { body = node([kAXRoleAttribute: "AXGroup" as CFString, kAXChildrenAttribute: [body] as CFArray]) }
    reset("Claude"); children(web, [body]); children(window, [web])
    check(collect("claude").id == "local_active" && !calls.contains(key(body, kAXRoleAttribute)), "主网页路由确认身份后不遍历对话正文，也不受正文深度影响")
    check(collect("codex").id.isEmpty, "正文子树剪枝仅适用于 Claude")
    children(web, [])
    let nested = node([kAXRoleAttribute: "AXWebArea" as CFString, kAXURLAttribute: "/code/local_nested" as CFString])
    reset(); set(web, kAXURLAttribute, "app://-/index.html" as CFString); children(web, [nested]); children(window, [web])
    check(collect("claude").id.isEmpty && !calls.contains(key(nested, kAXURLAttribute)), "Embedded preview WebAreas are never identity sources")
    let link = node([kAXRoleAttribute: "AXLink" as CFString, kAXURLAttribute: "/code/local_link" as CFString])
    reset(); children(link, [nested]); children(window, [link])
    check(collect("claude").id.isEmpty && !calls.contains(key(link, kAXURLAttribute)), "An ordinary link route cannot become a visible identity")
    reset(); children(web, []); set(web, kAXURLAttribute, "/code/local_url" as CFString); children(window, [web, nested])
    check(collect("claude").id.isEmpty && collect("claude").title.isEmpty, "Multiple outer WebAreas reject the identity")
    reset(); set(window, kAXDocumentAttribute, "/code/local_document" as CFString); children(window, [web])
    check(collect("claude").id.isEmpty && collect("claude").title.isEmpty, "Conflicting direct document and WebArea routes reject the identity")

    let tab = node([kAXRoleAttribute: "AXRadioButton" as CFString, kAXSelectedAttribute: kCFBooleanTrue,
                    "AXDOMIdentifier": "_r_ubc_-chat-tab" as CFString, kAXTitleAttribute: "Current chat" as CFString])
    reset("Codex"); place(tab, depth: 17, parent: "AXTabGroup")
    check(collect().title == "Current chat", "The strict selected Codex chat tab is readable at actual depth 17")
    reset(" \tCurrent \t chat \n"); place(tab, depth: 17, parent: "AXTabGroup")
    set(tab, kAXTitleAttribute, " \nCurrent  chat\t " as CFString)
    check(collect().title == "Current chat", "Whitespace-equivalent chat and window titles share a normalized identity")
    set(tab, kAXTitleAttribute, "Current chat" as CFString)
    reset("Codex"); place(tab, depth: 17, parent: "AXTabGroup")
    for (field, value) in [(kAXRoleAttribute, "AXButton" as CFTypeRef), (kAXSelectedAttribute, kCFBooleanFalse as CFTypeRef),
                           (kAXSelectedAttribute, NSNumber(value: 1) as CFTypeRef), ("AXDOMIdentifier", "settings-tab" as CFTypeRef), (kAXTitleAttribute, "" as CFTypeRef)] {
        let prior = nodes[index(tab)].1[field]; set(tab, field, value)
        check(collect().title.isEmpty, "Each strict chat-tab condition is required"); set(tab, field, prior)
    }
    place(tab, depth: 17, parent: "AXGroup"); check(collect().title.isEmpty, "A selected radio outside its direct TabGroup is rejected")
    place(tab, depth: 17, parent: "AXTabGroup"); check(collect("claude").title == "Codex", "The new chat-tab branch is limited to Codex")
    reset("Window fallback"); place(tab, depth: 17, parent: "AXTabGroup")
    check(collect().title.isEmpty, "A strict chat title conflicting with the window title is rejected")
    let second = node(nodes[index(tab)].1)
    reset("Codex"); children(window, [node([kAXRoleAttribute: "AXTabGroup" as CFString, kAXChildrenAttribute: [tab, second] as CFArray])])
    check(collect().title.isEmpty, "Two selected chat-tab nodes are ambiguous even with identical titles")
    reset("Current chat"); place(tab, depth: 17, parent: "AXTabGroup")
    let deepHeading = node([kAXRoleAttribute: "AXHeading" as CFString, kAXTitleAttribute: "Message Markdown heading" as CFString, kAXValueAttribute: "message body" as CFString])
    let tabChain = nodes[index(window)].1[kAXChildrenAttribute] as! [AXUIElement]
    place(deepHeading, depth: 17); let headingChain = nodes[index(window)].1[kAXChildrenAttribute] as! [AXUIElement]
    children(window, tabChain + headingChain)
    check(collect().title == "Current chat" && !calls.contains(key(deepHeading, kAXTitleAttribute)) && !calls.contains(where: { $0.hasSuffix(":" + kAXValueAttribute) }), "Deep Markdown headings and message values are not read")

    reset(); children(window, [web] + (0..<121).map { _ in node([kAXRoleAttribute: "AXGroup" as CFString]) })
    let capped = collect("claude")
    check(capped.id.isEmpty && capped.title == "Window fallback", "A partial child scan cannot declare its first WebArea globally unique")
    reset(); place(tab, depth: 17, parent: "AXTabGroup")
    let partialTab = nodes[index(window)].1[kAXChildrenAttribute] as! [AXUIElement]
    children(window, partialTab + (0..<121).map { _ in node([kAXRoleAttribute: "AXGroup" as CFString]) })
    check(collect().title.isEmpty, "An observed conflicting chat title stays rejected even if the tree is truncated")
    let timedSibling = node([kAXRoleAttribute: "AXGroup" as CFString])
    reset(); children(window, [web, timedSibling]); timeoutAt = key(timedSibling, kAXChildrenAttribute)
    let timed = collect("claude")
    check(timed.id.isEmpty && timed.title == "Window fallback", "A time-truncated tree only retains direct window metadata")
    reset(); activePID = 99; check(collect().title.isEmpty && calls.isEmpty, "A different initial foreground PID prevents all AX reads")
    reset(); switchAt = key(window, kAXTitleAttribute)
    check(collect().title.isEmpty, "A foreground PID change during collection discards all identity")
}

func shortNumber(_ value: Double) -> String {
    if value >= 1_000_000 { return String(format: "%.1fM", value / 1_000_000) }
    if value >= 1_000 { return String(format: "%.1fk", value / 1_000) }
    return String(format: "%.0f", value)
}

func contextPercent(_ context: [String: Any], client: String) -> Double? {
    let value = (context[client == "claude" ? "windowPercent" : "percent"] as? NSNumber)?.doubleValue
    return value.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
}

func contextReading(_ percent: Double?, usedTokens: Double?) -> String {
    if let value = percent, value.isFinite, value >= 0 { return String(format: "%.1f%%", value) }
    if let value = usedTokens, value.isFinite, value >= 0 { return shortNumber(value) }
    return "—"
}

func clampedOrigin(_ point: NSPoint, size: NSSize, screen: NSRect) -> NSPoint {
    NSPoint(x: max(screen.minX, min(point.x, screen.maxX - size.width)),
            y: max(screen.minY, min(point.y, screen.maxY - size.height)))
}

func fittedFrame(_ frame: NSRect, screen: NSRect) -> NSRect {
    let size = NSSize(width: min(frame.width, screen.width), height: min(frame.height, screen.height))
    return NSRect(origin: clampedOrigin(frame.origin, size: size, screen: screen), size: size)
}

func lensColor(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

enum LensMaterial: String, CaseIterable {
    case native, glass, graphite, porcelain, spectrum, ink, bronze, cobalt
    var title: String { switch self { case .native: return "原生玻璃"; case .glass: return "清透玻璃"; case .graphite: return "石墨仪表"; case .porcelain: return "白瓷柔光"; case .spectrum: return "光谱轨道"; case .ink: return "水墨宋韵"; case .bronze: return "青铜书卷"; case .cobalt: return "青蓝刻度" } }
    var accent: NSColor { switch self { case .graphite: return lensColor(0x74B8FF); case .porcelain: return lensColor(0x43876D); case .spectrum: return lensColor(0x9B8AE9); case .ink: return lensColor(0x343B38); case .bronze: return lensColor(0xCFA976); case .cobalt: return lensColor(0x75DBF1); default: return .systemBlue } }
    var ink: NSColor { switch self { case .graphite, .spectrum, .cobalt: return lensColor(0xF0F4FF); case .porcelain: return lensColor(0x2D4C40); case .glass: return lensColor(0x193A58); case .ink: return lensColor(0x252B28); case .bronze: return lensColor(0xF1EAD3); case .native: return .labelColor } }
    func surface(dark: Bool, selected: Bool = false) -> NSColor {
        switch self {
        case .native: return dark ? NSColor(white: 0.08, alpha: selected ? 0.60 : 0.68) : NSColor.labelColor.withAlphaComponent(selected ? 0.065 : 0.012)
        case .glass: return selected ? lensColor(0xBBD7F6, alpha: 0.8) : lensColor(0xEAF3FC, alpha: dark ? 0.86 : 0.50)
        case .graphite: return lensColor(selected ? 0x354B65 : 0x252E3A, alpha: 0.98)
        case .porcelain: return lensColor(selected ? 0xD6ECE0 : 0xF1F5EE, alpha: 0.98)
        case .spectrum: return lensColor(selected ? 0x393365 : 0x161D33, alpha: 0.98)
        case .ink: return lensColor(selected ? 0xE6E9DF : 0xFFFFF7, alpha: 0.98)
        case .bronze: return lensColor(selected ? 0x43563D : 0x26352E, alpha: 0.98)
        case .cobalt: return lensColor(selected ? 0x135171 : 0x0D3454, alpha: 0.98)
        }
    }
}

enum LensMotion: String, CaseIterable {
    case native, instant, settle, magnetic, sequence
    var title: String { switch self { case .native: return "原生动效"; case .instant: return "即时切换"; case .settle: return "阻尼展开"; case .magnetic: return "磁吸回弹"; case .sequence: return "逐岛点亮" } }
    var enter: Double { switch self { case .native: return 0.22; case .instant: return 0; case .settle: return 0.26; case .magnetic: return 0.32; case .sequence: return 0.33 } }
    var exit: Double { switch self { case .native: return 0.16; case .instant: return 0; case .settle: return 0.17; case .magnetic, .sequence: return 0.20 } }
}

enum LensChineseFont: String, CaseIterable {
    case song, fangsong, kai, system
    var title: String { switch self { case .song: return "宋体"; case .fangsong: return "仿宋"; case .kai: return "楷体"; case .system: return "系统中文" } }
    @MainActor func font(size: CGFloat, bold: Bool) -> NSFont {
        let names: [String]
        switch self { case .song: names = ["STSongti-SC-Regular", "Songti SC"]; case .fangsong: names = ["STFangsong", "FangSong"]; case .kai: names = ["STKaiti", "Kaiti SC"]; case .system: names = ["PingFangSC-Regular", "PingFang SC"] }
        // Request installed faces only; optional macOS fonts can open a blocking download dialog.
        let available = Set(CTFontManagerCopyAvailablePostScriptNames() as? [String] ?? [])
        let font = names.lazy.filter { available.contains($0) }.compactMap { NSFont(name: $0, size: size) }.first ?? NSFont.systemFont(ofSize: size)
        guard bold else { return font }
        let descriptor = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.bold))
        return NSFont(descriptor: descriptor, size: size) ?? font
    }
}

struct LensTypography {
    var chinese = LensChineseFont.song
    var bold = false
    var italic = false
    @MainActor func numberFont(size: CGFloat) -> NSFont {
        let name = bold ? (italic ? "TimesNewRomanPS-BoldItalicMT" : "TimesNewRomanPS-BoldMT") : (italic ? "TimesNewRomanPS-ItalicMT" : "TimesNewRomanPSMT")
        return NSFont(name: name, size: size) ?? NSFont(name: "Times New Roman", size: size) ?? NSFont.systemFont(ofSize: size)
    }
    @MainActor func reading(_ text: String, size: CGFloat, color: NSColor) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
        return NSAttributedString(string: text, attributes: [.font: numberFont(size: size), .foregroundColor: color, .paragraphStyle: paragraph])
    }
}

enum LensUITheme: String, CaseIterable {
    case native, glass, graphite, porcelain, spectrum, contrast, ink, bronze, cobalt
    var title: String { self == .contrast ? "墨芯玻璃" : LensMaterial(rawValue: rawValue)!.title }
    var ball: LensMaterial { self == .contrast ? .graphite : LensMaterial(rawValue: rawValue)! }
    var island: LensMaterial { self == .contrast ? .glass : LensMaterial(rawValue: rawValue)! }
    var motion: LensMotion { switch self { case .native: return .native; case .glass, .porcelain, .bronze: return .settle; case .graphite, .contrast: return .magnetic; case .spectrum, .cobalt: return .sequence; case .ink: return .instant } }
    var typography: LensTypography {
        switch self {
        case .native: return LensTypography(chinese: .system)
        case .glass, .ink: return LensTypography(chinese: .song)
        case .graphite: return LensTypography(chinese: .fangsong, bold: true)
        case .porcelain: return LensTypography(chinese: .kai)
        case .spectrum: return LensTypography(chinese: .song, bold: true)
        case .contrast: return LensTypography(chinese: .song, italic: true)
        case .bronze: return LensTypography(chinese: .fangsong, bold: true, italic: true)
        case .cobalt: return LensTypography(chinese: .kai, bold: true)
        }
    }
    var cardRadius: CGFloat { switch self { case .native: return 20; case .glass, .spectrum, .contrast: return 18; case .graphite: return 12; case .porcelain: return 22; case .ink: return 8; case .bronze: return 10; case .cobalt: return 14 } }
    var extraWidth: CGFloat { switch self { case .native: return 0; case .glass: return 12; case .graphite, .spectrum, .cobalt: return 24; case .porcelain, .contrast: return 20; case .ink: return 16; case .bronze: return 28 } }
    func width(for island: LensIsland) -> CGFloat { island.width + extraWidth }
    var settingsWidth: CGFloat { 420 + extraWidth }
}

struct LensUIStyle {
    var theme = LensUITheme.native
    var typography: LensTypography { theme.typography }
    var warningPulse: Bool { theme != .ink }
    var ball: LensMaterial { theme.ball }
    var island: LensMaterial { theme.island }
    var motion: LensMotion { theme.motion }
    static func load(_ defaults: UserDefaults = .standard) -> LensUIStyle {
        var style = LensUIStyle()
        style.theme = defaults.string(forKey: "uiTheme").flatMap(LensUITheme.init(rawValue:)) ?? .native
        return style
    }
    func save(_ defaults: UserDefaults = .standard) {
        defaults.set(theme.rawValue, forKey: "uiTheme")
    }
    var message: [String: String] { ["uiTheme":theme.rawValue,"uiBall":ball.rawValue,"uiIsland":island.rawValue,"uiMotion":motion.rawValue,"uiChinese":typography.chinese.rawValue,"uiBold":String(typography.bold),"uiItalic":String(typography.italic),"uiPulse":String(warningPulse)] }
    mutating func apply(_ body: [String: String]) -> Bool {
        guard let theme = body["uiTheme"].flatMap(LensUITheme.init(rawValue:)) else { return false }
        self.theme = theme
        return true
    }
}

enum OrbitGeometry {
    static let diameter: CGFloat = 256
    static let center = NSPoint(x: diameter / 2, y: diameter / 2)
    static let outerRadius: CGFloat = 123
    static let innerRadius: CGFloat = 43
    static let labelRadius: CGFloat = 86
}

@MainActor func glassSurface(in view: NSView, selected: Bool = false) -> NSColor {
    if view.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
        return NSColor(white: 0.08, alpha: selected ? 0.60 : 0.68)
    }
    return NSColor.labelColor.withAlphaComponent(selected ? 0.065 : 0.012)
}

enum LensIsland: String, CaseIterable {
    case context, usage, cost, commands, skills, mcp, runtime
    var title: String { switch self { case .context: return "上下文"; case .usage: return "用量"; case .cost: return "费用"; case .commands: return "命令行"; case .skills: return "技能"; case .mcp: return "MCP"; case .runtime: return "会话" } }
    var span: CGFloat { 360 / CGFloat(Self.allCases.count) }
    var start: CGFloat { 90 - CGFloat(Self.allCases.firstIndex(of: self)!) * span }
    var width: CGFloat { switch self { case .context: return 360; case .usage: return 396; case .cost: return 440; case .runtime: return 460; default: return 420 } }
    var height: CGFloat { self == .context ? 320 : self == .usage ? 520 : self == .cost ? 420 : 500 }
    func path(center: NSPoint, material: LensMaterial = .native) -> CGPath {
        if material == .spectrum {
            let point = labelPoint
            return CGPath(roundedRect: NSRect(x: point.x - 34, y: point.y - 23, width: 68, height: 46), cornerWidth: 13, cornerHeight: 13, transform: nil)
        }
        let gap: CGFloat = material == .porcelain ? 5 : 2.5
        let path = CGMutablePath(), start = (start - gap) * .pi / 180, end = (self.start - span + gap) * .pi / 180
        let outer = OrbitGeometry.outerRadius, inner = OrbitGeometry.innerRadius, corner: CGFloat = 7
        let outerInset = corner / outer, innerInset = corner / inner
        func point(_ radius: CGFloat, _ angle: CGFloat) -> NSPoint { NSPoint(x: center.x + radius * cos(angle), y: center.y + radius * sin(angle)) }
        path.move(to: point(outer, start - outerInset))
        path.addArc(center: center, radius: outer, startAngle: start - outerInset, endAngle: end + outerInset, clockwise: true)
        path.addQuadCurve(to: point(outer - corner, end), control: point(outer, end))
        path.addLine(to: point(inner + corner, end))
        path.addQuadCurve(to: point(inner, end + innerInset), control: point(inner, end))
        path.addArc(center: center, radius: inner, startAngle: end + innerInset, endAngle: start - innerInset, clockwise: false)
        path.addQuadCurve(to: point(inner + corner, start), control: point(inner, start))
        path.addLine(to: point(outer - corner, start))
        path.addQuadCurve(to: point(outer, start - outerInset), control: point(outer, start))
        path.closeSubpath(); return path
    }
    var labelPoint: NSPoint {
        let angle = (start - span / 2) * .pi / 180
        return NSPoint(x: OrbitGeometry.center.x + OrbitGeometry.labelRadius * cos(angle), y: OrbitGeometry.center.y + OrbitGeometry.labelRadius * sin(angle))
    }
    func accentPath() -> CGPath {
        let path = CGMutablePath()
        path.addArc(center: OrbitGeometry.center, radius: OrbitGeometry.outerRadius - 5, startAngle: (start - 8) * .pi / 180, endAngle: (start - span + 8) * .pi / 180, clockwise: true)
        return path
    }
    static func at(_ point: NSPoint, material: LensMaterial = .native) -> LensIsland? { allCases.first { $0.path(center: OrbitGeometry.center, material: material).contains(point) } }
}

func islandTextOrigins(title: CGRect, value: CGRect, in bounds: CGRect) -> (title: CGPoint, value: CGPoint) {
    let gap: CGFloat = 5
    let top = bounds.midY + (title.height + gap + value.height) / 2
    return (CGPoint(x: bounds.midX - title.midX, y: top - title.maxY),
            CGPoint(x: bounds.midX - value.midX, y: top - title.height - gap - value.maxY))
}

@MainActor final class IslandLabel: NSView {
    let island: LensIsland
    var style = LensUIStyle() { didSet { needsDisplay = true } }
    var value = "—" { didSet { setAccessibilityValue(value); needsDisplay = true } }
    var pressed: (() -> Void)?
    init(_ island: LensIsland) {
        self.island = island
        let point = island.labelPoint
        super.init(frame: NSRect(x: point.x - 32, y: point.y - 20, width: 64, height: 40))
        setAccessibilityElement(true); setAccessibilityRole(.button); setAccessibilityLabel(island.title)
    }
    required init?(coder: NSCoder) { fatalError("Not used") }
    override func accessibilityPerformPress() -> Bool { pressed?(); return true }
    static func titleReading(_ title: String, style: LensUIStyle) -> NSAttributedString {
        NSAttributedString(string: title, attributes: [.font: title == "MCP" ? style.typography.numberFont(size: 11) : style.typography.chinese.font(size: 11, bold: style.typography.bold), .obliqueness: style.typography.italic ? 0.16 : 0, .strokeWidth: style.typography.bold ? -1 : 0, .foregroundColor: style.island.ink.withAlphaComponent(0.82)])
    }
    override func draw(_ dirtyRect: NSRect) {
        let size: CGFloat = value.count > 8 ? 10 : value.count > 6 ? 12 : 14
        let titleLine = CTLineCreateWithAttributedString(Self.titleReading(island.title, style: style))
        let valueLine = CTLineCreateWithAttributedString(style.typography.reading(value, size: size, color: style.island.ink))
        let titleBounds = CTLineGetBoundsWithOptions(titleLine, .useGlyphPathBounds)
        let valueBounds = CTLineGetBoundsWithOptions(valueLine, .useGlyphPathBounds)
        let positions = islandTextOrigins(title: titleBounds, value: valueBounds, in: bounds)
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState(); context.textMatrix = .identity
        context.textPosition = positions.title; CTLineDraw(titleLine, context)
        context.textPosition = positions.value; CTLineDraw(valueLine, context)
        context.restoreGState()
    }
}

@MainActor final class OrbitView: NSView {
    var selected: LensIsland? { didSet { needsDisplay = true } }
    var style = LensUIStyle() { didSet { labels.values.forEach { $0.style = style }; needsDisplay = true } }
    var activate: ((LensIsland, Bool) -> Void)?
    var labels: [LensIsland: IslandLabel] = [:]
    private var surfaces: [LensIsland: CALayer] = [:]
    private var shapes: [LensIsland: CAShapeLayer] = [:]
    private var accents: [LensIsland: CAShapeLayer] = [:]
    private let ticks = CAShapeLayer()
    private let rail = CAShapeLayer()
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        ticks.frame = bounds; rail.frame = bounds
        layer?.addSublayer(ticks); layer?.addSublayer(rail)
        for island in LensIsland.allCases {
            let host = CALayer(); host.frame = bounds
            let shape = CAShapeLayer(); shape.frame = bounds
            let accent = CAShapeLayer(); accent.frame = bounds; accent.fillColor = nil; accent.lineCap = .round
            host.addSublayer(shape); host.addSublayer(accent); layer?.insertSublayer(host, at: 0)
            surfaces[island] = host; shapes[island] = shape; accents[island] = accent
            let label = IslandLabel(island); label.pressed = { [weak self] in self?.activate?(island, true) }
            label.wantsLayer = true
            labels[island] = label; addSubview(label)
        }
    }
    required init?(coder: NSCoder) { fatalError("Not used") }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { LensIsland.at(point, material: style.island) == nil ? nil : self }
    override func mouseDown(with event: NSEvent) {
        if let island = LensIsland.at(convert(event.locationInWindow, from: nil), material: style.island) { activate?(island, true) }
    }
    override func draw(_ dirtyRect: NSRect) {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        for island in LensIsland.allCases {
            let active = selected == island, shape = shapes[island]!, accent = accents[island]!
            shape.path = island.path(center: OrbitGeometry.center, material: style.island)
            shape.fillColor = style.island.surface(dark: dark, selected: active).cgColor
            shape.strokeColor = (active ? style.island.accent : style.island.ink.withAlphaComponent(style.island == .native ? 0.09 : 0.2)).cgColor
            shape.lineWidth = style.island == .ink ? 1.1 : active ? 1 : 0.7
            accent.path = island.accentPath(); accent.isHidden = style.island == .native || style.island == .ink
            let color: NSColor = style.island == .spectrum && island == .usage ? lensColor(0x57D6BB) : style.island == .spectrum && island == .cost ? lensColor(0xA2B7FF) : style.island.accent
            accent.strokeColor = color.withAlphaComponent(0.8).cgColor
            accent.lineWidth = style.island == .porcelain ? 2.7 : style.island == .graphite ? 2.3 : 1.5
        }
        let tickPath = CGMutablePath()
        for i in 0..<72 { let a = CGFloat(i) * .pi / 36; tickPath.move(to: NSPoint(x: OrbitGeometry.center.x + (OrbitGeometry.outerRadius - 2) * cos(a), y: OrbitGeometry.center.y + (OrbitGeometry.outerRadius - 2) * sin(a))); tickPath.addLine(to: NSPoint(x: OrbitGeometry.center.x + (OrbitGeometry.outerRadius - 4) * cos(a), y: OrbitGeometry.center.y + (OrbitGeometry.outerRadius - 4) * sin(a))) }
        ticks.path = tickPath; ticks.strokeColor = lensColor(0xC7D6EC, alpha: 0.4).cgColor; ticks.lineWidth = 0.6; ticks.fillColor = nil; ticks.isHidden = style.island != .graphite && style.island != .cobalt
        rail.path = CGPath(ellipseIn: bounds.insetBy(dx: 7, dy: 7), transform: nil)
        rail.strokeColor = lensColor(0x858BBA, alpha: 0.4).cgColor; rail.fillColor = nil; rail.lineWidth = 0.65; rail.isHidden = style.island != .spectrum
        CATransaction.commit()
    }
    var surfaceMask: CGPath {
        let mask = CGMutablePath()
        LensIsland.allCases.forEach { mask.addPath($0.path(center: OrbitGeometry.center, material: style.island)) }
        if style.island == .spectrum {
            for island in LensIsland.allCases { mask.addPath(island.accentPath().copy(strokingWithWidth: 4, lineCap: .round, lineJoin: .round, miterLimit: 2)) }
            mask.addPath(CGPath(ellipseIn: bounds.insetBy(dx: 7, dy: 7), transform: nil).copy(strokingWithWidth: 2, lineCap: .round, lineJoin: .round, miterLimit: 2))
        }
        return mask
    }
    func animateSectors(show: Bool, motion: LensMotion) {
        for (index,island) in LensIsland.allCases.enumerated() {
            for target in [surfaces[island], labels[island]?.layer].compactMap({ $0 }) {
                target.removeAnimation(forKey: "sector-opacity"); target.removeAnimation(forKey: "sector-scale")
                guard motion == .sequence, !lensReduceMotion else { continue }
                let opacity = CABasicAnimation(keyPath: "opacity"); opacity.fromValue = show ? 0 : 1; opacity.toValue = show ? 1 : 0
                let stagger = 0.11 / Double(max(1, LensIsland.allCases.count - 1))
                opacity.duration = show ? motion.enter : motion.exit; opacity.beginTime = CACurrentMediaTime() + (show ? Double(index) * stagger : 0)
                opacity.fillMode = .backwards; opacity.timingFunction = CAMediaTimingFunction(name: .easeOut)
                target.add(opacity, forKey: "sector-opacity")
                let scale = CABasicAnimation(keyPath: "transform.scale"); scale.fromValue = show ? 0.98 : 1; scale.toValue = show ? 1 : 0.98
                scale.duration = opacity.duration; scale.beginTime = opacity.beginTime; scale.fillMode = .backwards
                scale.timingFunction = opacity.timingFunction; target.add(scale, forKey: "sector-scale")
            }
        }
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance(); needsDisplay = true
        labels.values.forEach { $0.needsDisplay = true }
    }
}

@MainActor func glassContent(_ content: NSView, radius: CGFloat, mask: CGPath? = nil) -> NSView {
    let container: NSView
    if #available(macOS 26.0, *) {
        let glass = NSGlassEffectView(frame: content.frame); glass.style = .regular; glass.cornerRadius = radius
        glass.contentView = content; container = glass
    } else {
        let material = NSVisualEffectView(frame: content.frame)
        material.material = .hudWindow; material.blendingMode = .behindWindow; material.state = .active
        material.wantsLayer = true; material.layer?.cornerRadius = radius; material.layer?.masksToBounds = true
        content.autoresizingMask = [.width, .height]; material.addSubview(content); container = material
    }
    container.wantsLayer = true
    if let mask { let shape = CAShapeLayer(); shape.path = mask; container.layer?.mask = shape }
    else { container.layer?.cornerRadius = radius; container.layer?.masksToBounds = true }
    return container
}

// Polling never changes this state. Only explicit UI and frontmost-application events do.
struct LensVisibility {
    var ball = false
    var panel = false
    var temporarilyHidden = false
    var lastExternal = ""
    mutating func activate(_ identity: String, supported: Bool, own: Bool = false) {
        guard !own, identity != lastExternal else { return }
        if supported && identity != lastExternal { temporarilyHidden = false }
        lastExternal = identity
        ball = supported && !temporarilyHidden
        panel = false
    }
    mutating func hide() { temporarilyHidden = true; ball = false; panel = false }
    mutating func restore() { temporarilyHidden = false; ball = true }
    mutating func open() { restore(); panel = true }
    mutating func collapse() { panel = false }
}

@MainActor final class BallView: NSView {
    var toggle: (() -> Void)?
    var moved: (() -> Void)?
    var entered: (() -> Void)?
    var dragStarted: (() -> Void)?
    var percent: Double?
    var windowEstimated = false
    var usedTokens: Double?
    var style = LensUIStyle() { didSet { stopPulse(); needsDisplay = true; if let percent, percent >= 85 { startPulse() } } }
    var isPositionLocked = false
    private var mouseStart = NSPoint.zero
    private var windowStart = NSPoint.zero
    private var dragged = false
    private var pressedHighlight = false { didSet { needsDisplay = true } }
    override var acceptsFirstResponder: Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        setAccessibilityElement(true); setAccessibilityRole(.button)
        setAccessibilityLabel("Context Lens 悬浮球；点击展开，拖动移动，右键打开菜单")
    }
    required init?(coder: NSCoder) { fatalError("Not used") }
    override func updateTrackingAreas() {
        super.updateTrackingAreas(); trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { entered?() }
    override func accessibilityPerformPress() -> Bool { toggle?(); return true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        mouseStart = window?.convertPoint(toScreen: event.locationInWindow) ?? NSEvent.mouseLocation
        windowStart = window?.frame.origin ?? .zero; dragged = false
        // Keep the ring and reading fixed; pressing changes only the surface tint.
        stopPulse(); pressedHighlight = true
    }
    override func mouseDragged(with event: NSEvent) {
        guard !isPositionLocked else { return }
        let mouse = window?.convertPoint(toScreen: event.locationInWindow) ?? NSEvent.mouseLocation
        if hypot(mouse.x - mouseStart.x, mouse.y - mouseStart.y) < 3 && !dragged { return }
        if !dragged { dragStarted?(); windowStart = window?.frame.origin ?? windowStart }
        dragged = true
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(mouse) }) ?? window?.screen ?? NSScreen.main else { return }
        let point = NSPoint(x: windowStart.x + mouse.x - mouseStart.x, y: windowStart.y + mouse.y - mouseStart.y)
        window?.setFrameOrigin(clampedOrigin(point, size: bounds.size, screen: screen.visibleFrame))
    }
    override func mouseUp(with event: NSEvent) {
        pressedHighlight = false
        if let p = percent, p >= 85 { startPulse() }
        if dragged { moved?() } else { toggle?() }
    }
    func startPulse() {
        guard style.warningPulse, style.motion != .instant, !lensReduceMotion,
              layer?.animation(forKey: "pulse") == nil else { return }
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = 1.0; a.toValue = 0.86; a.duration = 0.9
        a.autoreverses = true; a.repeatCount = .infinity
        a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer?.add(a, forKey: "pulse")
    }
    func stopPulse() { layer?.removeAnimation(forKey: "pulse") }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36 || event.characters == " " { toggle?() } else { super.keyDown(with: event) }
    }
    override func draw(_ dirtyRect: NSRect) {
        let material = style.ball, oval = NSBezierPath(ovalIn: bounds)
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        material.surface(dark: dark).setFill(); oval.fill()
        if material == .graphite || material == .porcelain || material == .spectrum || material == .bronze || material == .cobalt {
            let start: NSColor = material == .porcelain ? lensColor(0xFFFFF9) : material == .graphite ? lensColor(0x39414C) : material == .bronze ? lensColor(0x4B5B44) : material == .cobalt ? lensColor(0x205F7D) : lensColor(0x374158)
            NSGradient(starting: start, ending: material.surface(dark: dark))?.draw(in: oval, angle: -45)
        }
        if pressedHighlight { material.accent.withAlphaComponent(0.12).setFill(); oval.fill() }
        if material == .glass {
            let rim = NSBezierPath(ovalIn: bounds.insetBy(dx: 1.5, dy: 1.5)); rim.lineWidth = 0.7; NSColor.white.withAlphaComponent(0.85).setStroke(); rim.stroke()
        }
        if material == .ink { material.ink.setStroke(); let rim = NSBezierPath(ovalIn: bounds.insetBy(dx: 1, dy: 1)); rim.lineWidth = 0.8; rim.stroke() }
        if material == .graphite || material == .cobalt {
            let marks = NSBezierPath(); marks.lineWidth = 0.6
            for i in 0..<32 { let a = CGFloat(i) * .pi / 16; marks.move(to: NSPoint(x: 28 + 25 * cos(a), y: 28 + 25 * sin(a))); marks.line(to: NSPoint(x: 28 + 24 * cos(a), y: 28 + 24 * sin(a))) }
            material.ink.withAlphaComponent(0.5).setStroke(); marks.stroke()
        }
        let track = NSBezierPath(ovalIn: bounds.insetBy(dx: 5, dy: 5)); track.lineWidth = 2
        material.ink.withAlphaComponent(0.14).setStroke(); track.stroke()
        if let p = percent {
            let ring = NSBezierPath(); ring.lineWidth = 2; ring.lineCapStyle = .round
            ring.appendArc(withCenter: NSPoint(x: bounds.midX, y: bounds.midY), radius: bounds.width / 2 - 5,
                           startAngle: 90, endAngle: 90 - CGFloat(min(100, max(0, p))) * 3.6, clockwise: true)
            (p >= 90 ? NSColor.systemRed : p >= 70 ? NSColor.systemOrange : material.accent).setStroke(); ring.stroke()
        }
        let value = percent.map { (windowEstimated ? "≈" : "") + String(format: "%.0f%%", $0) } ?? contextReading(nil, usedTokens: usedTokens)
        let line = CTLineCreateWithAttributedString(style.typography.reading(value, size: value.count > 4 ? 12 : 16, color: material.ink))
        // Center the visible glyphs, rather than the font's ascent/descent line box.
        let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        context.textMatrix = .identity
        context.textPosition = CGPoint(x: bounds.midX - ink.midX, y: bounds.midY - ink.midY)
        CTLineDraw(line, context)
        context.restoreGState()
    }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
}

@MainActor final class DetailPanel: NSPanel {
    var escape: (() -> Void)?
    var pressed: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { escape?() }
    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown {
            if !isKeyWindow { makeKey() }
            pressed?()
        }
        super.sendEvent(event)
    }
}

@MainActor final class DetailWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var needsPanelToBecomeKey: Bool { true }
}

@MainActor final class LensApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSMenuDelegate {
    private var ball: NSPanel!
    private var ballView: BallView!
    private var orbit: NSPanel!
    private var orbitView: OrbitView!
    private var orbitOpen = false
    private var collapsedOrigin: NSPoint?
    private var hoverTimer: Timer?
    private var hoverIsland: LensIsland?
    private var hoverSince = Date.distantPast
    private var leftSince: Date?
    private var positioning = false
    private var positionRevision = 0
    private var positionTimer: Timer?
    private var positionSnap: (from: NSPoint, to: NSPoint, started: TimeInterval)?
    private var positionClock = { ProcessInfo.processInfo.systemUptime }
    private var positionMotionAllowed = { !lensReduceMotion }
    private var positionDefaults = UserDefaults.standard
    private var windowTransition = 0
    private var pinned = false
    private var activeIsland = LensIsland.context
    private var islandHeights: [LensIsland: CGFloat] = [:]
    private let settingsHeight: CGFloat = 572
    private var detailTransition = 0
    private var detailSizing = false
    private var settingsPresented = false
    private var screenLayout: [String] = []
    private var panel: DetailPanel!
    private var web: WKWebView!
    private var status: NSStatusItem!
    private var hideItem: NSMenuItem!
    private var collapseItem: NSMenuItem!
    private var lockItem: NSMenuItem!
    private var uiThemeItems: [LensUITheme: NSMenuItem] = [:]
    private var backend: Process?
    private var timer: Timer?
    private var terminationSignal: DispatchSourceSignal?
    private var loading = false
    private var isPositionLocked = UserDefaults.standard.bool(forKey: "positionLocked")
    private var targetClient: String?
    private var targetPid: Int?
    private var visibleHint = FrontmostSession()
    private var supportedForeground = false
    private var targetRevision = 0
    private var detectionRequested = false
    private var reportedAccessibility: Bool?
    private var origin: URL!
    private var selection = ""
    private var view = UserDefaults.standard.string(forKey: "view") == "model" ? "model" : "budget"
    private var theme = UserDefaults.standard.string(forKey: "theme") ?? "auto"
    private var uiStyle = LensUIStyle.load()
    private var visibility = LensVisibility()
    private var pendingSettings = false
    private var webReady = false
    private var auditEvents: [String] = []
    // Opt-in local acceptance trace; normal launches never create this file.
    private let auditURL: URL? = {
        guard let index = CommandLine.arguments.firstIndex(of: "--ui-audit"), index + 1 < CommandLine.arguments.count else { return nil }
        return URL(fileURLWithPath: CommandLine.arguments[index + 1])
    }()

    private func traceEvent(_ name: String) {
        guard auditURL != nil else { return }
        auditEvents.append(String(format: "%.3f ", Date().timeIntervalSince1970) + name)
        if auditEvents.count > 16 { auditEvents.removeFirst() }
    }

    private func recordUIAudit() {
        guard let auditURL else { return }
        let record: [String: Any] = ["at": Date().timeIntervalSince1970, "ball": visibility.ball,
                                    "panel": visibility.panel, "hidden": visibility.temporarilyHidden,
                                    "ballVisible": ball.isVisible, "panelVisible": panel.isVisible, "panelIsKey": panel.isKeyWindow,
                                    "ballAlpha": ball.alphaValue, "panelAlpha": panel.alphaValue,
                                    "settingsPresented": settingsPresented,
                                    "orbitVisible": orbit.isVisible, "orbitOpen": orbitOpen, "island": activeIsland.rawValue,
                                    "selection": selection, "targetPid": targetPid ?? 0,
                                    "ballWindow": ball.windowNumber, "orbitWindow": orbit.windowNumber, "panelWindow": panel.windowNumber,
                                    "ballFrame": NSStringFromRect(ball.frame), "orbitFrame": NSStringFromRect(orbit.frame), "panelFrame": NSStringFromRect(panel.frame),
                                    "contentWidth": web.frame.width, "contentHeight": web.frame.height,
                                    "theme": theme, "uiStyle": uiStyle.message, "numberFont": uiStyle.typography.numberFont(size: 16).fontName,
                                    "chineseFont": uiStyle.typography.chinese.font(size: 11, bold: uiStyle.typography.bold).fontName,
                                    "events": auditEvents, "frontmost": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "",
                                    "accessibilityTrusted": AXIsProcessTrusted(), "visibleId": visibleHint.id, "visibleTitle": visibleHint.title]
        web.evaluateJavaScript("({height:innerHeight,mainHeight:document.querySelector('main').getBoundingClientRect().height,scrollHeight:document.documentElement.scrollHeight,toolbarVisible:document.querySelector('.toolbar').getClientRects().length>0,statusVisible:document.querySelector('.status-line').getClientRects().length>0,visibleSections:[...document.querySelectorAll('#dashboard>section')].filter(n=>n.getClientRects().length).map(n=>n.className),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme||'',dialogs:document.querySelectorAll('dialog[open]').length,focus:document.activeElement.id,columns:document.getElementById('dashboard') ? getComputedStyle(document.getElementById('dashboard')).gridTemplateColumns : '',numberFont:document.getElementById('context-percent') ? getComputedStyle(document.getElementById('context-percent')).fontFamily : '',categoryIds:[...document.querySelectorAll('#category-rows [data-category]')].map(n=>n.dataset.category),categoryTableHidden:document.getElementById('category-table')?.hidden,segmentsHidden:document.getElementById('segments')?.hidden,segmentCount:document.getElementById('segments')?.children.length,categoryNotice:document.getElementById('context-notice')?.textContent,cost:document.getElementById('cost')?.textContent,helperCount:document.querySelectorAll('.detail-source,#budget-source,#context-accuracy,#warnings,#cost-note,footer').length})") { result, _ in
            var output = record
            if let result { output["web"] = result }
            if let data = try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]) { try? data.write(to: auditURL, options: .atomic) }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !validSession(selection) { selection = "" }
        makeWindows(); applyTheme(); applyUIStyle()
        signal(SIGTERM, SIG_IGN)
        terminationSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        terminationSignal?.setEventHandler { NSApp.terminate(nil) }; terminationSignal?.resume()
        let notifications = NSWorkspace.shared.notificationCenter
        notifications.addObserver(self, selector: #selector(workspaceChanged(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        notifications.addObserver(self, selector: #selector(accessibilityChanged(_:)), name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged(_:)), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        if let app = NSWorkspace.shared.frontmostApplication { follow(app) }
        Task { await connect() }
    }

    private func makeWindows() {
        screenLayout = currentScreenLayout()
        let screen = NSScreen.main!.visibleFrame
        ball = NSPanel(contentRect: NSRect(x: screen.maxX - 76, y: screen.midY, width: 56, height: 56),
                       styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        ball.title = "Context Lens 悬浮球"; ball.level = .floating; ball.isOpaque = false; ball.backgroundColor = .clear
        ball.hasShadow = true; ball.hidesOnDeactivate = false; ball.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        ballView = BallView(frame: NSRect(x: 0, y: 0, width: 56, height: 56))
        ballView.isPositionLocked = isPositionLocked
        ballView.toggle = { [weak self] in self?.toggleOrbit() }
        ballView.entered = { [weak self] in self?.showOrbit() }
        ballView.dragStarted = { [weak self] in self?.beginBallDrag() }
        ballView.moved = { [weak self] in self?.endBallDrag() }
        ball.contentView = glassContent(ballView, radius: 28)
        if let saved = positionDefaults.string(forKey: "position") {
            let point = NSPointFromString(saved)
            let display = NSScreen.screens.first { $0.visibleFrame.contains(point) }?.visibleFrame ?? screen
            ball.setFrameOrigin(clampedOrigin(point, size: ball.frame.size, screen: display))
        }
        orbit = NSPanel(contentRect: NSRect(x: 0, y: 0, width: OrbitGeometry.diameter, height: OrbitGeometry.diameter), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        orbit.title = "Context Lens 环形岛"; orbit.level = .floating; orbit.isOpaque = false; orbit.backgroundColor = .clear
        orbit.hasShadow = true; orbit.hidesOnDeactivate = false; orbit.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        orbitView = OrbitView(frame: NSRect(origin: .zero, size: orbit.frame.size))
        orbitView.activate = { [weak self] island, pin in self?.showIsland(island, pin: pin) }
        let mask = CGMutablePath(); LensIsland.allCases.forEach { mask.addPath($0.path(center: OrbitGeometry.center)) }
        orbit.contentView = glassContent(orbitView, radius: 28, mask: mask)
        startHoverTracking()
        let menu = NSMenu(); menu.delegate = self
        func item(_ title: String, _ action: Selector, _ key: String = "", _ symbol: String? = nil) -> NSMenuItem {
            let value = menu.addItem(withTitle: title, action: action, keyEquivalent: key); value.target = self
            if let symbol { value.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
            return value
        }
        _ = item("打开面板", #selector(showPanel), "", "rectangle")
        collapseItem = item("收起面板", #selector(collapsePanel), "", "rectangle.compress.vertical")
        hideItem = item("隐藏悬浮球", #selector(toggleBall), "", "eye.slash")
        lockItem = item("锁定位置", #selector(togglePositionLock), "", "lock")
        let themeItem = NSMenuItem(title: "界面主题", action: nil, keyEquivalent: "")
        let themes = NSMenu(); themes.delegate = self
        for preset in LensUITheme.allCases {
            let choice = NSMenuItem(title: preset.title, action: #selector(chooseUITheme(_:)), keyEquivalent: "")
            choice.target = self; choice.representedObject = preset.rawValue; themes.addItem(choice); uiThemeItems[preset] = choice
        }
        themeItem.submenu = themes; menu.addItem(themeItem)
        menu.addItem(.separator())
        _ = item("设置…", #selector(showSettings), ",", "slider.horizontal.3")
        menu.addItem(.separator())
        _ = item("退出 Context Lens", #selector(quit), "q")
        ballView.menu = menu
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "scope", accessibilityDescription: "Context Lens")
        status.menu = menu
        let size = NSSize(width: activeIsland.width, height: activeIsland.height)
        panel = DetailPanel(contentRect: NSRect(origin: .zero, size: size),
                            styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.title = "Context Lens"; panel.level = .floating; panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentMinSize = NSSize(width: 280, height: 112); panel.isReleasedWhenClosed = false; panel.delegate = self
        panel.escape = { [weak self] in self?.escapeLayer() }
        panel.pressed = { [weak self] in self?.pinned = true; self?.traceEvent("detail-press") }
        let config = WKWebViewConfiguration(); config.userContentController.add(self, name: "lens")
        web = DetailWebView(frame: NSRect(origin: .zero, size: size), configuration: config); web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground"); web.autoresizingMask = [.width, .height]
        panel.contentView = glassContent(web, radius: 20)
    }

    private func startHoverTracking() {
        hoverTimer?.invalidate()
        let revision = positionRevision
        hoverTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.positionRevision == revision, !self.positioning else { return }
                self.trackHover()
            }
        }
    }
    private func beginBallDrag() {
        positionRevision += 1; positioning = true
        positionTimer?.invalidate(); positionTimer = nil; positionSnap = nil
        hoverTimer?.invalidate(); hoverTimer = nil
        windowTransition += 1
        closeOrbit(restore: false, reason: "drag", immediately: true)
    }
    private func endBallDrag() {
        guard positioning else { return }
        let revision = positionRevision
        guard let screen = ball.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else {
            finishBallPosition(ball.frame.origin, revision: revision); return
        }
        let size = ball.frame.size, start = ball.frame.origin
        var target = clampedOrigin(start, size: size, screen: screen)
        if abs(target.x - screen.minX) < 24 { target.x = screen.minX + 8 }
        else if abs(target.x + size.width - screen.maxX) < 24 { target.x = screen.maxX - size.width - 8 }
        if abs(target.y - screen.minY) < 24 { target.y = screen.minY + 8 }
        else if abs(target.y + size.height - screen.maxY) < 24 { target.y = screen.maxY - size.height - 8 }
        target = clampedOrigin(target, size: size, screen: screen)
        guard target != start, uiStyle.motion != .instant, positionMotionAllowed() else {
            finishBallPosition(target, revision: revision); return
        }
        positionSnap = (start, target, positionClock())
        // A retained Timer can be invalidated; no old AppKit frame animator keeps moving the ball.
        let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.advanceBallPosition(revision: revision, now: self.positionClock())
            }
        }
        positionTimer = timer; RunLoop.main.add(timer, forMode: .common)
    }
    private func advanceBallPosition(revision: Int, now: TimeInterval) {
        guard positioning, positionRevision == revision, let snap = positionSnap else { return }
        let progress = min(1, max(0, (now - snap.started) / 0.28))
        if progress >= 1 { finishBallPosition(snap.to, revision: revision); return }
        // Preserve the previous cubic timing curve (0.34, 1.56, 0.64, 1).
        var low = 0.0, high = 1.0, t = progress
        for _ in 0..<18 {
            let x = 3 * (1 - t) * (1 - t) * t * 0.34 + 3 * (1 - t) * t * t * 0.64 + t * t * t
            if x < progress { low = t } else { high = t }; t = (low + high) / 2
        }
        let eased = 3 * (1 - t) * (1 - t) * t * 1.56 + 3 * (1 - t) * t * t + t * t * t
        var point = NSPoint(x: snap.from.x + (snap.to.x - snap.from.x) * eased, y: snap.from.y + (snap.to.y - snap.from.y) * eased)
        if let screen = ball.screen?.visibleFrame ?? NSScreen.main?.visibleFrame { point = clampedOrigin(point, size: ball.frame.size, screen: screen) }
        ball.setFrameOrigin(point)
    }
    private func finishBallPosition(_ point: NSPoint, revision: Int) {
        guard positioning, positionRevision == revision else { return }
        positionTimer?.invalidate(); positionTimer = nil; positionSnap = nil
        let screen = ball.screen?.visibleFrame ?? NSScreen.main?.visibleFrame
        ball.setFrameOrigin(screen.map { clampedOrigin(point, size: ball.frame.size, screen: $0) } ?? point)
        positionDefaults.set(NSStringFromPoint(ball.frame.origin), forKey: "position")
        positioning = false; startHoverTracking()
    }

    private func applyVisibility() {
        let revision = windowTransition
        for (window, shown) in [(ball!, visibility.ball), (panel!, visibility.panel)] {
            if shown {
                let animate = uiStyle.motion != .instant && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
                if !window.isVisible { window.alphaValue = animate ? 0 : 1; window.orderFrontRegardless() }
                if animate && window.alphaValue < 1 {
                    NSAnimationContext.runAnimationGroup { context in
                        context.duration = 0.14; window.animator().alphaValue = 1
                    }
                } else { window.alphaValue = 1 }
            } else if window.isVisible {
                if uiStyle.motion == .instant || lensReduceMotion { window.orderOut(nil); continue }
                NSAnimationContext.runAnimationGroup({ context in
                    context.duration = 0.14; window.animator().alphaValue = 0
                }, completionHandler: { [weak self, weak window] in
                    Task { @MainActor in
                        guard let self, let window, self.windowTransition == revision else { return }
                        let stillHidden = window === self.ball ? !self.visibility.ball : !self.visibility.panel
                        if stillHidden { window.orderOut(nil) }
                        window.alphaValue = 1
                    }
                })
            }
        }
    }
    private func animate(_ window: NSWindow, show: Bool) {
        guard !show || !positioning else { return }
        let revision = windowTransition
        let selectedMotion = uiStyle.motion
        let motion = selectedMotion != .instant && !lensReduceMotion
        let view = window.contentView; view?.wantsLayer = true
        if window === orbit { orbitView.animateSectors(show: show, motion: selectedMotion) }
        let previousScale = view?.layer?.presentation()?.value(forKeyPath: "transform.scale") as? NSNumber
        view?.layer?.removeAnimation(forKey: "island-transition")
        if show { if !window.isVisible { window.alphaValue = 0 }; window.orderFrontRegardless() }
        if !motion { window.alphaValue = show ? 1 : 0; if !show { window.orderOut(nil) }; return }
        if motion, let layer = view?.layer {
            let animation: CABasicAnimation
            if selectedMotion == .magnetic && show {
                let spring = CASpringAnimation(keyPath: "transform.scale"); spring.mass = 1; spring.stiffness = 340; spring.damping = 26
                animation = spring
            } else { animation = CABasicAnimation(keyPath: "transform.scale") }
            let collapsed = selectedMotion == .native ? 0.88 : 0.98
            animation.fromValue = previousScale ?? NSNumber(value: show ? collapsed : 1)
            animation.toValue = show ? 1 : collapsed
            animation.duration = show ? selectedMotion.enter : selectedMotion.exit
            animation.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 0.8, 0.3, 1)
            if selectedMotion != .sequence { layer.add(animation, forKey: "island-transition") }
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = show ? selectedMotion.enter : selectedMotion.exit; window.animator().alphaValue = show ? 1 : 0
        }, completionHandler: { [weak self, weak window] in
            Task { @MainActor in
                guard let self, let window, self.windowTransition == revision else { return }
                let visible = window === self.orbit ? self.orbitOpen : self.visibility.panel
                if !visible { window.orderOut(nil) }
            }
        })
    }
    @discardableResult private func showOrbit() -> Bool {
        guard !positioning, visibility.ball, panel != nil else { return false }
        if orbitOpen { return true }
        orbitOpen = true; leftSince = nil; collapsedOrigin = ball.frame.origin
        let screen = ball.screen?.visibleFrame ?? NSScreen.main!.visibleFrame
        let origin = clampedOrigin(NSPoint(x: ball.frame.midX - OrbitGeometry.center.x, y: ball.frame.midY - OrbitGeometry.center.y), size: orbit.frame.size, screen: screen.insetBy(dx: 8, dy: 8))
        orbit.setFrameOrigin(origin)
        ball.setFrameOrigin(NSPoint(x: origin.x + OrbitGeometry.center.x - ball.frame.width / 2, y: origin.y + OrbitGeometry.center.y - ball.frame.height / 2))
        animate(orbit, show: true); ball.orderFrontRegardless()
        return true
    }
    private func closeOrbit(restore: Bool = true, reason: String = "explicit", immediately: Bool = false) {
        guard orbit != nil, panel != nil, orbitOpen || visibility.panel || immediately else { return }
        traceEvent("close-" + reason)
        orbitOpen = false; pinned = false; hoverIsland = nil; orbitView.selected = nil
        detailTransition += 1
        detailSizing = false
        if webReady { dispatch("context-lens-card-transition", "end") }
        visibility.collapse()
        if immediately {
            orbitView.animateSectors(show: false, motion: .instant)
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0
                panel.animator().setFrame(panel.frame, display: false)
                for window in [panel!, orbit!] { window.animator().alphaValue = 0 }
            }
            for window in [panel!, orbit!] {
                window.contentView?.layer?.removeAnimation(forKey: "island-transition")
                window.orderOut(nil)
            }
        } else { animate(panel, show: false); animate(orbit, show: false) }
        if let origin = collapsedOrigin, restore { ball.setFrameOrigin(origin) }
        collapsedOrigin = nil
    }
    private func toggleOrbit() { traceEvent("ball-toggle"); if orbitOpen { closeOrbit(reason: "ball-toggle") } else if showOrbit() { pinned = true } }
    private func trackHover() {
        guard !positioning, orbitOpen else { return }
        let mouse = NSEvent.mouseLocation
        let local = NSPoint(x: mouse.x - orbit.frame.minX, y: mouse.y - orbit.frame.minY)
        let island = LensIsland.at(local, material: uiStyle.island)
        if island != hoverIsland { hoverIsland = island; hoverSince = Date() }
        if let island, Date().timeIntervalSince(hoverSince) >= 0.16, (!visibility.panel || activeIsland != island) {
            showIsland(island, pin: false)
        }
        let inside = island != nil || ball.frame.insetBy(dx: -8, dy: -8).contains(mouse)
            || visibility.panel && panel.frame.insetBy(dx: -14, dy: -14).contains(mouse)
        if inside || pinned { leftSince = nil }
        else if let leftSince, Date().timeIntervalSince(leftSince) > 0.4 { closeOrbit(reason: "pointer-leave") }
        else if leftSince == nil { leftSince = Date() }
    }
    private func fitDetail(height: CGFloat, width: CGFloat? = nil, animated: Bool = true) {
        guard !positioning else { return }
        let screen = (ball.screen?.visibleFrame ?? NSScreen.main!.visibleFrame).insetBy(dx: 8, dy: 8)
        let size = NSSize(width: min(width ?? panel.frame.width, screen.width), height: min(max(112, ceil(height)), min(640, screen.height)))
        let left = orbit.frame.minX - size.width - 10
        let x = left >= screen.minX ? left : orbit.frame.maxX + 10
        let frame = NSRect(origin: clampedOrigin(NSPoint(x: x, y: orbit.frame.midY - size.height / 2), size: size, screen: screen), size: size)
        guard panel.frame != frame else { return }
        detailTransition += 1
        let revision = detailTransition
        let motion = animated && visibility.panel && uiStyle.motion != .instant && !lensReduceMotion
        if !motion {
            detailSizing = false
            panel.setFrame(frame, display: true)
            if webReady { dispatch("context-lens-card-transition", "end") }
            return
        }
        detailSizing = true
        if webReady { dispatch("context-lens-card-transition", "begin") }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = uiStyle.motion.enter
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 0.8, 0.3, 1)
            panel.animator().setFrame(frame, display: true)
        }, completionHandler: { [weak self] in
            Task { @MainActor in
                guard let self, self.detailTransition == revision else { return }
                self.detailSizing = false
                self.dispatch("context-lens-card-transition", "end")
            }
        })
    }
    private func showIsland(_ island: LensIsland, pin: Bool) {
        guard showOrbit() else { return }
        traceEvent("show-" + island.rawValue + (pin ? "-pinned" : "-hover"))
        pinned = pin; activeIsland = island; orbitView.selected = island
        let wasVisible = visibility.panel
        if !settingsPresented { fitDetail(height: islandHeights[island] ?? island.height, width: uiStyle.theme.width(for: island)) }
        dispatch("context-lens-island", island.rawValue)
        visibility.open()
        if !wasVisible { animate(panel, show: true) }
        if pin { panel.makeKeyAndOrderFront(nil) }
    }
    @objc private func showPanel() { guard !positioning else { return }; visibility.restore(); applyVisibility(); showIsland(activeIsland, pin: true) }
    @objc private func collapsePanel() { closeOrbit(reason: "collapse") }
    @objc private func toggleBall() {
        if visibility.ball { closeOrbit(reason: "hide"); visibility.hide() } else { visibility.restore() }
        applyVisibility()
    }
    @objc private func showSettings() {
        guard !positioning else { return }
        NSApp.activate(ignoringOtherApps: true)
        pendingSettings = true; showPanel()
        deliverSettings()
    }
    @objc private func chooseUITheme(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String, let preset = LensUITheme(rawValue: value) else { return }
        uiStyle.theme = preset; uiStyle.save(); applyUIStyle()
    }
    private func applyUIStyle() {
        ballView.style = uiStyle; orbitView.style = uiStyle
        if let mask = orbit.contentView?.layer?.mask as? CAShapeLayer { mask.path = orbitView.surfaceMask }
        if #available(macOS 26.0, *), let glass = panel.contentView as? NSGlassEffectView { glass.cornerRadius = uiStyle.theme.cardRadius }
        else { panel.contentView?.layer?.cornerRadius = uiStyle.theme.cardRadius }
        if visibility.panel && !settingsPresented { fitDetail(height: islandHeights[activeIsland] ?? activeIsland.height, width: uiStyle.theme.width(for: activeIsland), animated: false) }
        for (preset,item) in uiThemeItems { item.state = preset == uiStyle.theme ? .on : .off }
        if webReady { dispatch("context-lens-ui-style", uiStyle.message) }
        traceEvent("ui-theme-" + uiStyle.theme.rawValue); recordUIAudit()
    }
    private func deliverSettings() {
        guard webReady, pendingSettings else { return }
        pendingSettings = false
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('context-lens-command',{detail:'settings'}))", completionHandler: nil)
    }
    @objc private func togglePositionLock() {
        isPositionLocked.toggle()
        UserDefaults.standard.set(isPositionLocked, forKey: "positionLocked")
        ballView.isPositionLocked = isPositionLocked
    }
    @objc private func quit() { NSApp.terminate(nil) }
    private func escapeLayer() {
        traceEvent("escape")
        web.evaluateJavaScript("typeof window.contextLensEscape==='function' && window.contextLensEscape()") { [weak self] result, _ in
            if result as? Bool != true { self?.collapsePanel() }
        }
    }
    func menuWillOpen(_ menu: NSMenu) {
        hideItem.title = visibility.ball ? "隐藏悬浮球" : "恢复悬浮球"
        hideItem.image = NSImage(systemSymbolName: visibility.ball ? "eye.slash" : "eye", accessibilityDescription: nil)
        collapseItem.isEnabled = visibility.panel
        lockItem.title = isPositionLocked ? "解锁位置" : "锁定位置"
        lockItem.image = NSImage(systemSymbolName: isPositionLocked ? "lock.open" : "lock", accessibilityDescription: nil)
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { traceEvent("window-close"); collapsePanel(); return false }
    func windowDidResignKey(_ notification: Notification) { traceEvent("resign-key"); pinned = false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showPanel(); return true }
    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate(); hoverTimer?.invalidate(); positionTimer?.invalidate(); if backend?.isRunning == true { backend?.terminate() }
    }
    @objc private func workspaceChanged(_ notification: Notification) {
        if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication { follow(app) }
    }
    private func follow(_ app: NSRunningApplication) {
        let bundle = app.bundleIdentifier ?? ""
        traceEvent("foreground-" + bundle)
        guard bundle != Bundle.main.bundleIdentifier else { return }
        let identity = bundle + ":" + String(app.processIdentifier)
        guard identity != visibility.lastExternal else { return }
        let client: String?
        let supported: Bool
        if let tool = agentClient(bundle: bundle, name: app.localizedName ?? "") { client = tool; supported = true }
        else {
            client = nil
            supported = ["com.apple.Terminal", "com.googlecode.iterm2", "com.mitchellh.ghostty", "dev.warp.Warp-Stable", "net.kovidgoyal.kitty", "org.alacritty"].contains(bundle)
        }
        targetRevision += 1; supportedForeground = supported
        targetClient = client; targetPid = supported ? Int(app.processIdentifier) : nil
        visibleHint = supported ? frontmostSession(app, client: client) : FrontmostSession()
        selection = ""; dispatch("context-lens-active", ["session": "", "reason": "正在定位当前对话"])
        updateBall(nil, client: "等待对话", help: "自动跟随活跃对话")
        closeOrbit(reason: "foreground")
        visibility.activate(identity, supported: supported)
        applyVisibility()
        if supported { Task { await refreshBall() } }
    }
    private func currentScreenLayout() -> [String] {
        NSScreen.screens.map { screen in
            let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue ?? ""
            return id + NSStringFromRect(screen.frame) + NSStringFromRect(screen.visibleFrame)
        }.sorted()
    }
    @objc private func screensChanged(_ notification: Notification) {
        let next = currentScreenLayout()
        guard next != screenLayout else { return }
        screenLayout = next
        closeOrbit(reason: "screen-change")
        guard let screen = ball.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else { return }
        ball.setFrameOrigin(clampedOrigin(ball.frame.origin, size: ball.frame.size, screen: screen))
        panel.setFrame(fittedFrame(panel.frame, screen: screen), display: true)
    }
    private func applyTheme() {
        let appearance: NSAppearance? = theme == "light" ? NSAppearance(named: .aqua) : theme == "dark" ? NSAppearance(named: .darkAqua) : nil
        ball.appearance = appearance; orbit.appearance = appearance; panel.appearance = appearance; ballView.needsDisplay = true; orbitView.needsDisplay = true
    }
    @objc private func accessibilityChanged(_ notification: Notification) {
        ballView.stopPulse()
        if let percent = ballView.percent, percent >= 85 { ballView.startPulse() }
        if lensReduceMotion { orbitView.animateSectors(show: orbitOpen, motion: .instant) }
        sendEnvironment()
    }
    private func sendEnvironment() {
        guard webReady else { return }
        let workspace = NSWorkspace.shared
        reportedAccessibility = AXIsProcessTrusted()
        dispatch("context-lens-environment", ["reduceMotion": lensReduceMotion,
                                            "systemReduceMotion": workspace.accessibilityDisplayShouldReduceMotion,
                                            "reduceTransparency": workspace.accessibilityDisplayShouldReduceTransparency,
                                            "increaseContrast": workspace.accessibilityDisplayShouldIncreaseContrast,
                                            "accessibilityTrusted": reportedAccessibility == true,
                                            "desktopConnected": true])
    }
    private func openAccessibilitySettings() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        let opened = NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
        dispatch("context-lens-detection", ["state": opened ? "permission" : "failed"])
        sendEnvironment()
    }
    private func recognizeForeground() {
        guard AXIsProcessTrusted() else { openAccessibilitySettings(); return }
        let current = NSWorkspace.shared.frontmostApplication
        let app = current?.bundleIdentifier == Bundle.main.bundleIdentifier
            ? targetPid.flatMap { NSRunningApplication(processIdentifier: pid_t($0)) } : current
        guard let app else { dispatch("context-lens-detection", ["state": "waiting"]); return }
        let client = agentClient(bundle: app.bundleIdentifier ?? "", name: app.localizedName ?? "")
        let terminal = ["com.apple.Terminal", "com.googlecode.iterm2", "com.mitchellh.ghostty", "dev.warp.Warp-Stable", "net.kovidgoyal.kitty", "org.alacritty"].contains(app.bundleIdentifier ?? "")
        guard client != nil || terminal else { dispatch("context-lens-detection", ["state": "waiting"]); return }
        supportedForeground = true; targetClient = client; targetPid = Int(app.processIdentifier)
        if current?.bundleIdentifier != Bundle.main.bundleIdentifier { visibleHint = frontmostSession(app, client: client) }
        targetRevision += 1
        detectionRequested = true; traceEvent("manual-foreground-scan")
        dispatch("context-lens-detection", ["state": "loading"])
        Task { await refreshBall() }
    }
    private func dispatch(_ name: String, _ detail: Any) {
        guard let encoded = try? JSONSerialization.data(withJSONObject: detail, options: [.fragmentsAllowed]),
              let json = String(data: encoded, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)',{detail:\(json)}))", completionHandler: nil)
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
            origin = URL(string: "http://127.0.0.1:\(port)")!
            if !(await healthy()) {
                let process = Process(); process.executableURL = runtime.appendingPathComponent("node")
                process.arguments = [runtime.appendingPathComponent("scripts/context-lens.mjs").path, "serve", "--port", String(port)]
                process.currentDirectoryURL = runtime
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
            url.queryItems = [URLQueryItem(name: "view", value: view)]
            web.load(URLRequest(url: url.url!))
            timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in Task { @MainActor in await self?.refreshBall() } }
            await refreshBall()
        } catch {
            let alert = NSAlert(); alert.messageText = "Context Lens 无法连接本地服务"
            alert.informativeText = "请重新打开应用，并检查本地端口是否被其他程序占用。\n\(error.localizedDescription)"
            alert.addButton(withTitle: "退出"); NSApp.activate(ignoringOtherApps: true); alert.runModal(); NSApp.terminate(nil)
        }
    }
    private func refreshBall() async {
        guard !loading, origin != nil else { return }
        var refreshRevision = targetRevision
        var networkError = false
        loading = true; defer {
            loading = false; recordUIAudit()
            if reportedAccessibility != AXIsProcessTrusted() { sendEnvironment() }
            if detectionRequested && refreshRevision == targetRevision {
                detectionRequested = false
                dispatch("context-lens-detection", ["state": networkError ? "failed" : validSession(selection) ? "recognized" : "waiting"])
            }
        }
        if let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier != Bundle.main.bundleIdentifier, supportedForeground, Int(app.processIdentifier) == targetPid {
            let hint = frontmostSession(app, client: targetClient)
            if hint != visibleHint {
                let identityChanged = hint.id != visibleHint.id || hint.id.isEmpty && hint.title != visibleHint.title
                    || targetClient == nil && (hint.tty != visibleHint.tty || hint.cwd != visibleHint.cwd)
                visibleHint = hint; targetRevision += 1
                if identityChanged && !selection.isEmpty {
                    selection = ""
                    dispatch("context-lens-active", ["session": "", "reason": "正在定位当前对话"])
                    updateBall(nil, client: "正在读取", help: "自动跟随活跃对话")
                }
            }
        }
        refreshRevision = targetRevision
        if clearUnidentifiedDesktopSelection() { return }
        if supportedForeground || visibility.ball {
            let revision = targetRevision
            var url = URLComponents(url: origin.appendingPathComponent("api/active"), resolvingAgainstBaseURL: false)!
            url.queryItems = []
            if let targetClient { url.queryItems?.append(URLQueryItem(name: "client", value: targetClient)) }
            if let targetPid { url.queryItems?.append(URLQueryItem(name: "pid", value: String(targetPid))) }
            url.queryItems?.append(contentsOf: visibleHint.query)
            let data = try? await json(url.url!)
            networkError = data == nil
            guard revision == targetRevision else { return }
            guard let data else { return }
            let next = data["selected"] as? String ?? ""
            if next != selection { updateBall(nil, client: "正在读取", help: "自动跟随活跃对话") }
            selection = next
            let reason = data["reason"] as? String ?? "正在定位当前对话"
            dispatch("context-lens-active", ["session": selection, "reason": reason])
        }
        guard validSession(selection) else { updateBall(nil, client: "等待对话", help: "自动跟随活跃对话"); return }
        let key = selection, mode = view, revision = targetRevision
        var url = URLComponents(url: origin.appendingPathComponent("api/snapshot"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "session", value: key), URLQueryItem(name: "view", value: mode)]
        do {
            let data = try await json(url.url!)
            guard key == selection, mode == view, revision == targetRevision,
                  let session = data["session"] as? [String: Any], let client = session["client"] as? String,
                  let id = session["id"] as? String, "\(client):\(id)" == key else { return }
            let context = data["context"] as? [String: Any] ?? [:]
            let value = contextPercent(context, client: key.split(separator: ":").first.map(String.init) ?? "")
            let totals = (data["totals"] as? [String: Any])?["all"] as? [String: Any] ?? [:]
            if let input = totals["input"] as? Double, let output = totals["output"] as? Double,
               input + output > 0 || (totals["requests"] as? Int ?? 0) > 0 { orbitView.labels[.usage]?.value = shortNumber(input + output) }
            else { orbitView.labels[.usage]?.value = "—" }
            let cost = data["cost"] as? [String: Any] ?? [:]
            if let amount = cost["amount"] as? Double, amount.isFinite {
                let currency = cost["currency"] as? String ?? "USD"
                orbitView.labels[.cost]?.value = (currency == "USD" ? "$" : currency == "CNY" ? "¥" : currency + " ") + String(format: "%.2f", amount)
            } else { orbitView.labels[.cost]?.value = "—" }
            let activity = data["activity"] as? [String: Any]
            for island in [LensIsland.commands, .skills, .mcp] {
                let total = (activity?[island.rawValue] as? [String: Any])?["total"] as? Double
                orbitView.labels[island]?.value = total.map { activity?["complete"] as? Bool == false && $0 == 0 ? "—" : (activity?["complete"] as? Bool == false ? "≥" : "") + shortNumber($0) } ?? "—"
            }
            let timing = data["timing"] as? [String: Any]
            if let elapsed = timing?["elapsedMs"] as? Double, elapsed.isFinite, elapsed >= 0 {
                let seconds = Int(elapsed / 1000), hours = seconds / 3600
                orbitView.labels[.runtime]?.value = (timing?["startAccuracy"] as? String == "observed" ? "≈" : "") + (hours > 0 ? String(format: "%dh %02dm", hours, seconds / 60 % 60) : String(format: "%dm %02ds", seconds / 60, seconds % 60))
                orbitView.labels[.runtime]?.toolTip = String(format: "会话时长 %02d:%02d:%02d", hours, seconds / 60 % 60, seconds % 60)
            } else { orbitView.labels[.runtime]?.value = "—" }
            let tool = client
            let name = ["claude": "Claude", "codex": "Codex", "agy": "Antigravity", "opencode": "OpenCode", "mimocode": "MiMo", "deepseek": "DeepSeek", "zcode": "ZCode"][tool] ?? tool
            let model = (session["modelName"] ?? session["model"]) as? String ?? ""
            let contextMode = context["view"] as? String ?? mode
            let help = tool == "claude" ? "当前会话上下文窗口" : tool == "agy" && contextMode == "budget" ? "上下文预算" : contextMode == "budget" ? "压缩预算" : "模型窗口"
            updateBall(value, usedTokens: context["usedTokens"] as? Double, client: name,
                       help: model.isEmpty || model == "unknown" ? help : "\(model)\n\(help)",
                       estimated: context["windowEstimated"] as? Bool == true)
        } catch { networkError = true }
    }
    @discardableResult private func clearUnidentifiedDesktopSelection() -> Bool {
        guard ["codex", "claude", "agy"].contains(targetClient ?? ""), visibleHint.id.isEmpty, visibleHint.title.isEmpty else { return false }
        selection = ""
        dispatch("context-lens-active", ["session": "", "reason": "当前可见对话无法唯一对应"])
        updateBall(nil, client: "等待对话", help: "自动跟随活跃对话")
        return true
    }
    private func updateBall(_ percent: Double?, usedTokens: Double? = nil, client: String, help: String, estimated: Bool = false) {
        let readingTokens = client == "Claude" ? nil : usedTokens
        let reading = (estimated && percent != nil ? "≈" : "") + contextReading(percent, usedTokens: readingTokens)
        orbitView.labels[.context]?.value = reading
        if percent == nil && !["Claude", "Codex", "Antigravity", "OpenCode", "MiMo", "DeepSeek", "ZCode"].contains(client) { for island in LensIsland.allCases { orbitView.labels[island]?.value = "—" } }
        ballView.percent = percent; ballView.usedTokens = readingTokens; ballView.windowEstimated = estimated
        ballView.toolTip = "\(client)\n\(help)"; ballView.needsDisplay = true
        let value = reading == "—" ? "\(client) 未知" : "\(client) \(reading)"
        ballView.setAccessibilityValue(value); status.button?.toolTip = "Context Lens · \(value)"
        if let p = percent, p >= 85 { ballView.startPulse() } else { ballView.stopPulse() }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "http",
              message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == origin?.port,
              let body = message.body as? [String: String] else { return }
        switch body["action"] ?? "state" {
        case "motion-preference":
            guard let value = body["reduceMotion"], ["true", "false"].contains(value) else { return }
            UserDefaults.standard.set(value == "true", forKey: "reduceMotion")
            accessibilityChanged(Notification(name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification))
        case "ui-style":
            guard uiStyle.apply(body) else { return }
            uiStyle.save(); applyUIStyle()
        case "collapse": traceEvent("web-collapse"); collapsePanel()
        case "hide": closeOrbit(reason: "web-hide"); visibility.hide(); applyVisibility()
        case "refresh": Task { await refreshBall() }
        case "island":
            guard let island = body["island"].flatMap(LensIsland.init(rawValue:)), !settingsPresented else { return }
            showIsland(island, pin: true)
        case "accessibility":
            openAccessibilitySettings()
        case "recognize": recognizeForeground()
        case "settings-open":
            guard !positioning, !settingsPresented else { return }
            pinned = true; settingsPresented = true
            fitDetail(height: settingsHeight, width: uiStyle.theme.settingsWidth, animated: false)
        case "settings-close":
            settingsPresented = false
            fitDetail(height: islandHeights[activeIsland] ?? activeIsland.height, width: uiStyle.theme.width(for: activeIsland))
        case "layout":
            guard let island = body["island"].flatMap(LensIsland.init(rawValue:)), island == activeIsland,
                  !detailSizing, let reportedWidth = body["width"].flatMap(Double.init), reportedWidth.isFinite, abs(reportedWidth - web.frame.width) < 1,
                  let value = body["height"].flatMap(Double.init), value.isFinite, value > 0, value <= 10_000,
                  !settingsPresented else { return }
            islandHeights[island] = CGFloat(value)
            if visibility.panel { fitDetail(height: CGFloat(value)) }
        case "open-github":
            guard let value = body["url"], let url = URL(string: value), url.scheme == "https", url.host == "github.com",
                  url.port == nil || url.port == 443,
                  url.user == nil, url.password == nil,
                  url.path == "/Chin-Jing1998/context-lens" || url.path.hasPrefix("/Chin-Jing1998/context-lens/") else { return }
            NSWorkspace.shared.open(url)
        case "ready", "state":
            guard let mode = body["view"], ["budget", "model"].contains(mode),
                  let appearance = body["theme"], ["auto", "light", "dark"].contains(appearance) else { return }
            view = mode; theme = appearance
            for (name, value) in [("view", view), ("theme", theme)] { UserDefaults.standard.set(value, forKey: name) }
            applyTheme()
            if body["action"] == "ready" {
                webReady = true; sendEnvironment(); applyUIStyle(); deliverSettings()
                dispatch("context-lens-active", ["session": selection, "reason": "自动跟随活跃对话"])
                dispatch("context-lens-island", activeIsland.rawValue)
            }
            Task { await refreshBall() }
        default: return
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { Task { await refreshBall() } }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == origin?.port ? .allow : .cancel)
    }

    static func checkDragLifecycle() async {
        _ = NSApplication.shared
        let suite = "context-lens-drag-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        let app = LensApp(); app.positionDefaults = defaults; app.makeWindows(); app.visibility.restore()
        app.isPositionLocked = false; app.ballView.isPositionLocked = false
        app.uiStyle = LensUIStyle(theme: .native)
        var clock = 0.0
        app.positionClock = { clock }; app.positionMotionAllowed = { true }
        defer {
            app.hoverTimer?.invalidate(); app.positionTimer?.invalidate()
            for window in [app.ball!, app.orbit!, app.panel!] { window.orderOut(nil) }
            NSStatusBar.system.removeStatusItem(app.status)
            app.web.configuration.userContentController.removeScriptMessageHandler(forName: "lens")
            defaults.removePersistentDomain(forName: suite)
        }
        func check(_ value: Bool, _ message: String) {
            if !value { FileHandle.standardError.write(Data("[native-regression] \(message)\n".utf8)) }
            precondition(value, message)
        }
        func mouse(_ type: NSEvent.EventType, _ screenPoint: NSPoint) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: app.ball.convertPoint(fromScreen: screenPoint), modifierFlags: [], timestamp: 0,
                windowNumber: app.ball.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)!
        }
        func center() -> NSPoint { NSPoint(x: app.ball.frame.midX, y: app.ball.frame.midY) }
        func blockedOpenings() {
            app.ballView.mouseEntered(with: mouse(.mouseMoved, center()))
            check(!app.showOrbit(), "Opening the orbit must be rejected while positioning")
            app.showIsland(.usage, pin: true); app.showPanel(); app.showSettings(); app.trackHover()
            check(!app.orbitOpen && !app.visibility.panel && !app.orbit.isVisible && !app.panel.isVisible,
                  "No hover, island, menu or settings entrance may open while positioning")
        }
        func aligned() {
            check(abs(app.ball.frame.midX - app.orbit.frame.midX) <= 0.5 && abs(app.ball.frame.midY - app.orbit.frame.midY) <= 0.5,
                  "The ball and reopened orbit must share the final center")
        }
        func drag(_ origin: NSPoint, delta: NSPoint) {
            app.closeOrbit(restore: false, immediately: true); app.ball.setFrameOrigin(origin)
            let start = center(), end = NSPoint(x: start.x + delta.x, y: start.y + delta.y)
            app.ballView.mouseDown(with: mouse(.leftMouseDown, start))
            app.ballView.mouseDragged(with: mouse(.leftMouseDragged, end))
            app.ballView.mouseUp(with: mouse(.leftMouseUp, end))
        }

        // This is the same clearing handler called by refreshBall before any active API request.
        FileHandle.standardError.write(Data("[self-test] desktop missing-identity guard\n".utf8))
        for client in ["codex", "claude"] {
            app.targetClient = client; app.visibleHint = FrontmostSession(cwd: "/fixture", tty: "ttys001")
            app.selection = client + ":old"; app.updateBall(47, usedTokens: 170461, client: "Codex", help: "")
            check(app.clearUnidentifiedDesktopSelection(), "Desktop navigation without an id or title must stop active lookup")
            check(app.selection.isEmpty && app.ballView.percent == nil && app.ballView.usedTokens == nil,
                  "A missing desktop identity clears the previous selection and ball reading")
            check(LensIsland.allCases.allSatisfy { app.orbitView.labels[$0]?.value == "—" }, "Missing identity clears all island readings")
            for hint in [FrontmostSession(id: "known"), FrontmostSession(title: "Known title")] {
                app.visibleHint = hint; app.selection = client + ":known"; app.visibility.open()
                check(!app.clearUnidentifiedDesktopSelection() && app.selection == client + ":known",
                      "Known desktop identity remains available while our own panel is open")
            }
        }
        app.updateBall(nil, usedTokens: 170461, client: "Claude", help: "当前会话上下文窗口")
        check(app.ballView.usedTokens == nil && app.orbitView.labels[.context]?.value == "—", "Claude 缺少窗口占比时不能用 token 数替代主读数")
        app.updateBall(12.5, usedTokens: 170461, client: "Claude", help: "当前会话上下文窗口")
        check(app.ballView.percent == 12.5 && app.ballView.usedTokens == nil && app.orbitView.labels[.context]?.value == "12.5%", "Claude 主读数使用窗口百分比")
        app.updateBall(nil, usedTokens: 170461, client: "Codex", help: "")
        check(app.ballView.usedTokens == 170461 && app.orbitView.labels[.context]?.value == "170.5k", "其他客户端的现有回退行为保持不变")
        for client: String? in [nil, "opencode", "mimocode", "deepseek", "zcode"] {
            app.targetClient = client; app.visibleHint = FrontmostSession(); app.selection = "codex:known"
            check(!app.clearUnidentifiedDesktopSelection() && app.selection == "codex:known", "Terminal and other client fallback remains available")
        }
        app.visibility.collapse()

        app.showIsland(.context, pin: false)
        app.fitDetail(height: 300)
        let before = app.ball.frame.origin
        let originalStart = app.ballView.dragStarted
        let oldHover = app.hoverTimer
        var started = false
        app.ballView.dragStarted = {
            originalStart?()
            started = true
            check(app.ball.frame.origin == before, "Closing must happen before the first ball movement")
            check(!app.orbit.isVisible && !app.panel.isVisible, "Drag start must immediately hide expanded windows")
        }
        let start = center(), second = NSPoint(x: start.x - 100, y: start.y - 50)
        app.ballView.mouseDown(with: mouse(.leftMouseDown, start))
        app.ballView.mouseDragged(with: mouse(.leftMouseDragged, NSPoint(x: start.x - 60, y: start.y - 40)))
        check(started && app.positioning && oldHover?.isValid == false, "The real first drag owns position and invalidates old hover work")
        app.ballView.dragStarted = originalStart
        blockedOpenings()
        let detailRevision = app.detailTransition, detailFrame = app.panel.frame
        app.fitDetail(height: 600)
        check(app.detailTransition == detailRevision && app.panel.frame == detailFrame, "Late card sizing cannot move a hidden card during drag")
        app.ballView.mouseDragged(with: mouse(.leftMouseDragged, second))
        blockedOpenings()
        app.ballView.mouseUp(with: mouse(.leftMouseUp, second))
        check(!app.positioning && app.positionTimer == nil, "A nonsnapping drag releases ownership on mouse up")
        let settled = app.ball.frame.origin
        check(defaults.string(forKey: "position") == NSStringFromPoint(settled), "Only the settled position is saved")
        check(app.showOrbit(), "The next opening is available after a stable drag"); aligned()
        app.closeOrbit(immediately: true)
        check(app.ball.frame.origin == settled, "Collapsing restores the final dragged position")

        let screen = app.ball.screen?.visibleFrame ?? NSScreen.main!.visibleFrame
        drag(NSPoint(x: screen.minX + 15, y: screen.midY), delta: NSPoint(x: -4, y: 0))
        check(app.positioning && app.positionSnap != nil && app.positionTimer?.isValid == true, "Edge snapping retains ownership for its animation")
        let oldRevision = app.positionRevision, oldTimer = app.positionTimer!, oldTarget = app.positionSnap!.to
        let savedBeforeSnap = defaults.string(forKey: "position")
        clock += 0.14; app.advanceBallPosition(revision: oldRevision, now: clock)
        blockedOpenings()
        check(defaults.string(forKey: "position") == savedBeforeSnap, "A partial snap must not persist its intermediate position")
        let nextStart = center(), nextEnd = NSPoint(x: nextStart.x + 80, y: nextStart.y - 20)
        app.ballView.mouseDown(with: mouse(.leftMouseDown, nextStart))
        app.ballView.mouseDragged(with: mouse(.leftMouseDragged, nextEnd))
        let nextRevision = app.positionRevision, newFrame = app.ball.frame
        check(nextRevision > oldRevision && !oldTimer.isValid && app.positionSnap == nil, "A new real drag cancels the previous geometry timer")
        app.advanceBallPosition(revision: oldRevision, now: clock + 1)
        app.finishBallPosition(oldTarget, revision: oldRevision)
        check(app.positioning && app.ball.frame == newFrame && defaults.string(forKey: "position") == savedBeforeSnap,
              "Old timer work and completion cannot move, persist or release a newer drag")
        blockedOpenings()
        app.ballView.mouseUp(with: mouse(.leftMouseUp, nextEnd))
        let newest = app.ball.frame.origin
        check(!app.positioning && defaults.string(forKey: "position") == NSStringFromPoint(newest), "The second drag's final position wins")
        app.finishBallPosition(oldTarget, revision: oldRevision)
        check(app.ball.frame.origin == newest, "A late old completion stays inert after the newer drag finishes")
        app.showIsland(.cost, pin: false); app.pinned = true; aligned()
        let reopenedPanel = app.panel.frame
        app.hoverTimer?.invalidate()
        try? await Task.sleep(nanoseconds: 400_000_000)
        check(app.orbit.isVisible && app.panel.isVisible && app.panel.frame == reopenedPanel, "Old show, fade and size completions cannot disturb the reopened geometry")
        aligned()

        let width = app.ball.frame.width, height = app.ball.frame.height
        for point in [NSPoint(x: screen.minX + 15, y: screen.midY), NSPoint(x: screen.maxX - width - 15, y: screen.midY),
                      NSPoint(x: screen.midX, y: screen.minY + 15), NSPoint(x: screen.midX, y: screen.maxY - height - 15),
                      NSPoint(x: screen.minX + 15, y: screen.minY + 15), NSPoint(x: screen.maxX - width - 15, y: screen.maxY - height - 15)] {
            drag(point, delta: NSPoint(x: 4, y: 4))
            check(app.positioning && app.positionSnap != nil, "Every screen edge keeps the snap phase active")
            blockedOpenings()
            let revision = app.positionRevision, expected = app.positionSnap!.to
            clock += 1; app.advanceBallPosition(revision: revision, now: clock)
            check(!app.positioning && app.ball.frame.origin == expected && defaults.string(forKey: "position") == NSStringFromPoint(expected), "A completed snap persists its exact final target")
            check(screen.contains(app.ball.frame), "Snapping keeps the ball in the visible screen")
            check(app.showOrbit(), "Stable edge snaps permit a new opening"); aligned()
        }
        for instant in [true, false] {
            app.uiStyle = LensUIStyle(theme: instant ? .ink : .native)
            app.positionMotionAllowed = { instant }
            drag(NSPoint(x: screen.minX + 15, y: screen.midY), delta: NSPoint(x: 4, y: 0))
            check(!app.positioning && app.positionTimer == nil && app.positionSnap == nil, "Instant and reduced motion snap without a delayed geometry operation")
        }
        app.uiStyle = LensUIStyle(theme: .native); app.positionMotionAllowed = { true }
        app.positionClock = { ProcessInfo.processInfo.systemUptime }
        drag(NSPoint(x: screen.minX + 15, y: screen.midY), delta: NSPoint(x: 4, y: 0))
        check(app.positionTimer?.isValid == true, "The actual run-loop timer starts for animated snapping")
        let expected = app.positionSnap!.to
        let deadline = ProcessInfo.processInfo.systemUptime + 2
        while app.positioning && ProcessInfo.processInfo.systemUptime < deadline {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        check(!app.positioning && app.positionTimer == nil, "实际吸附计时器应结束并释放位置控制")
        check(app.ball.frame.origin == expected && defaults.string(forKey: "position") == NSStringFromPoint(expected),
              "实际吸附计时器应将目标位置写入设置")
        app.closeOrbit(restore: false, immediately: true)
        let originalToggle = app.ballView.toggle
        var toggles = 0
        app.ballView.toggle = { toggles += 1; originalToggle?() }
        for locked in [false, true] {
            app.closeOrbit(restore: false, immediately: true)
            app.ballView.isPositionLocked = locked
            let point = center(), origin = app.ball.frame.origin, revision = app.positionRevision, saved = defaults.string(forKey: "position"), oldToggles = toggles
            let end = NSPoint(x: point.x + (locked ? 40 : 1), y: point.y)
            app.ballView.mouseDown(with: mouse(.leftMouseDown, point)); app.ballView.mouseDragged(with: mouse(.leftMouseDragged, end))
            check(app.ball.frame.origin == origin && app.positionRevision == revision, "A short click or locked gesture must not drag")
            app.ballView.mouseUp(with: mouse(.leftMouseUp, end))
            check(toggles == oldToggles + 1 && app.orbitOpen && !app.positioning && defaults.string(forKey: "position") == saved, "Ordinary and locked clicks retain one toggle without a position write")
        }
    }
}

@main struct ContextLens {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--self-test") {
            func checkpoint(_ name: String) {
                FileHandle.standardError.write(Data("[self-test] \(name)\n".utf8))
            }
            checkpoint("context readings")
            let context: [String: Any] = ["windowPercent": 12.5, "percent": 50.0]
            precondition(contextPercent(context, client: "claude") == 12.5)
            precondition(contextPercent(context, client: "codex") == 50)
            precondition(contextPercent(["percent": 50.0], client: "claude") == nil)
            precondition(contextPercent(["windowPercent": NSNull(), "percent": 50.0], client: "claude") == nil)
            precondition(contextPercent(["windowPercent": Double.nan], client: "claude") == nil)
            precondition(contextReading(nil, usedTokens: 170461) == "170.5k")
            precondition(contextReading(16.26, usedTokens: 170461) == "16.3%")
            precondition(contextReading(nil, usedTokens: nil) == "—")
            precondition(contextReading(nil, usedTokens: .nan) == "—")
            precondition(contextReading(nil, usedTokens: -1) == "—")
            checkpoint("actual ball rendering")
            let readingBall = BallView(frame: NSRect(x: 0, y: 0, width: 56, height: 56))
            func ballPixels(_ percent: Double?, tokens: Double?) -> Data {
                readingBall.percent = percent; readingBall.usedTokens = tokens
                let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 56, pixelsHigh: 56,
                    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
                bitmap.bitmapData!.initialize(repeating: 0, count: bitmap.bytesPerRow * bitmap.pixelsHigh)
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
                readingBall.draw(readingBall.bounds)
                NSGraphicsContext.restoreGraphicsState()
                return Data(bytes: bitmap.bitmapData!, count: bitmap.bytesPerRow * bitmap.pixelsHigh)
            }
            let unknownBall = ballPixels(nil, tokens: nil)
            precondition(ballPixels(nil, tokens: 170461) != unknownBall, "Actual draw must show the known token count")
            precondition(ballPixels(16.26, tokens: 170461) == ballPixels(16.26, tokens: nil), "Percent keeps priority and its original precision")
            precondition(ballPixels(nil, tokens: nil) == unknownBall, "Unknown sessions clear the previous token reading")
            checkpoint("island geometry")
            precondition(LensUITheme.allCases.count == 9)
            precondition(LensIsland.allCases.count == 7)
            precondition(LensIsland.usage.height == 520 && LensIsland.cost.height == 420)
            for material in LensMaterial.allCases {
                for island in LensIsland.allCases { precondition(LensIsland.at(island.labelPoint, material: material) == island) }
                precondition(LensIsland.at(OrbitGeometry.center, material: material) == nil)
                precondition(LensIsland.at(NSPoint(x: 1, y: 1), material: material) == nil)
            }
            checkpoint("theme persistence")
            let suite = "context-lens-ui-test-" + UUID().uuidString
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            var style = LensUIStyle.load(defaults)
            precondition(style.theme == .native && style.warningPulse)
            var faces = Set<String>()
            for preset in LensUITheme.allCases {
                checkpoint("font: \(preset.rawValue)")
                precondition(style.apply(["uiTheme": preset.rawValue])); style.save(defaults); style = LensUIStyle.load(defaults)
                precondition(style.theme == preset && style.motion.enter >= style.motion.exit)
                let face = style.typography.numberFont(size: 16).fontName
                precondition(face.hasPrefix("TimesNewRoman")); faces.insert(face)
            }
            precondition(faces.count == 4)
            let before = style.message; var message = before; message["uiTheme"] = "unknown-theme"
            precondition(!style.apply(message) && style.message == before)
            for preset in LensUITheme.allCases {
                checkpoint("typography: \(preset.rawValue)")
                checkpoint("Chinese font: \(preset.typography.chinese.font(size: 11, bold: preset.typography.bold).fontName)")
                for value in ["52%", "128.4k", "1.20M", "$1.28", "¥2.00", "—"] {
                    let reading = preset.typography.reading(value, size: 16, color: .labelColor)
                    precondition(reading.string == value)
                    reading.enumerateAttributes(in: NSRange(location: 0, length: reading.length)) { attributes, _, _ in
                        precondition(attributes[.baselineOffset] == nil)
                        precondition((attributes[.font] as? NSFont)?.pointSize == 16)
                    }
                    let title = CTLineGetBoundsWithOptions(CTLineCreateWithAttributedString(IslandLabel.titleReading("上下文", style: LensUIStyle(theme: preset))), .useGlyphPathBounds)
                    let valueBounds = CTLineGetBoundsWithOptions(CTLineCreateWithAttributedString(preset.typography.reading(value, size: 14, color: .labelColor)), .useGlyphPathBounds)
                    let positions = islandTextOrigins(title: title, value: valueBounds, in: CGRect(x: 0, y: 0, width: 64, height: 40))
                    precondition(abs((positions.title.y + title.minY) - (positions.value.y + valueBounds.maxY) - 5) < 0.001)
                    precondition(positions.value.y + valueBounds.minY >= 0 && positions.title.y + title.maxY <= 40)
                }
                checkpoint("ball: \(preset.rawValue)")
                let ball = BallView(frame: NSRect(x: 0, y: 0, width: 56, height: 56)); ball.style = LensUIStyle(theme: preset)
                let down = NSEvent.mouseEvent(with: .leftMouseDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
                let up = NSEvent.mouseEvent(with: .leftMouseUp, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, eventNumber: 1, clickCount: 1, pressure: 0)!
                checkpoint("press: \(preset.rawValue)")
                ball.mouseDown(with: down); precondition(ball.layer?.affineTransform() == .identity)
                checkpoint("release: \(preset.rawValue)")
                ball.mouseUp(with: up); precondition(ball.layer?.affineTransform() == .identity && ball.bounds.size == NSSize(width: 56, height: 56))
            }
            checkpoint("identity and window bounds")
            precondition(abs(LensIsland.allCases.reduce(CGFloat(0)) { $0 + $1.span } - 360) < 0.001)
            for island in LensIsland.allCases { precondition(LensIsland.at(island.labelPoint) == island) }
            precondition(LensIsland.at(OrbitGeometry.center) == nil, "The central ball must remain reachable")
            precondition(LensIsland.at(NSPoint(x: 1, y: 1)) == nil, "Transparent corners must pass through")
            precondition(LensIsland.at(NSPoint(x: OrbitGeometry.center.x, y: OrbitGeometry.center.y + 70)) == nil, "The gaps between islands are not buttons")
            precondition(validSession("codex:abc-123")); precondition(validSession("deepseek:session_123")); precondition(!validSession("codex:../credentials")); precondition(!validSession("https://example.com"))
            precondition(visibleSessionId("codex://threads/abc-123?view=chat") == "abc-123")
            precondition(visibleSessionId("codex://threads/abc-123?return=/code/local_other") == "abc-123")
            precondition(visibleSessionId("/code/local_a-123") == "local_a-123")
            precondition(visibleSessionId("https://claude.ai/code/local_a-123/?view=code#tab") == "local_a-123")
            for route in ["/code/other", "/code/local_", "/code/local_../", "/code/local_a/../secret", "/code/local_a\n", "/code/local_" + String(repeating: "a", count: 95)] {
                precondition(visibleSessionId(route) == nil)
            }
            precondition(visibleSessionId("file:///Users/workspace") == nil)
            precondition(agentClient(bundle: "com.openai.codex", name: "Codex") == "codex")
            precondition(agentClient(bundle: "com.google.antigravity", name: "Antigravity") == "agy")
            let agyFixture = "20000000-0000-0000-0000-000000000001"
            precondition(antigravitySessionId("http://127.0.0.1:53492/c/\(agyFixture)?project=1") == agyFixture)
            precondition(antigravitySessionId("https://example.com/c/\(agyFixture)") == nil)
            precondition(antigravitySessionId("http://127.0.0.1/c/\(agyFixture)/preview") == nil)
            precondition(clampedOrigin(NSPoint(x: -10, y: 200), size: NSSize(width: 56, height: 56), screen: NSRect(x: 0, y: 0, width: 100, height: 100)) == NSPoint(x: 0, y: 44))
            precondition(clampedOrigin(NSPoint(x: -1400, y: -200), size: NSSize(width: 420, height: 620), screen: NSRect(x: -1920, y: 0, width: 1920, height: 1080)) == NSPoint(x: -1400, y: 0))
            precondition(fittedFrame(NSRect(x: 800, y: 300, width: 1440, height: 1200), screen: NSRect(x: 0, y: 24, width: 1024, height: 744)) == NSRect(x: 0, y: 24, width: 1024, height: 744))
            checkpoint("visibility")
            var state = LensVisibility()
            state.activate("codex:1", supported: true); precondition(state.ball && !state.panel)
            state.open(); state.activate("lens", supported: false, own: true); precondition(state.ball && state.panel)
            state.activate("codex:1", supported: true); precondition(state.ball && state.panel, "Returning from our controls must preserve an open detail card")
            state.hide(); precondition(!state.ball && !state.panel)
            state.activate("lens", supported: false, own: true)
            state.activate("codex:1", supported: true); precondition(!state.ball, "Menu focus return must not undo manual hiding")
            state.activate("finder:2", supported: false); precondition(!state.ball && !state.panel)
            state.activate("codex:1", supported: true); precondition(state.ball && !state.panel)
            state.hide(); state.activate("claude:3", supported: true); precondition(state.ball)
            state.open(); state.activate("finder:2", supported: false); precondition(!state.ball && !state.panel)
            state.open(); precondition(state.ball && state.panel, "Explicit menu opening works over unrelated apps")
            state.collapse(); precondition(state.ball && !state.panel)
            state.activate("finder:2", supported: false); precondition(state.ball, "Returning to the same app must preserve explicit restore")
            state.activate("preview:4", supported: false); precondition(!state.ball)
            checkpoint("bounded navigation fixtures")
            checkNavigationFixtures()
            checkpoint("actual drag lifecycle")
            _ = NSApplication.shared
            var finished = false
            Task { @MainActor in
                await LensApp.checkDragLifecycle()
                finished = true
                CFRunLoopStop(CFRunLoopGetMain())
            }
            // 主线程事件循环继续处理实际的计时器回调，测试在主 Actor 上让出执行权。
            CFRunLoopRun()
            precondition(finished, "原生拖动自检提前退出")
            print("Context Lens desktop checks passed: seven islands, nine fixed themes, persistence, four Times New Roman faces, hit regions, identity, bounds and visibility")
        } else {
            let app = NSApplication.shared
            let delegate = LensApp(); app.delegate = delegate; app.setActivationPolicy(.accessory); app.run()
        }
    }
}
