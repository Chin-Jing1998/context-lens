import AppKit
import WebKit
import ApplicationServices
import CoreText

@MainActor var lensReduceMotion: Bool {
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion || UserDefaults.standard.bool(forKey: "reduceMotion")
}

func validSession(_ value: String) -> Bool {
    value.range(of: "^(claude|codex|opencode|mimocode|deepseek|zcode):[a-zA-Z0-9_-]{1,100}$", options: .regularExpression) != nil
}

func agentClient(bundle: String, name: String) -> String? {
    if bundle == "com.openai.codex" { return "codex" }
    if bundle == "com.anthropic.claudefordesktop" { return "claude" }
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
    let pattern = "(?:/(?:threads?|sessions?|chats?|conversations?)/|(?:thread|session|chat)[-_:])([a-zA-Z0-9_-]{1,100})(?:[/?#]|$)"
    guard let expression = try? NSRegularExpression(pattern: pattern),
          let match = expression.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
          let range = Range(match.range(at: 1), in: value) else { return nil }
    return String(value[range])
}
// Read navigation identity only. Chat message values and editable text are never requested.
func frontmostSession(_ app: NSRunningApplication, client: String?) -> FrontmostSession {
    guard AXIsProcessTrusted() else { return FrontmostSession() }
    func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
    func string(_ element: AXUIElement, _ name: String) -> String { (attribute(element, name) as? String) ?? "" }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 0.03)
    guard let focused = attribute(root, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() else { return FrontmostSession() }
    let window = focused as! AXUIElement
    var result = FrontmostSession()
    let document = string(window, kAXDocumentAttribute)
    if let id = visibleSessionId(document) { result.id = id; return result }
    if let url = URL(string: document), url.isFileURL { result.cwd = url.path }
    let windowTitle = string(window, kAXTitleAttribute)
    if let tty = windowTitle.range(of: "ttys?\\d{1,6}", options: .regularExpression) { result.tty = String(windowTitle[tty]) }
    var queue: [(AXUIElement, Int, String)] = [(window, 0, "")], cursor = 0
    let deadline = Date().addingTimeInterval(0.18)
    var selectedTitles: [String] = [], headings: [String] = []
    while cursor < queue.count && cursor < 900 && Date() < deadline {
        let (node, depth, parentRole) = queue[cursor]; cursor += 1
        let role = string(node, kAXRoleAttribute), identifier = string(node, kAXIdentifierAttribute)
        if let id = visibleSessionId(identifier) {
            let selected = (attribute(node, kAXSelectedAttribute) as? Bool) == true
            if selected || role == "AXHeading" { result.id = id; return result }
        }
        if role == "AXHeading" && headings.count < 3 {
            let value = string(node, kAXTitleAttribute).isEmpty ? string(node, kAXValueAttribute) : string(node, kAXTitleAttribute)
            if !value.isEmpty && value.count <= 200 { headings.append(value) }
        }
        if (attribute(node, kAXSelectedAttribute) as? Bool) == true && (role == "AXRow" || parentRole == "AXOutline" || identifier.lowercased().contains("thread")) {
            var title = string(node, kAXTitleAttribute)
            if title.isEmpty, let children = attribute(node, kAXChildrenAttribute) as? [AXUIElement] {
                title = children.prefix(4).map { string($0, kAXTitleAttribute).isEmpty ? string($0, kAXValueAttribute) : string($0, kAXTitleAttribute) }.first { !$0.isEmpty && $0.count <= 200 } ?? ""
            }
            if !title.isEmpty && title.count <= 200 { selectedTitles.append(title) }
        }
        if depth < 10 && !["AXTextArea", "AXTextField", "AXStaticText"].contains(role), let children = attribute(node, kAXChildrenAttribute) as? [AXUIElement] {
            queue.append(contentsOf: children.prefix(120).map { ($0, depth + 1, role) })
        }
    }
    if let title = selectedTitles.first { result.title = title }
    else if client != nil, let title = headings.first(where: { $0.lowercased() != (app.localizedName ?? "").lowercased() }) { result.title = title }
    else if client != nil {
        var title = windowTitle
        for suffix in [" — " + (app.localizedName ?? ""), " - " + (app.localizedName ?? "")] { if title.hasSuffix(suffix) { title = String(title.dropLast(suffix.count)) } }
        if !title.isEmpty && title.count <= 200 && title.lowercased() != (app.localizedName ?? "").lowercased() { result.title = title }
    }
    return result
}

func shortNumber(_ value: Double) -> String {
    if value >= 1_000_000 { return String(format: "%.1fM", value / 1_000_000) }
    if value >= 1_000 { return String(format: "%.1fk", value / 1_000) }
    return String(format: "%.0f", value)
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
        let font = names.compactMap { NSFont(name: $0, size: size) }.first ?? NSFont.systemFont(ofSize: size)
        return bold ? NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) : font
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
        let value = percent.map { String(format: "%.0f%%", $0) } ?? "—"
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
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { escape?() }
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
    private var pinned = false
    private var activeIsland = LensIsland.context
    private var islandHeights: [LensIsland: CGFloat] = [:]
    private var settingsHeight: CGFloat = 420
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
                                    "ballVisible": ball.isVisible, "panelVisible": panel.isVisible, "ballAlpha": ball.alphaValue, "panelAlpha": panel.alphaValue,
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
        ballView.dragStarted = { [weak self] in self?.closeOrbit(restore: false, reason: "drag") }
        ballView.moved = { [weak self] in
            guard let self else { return }
            guard let screen = self.ball.screen else {
                UserDefaults.standard.set(NSStringFromPoint(self.ball.frame.origin), forKey: "position"); return
            }
            let snapThreshold: CGFloat = 24
            let vis = screen.visibleFrame
            var origin = self.ball.frame.origin
            let size = self.ball.frame.size
            var snapped = false
            if abs(origin.x - vis.minX) < snapThreshold { origin.x = vis.minX + 8; snapped = true }
            else if abs(origin.x + size.width - vis.maxX) < snapThreshold { origin.x = vis.maxX - size.width - 8; snapped = true }
            if abs(origin.y - vis.minY) < snapThreshold { origin.y = vis.minY + 8; snapped = true }
            else if abs(origin.y + size.height - vis.maxY) < snapThreshold { origin.y = vis.maxY - size.height - 8; snapped = true }
            if snapped && !lensReduceMotion {
                NSAnimationContext.runAnimationGroup { ctx in
                    ctx.duration = 0.28
                    ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.34, 1.56, 0.64, 1)
                    self.ball.animator().setFrameOrigin(origin)
                }
            } else if snapped {
                self.ball.setFrameOrigin(origin)
            }
            UserDefaults.standard.set(NSStringFromPoint(self.ball.frame.origin), forKey: "position")
        }
        ball.contentView = glassContent(ballView, radius: 28)
        if let saved = UserDefaults.standard.string(forKey: "position") {
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
        hoverTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in Task { @MainActor in self?.trackHover() } }
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
        let config = WKWebViewConfiguration(); config.userContentController.add(self, name: "lens")
        web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config); web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground"); web.autoresizingMask = [.width, .height]
        panel.contentView = glassContent(web, radius: 20)
    }

    private func applyVisibility() {
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
                        guard let self, let window else { return }
                        let stillHidden = window === self.ball ? !self.visibility.ball : !self.visibility.panel
                        if stillHidden { window.orderOut(nil) }
                        window.alphaValue = 1
                    }
                })
            }
        }
    }
    private func animate(_ window: NSWindow, show: Bool) {
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
                guard let self, let window else { return }
                let visible = window === self.orbit ? self.orbitOpen : self.visibility.panel
                if !visible { window.orderOut(nil) }
            }
        })
    }
    private func showOrbit() {
        guard visibility.ball, !orbitOpen, panel != nil else { return }
        orbitOpen = true; leftSince = nil; collapsedOrigin = ball.frame.origin
        let screen = ball.screen?.visibleFrame ?? NSScreen.main!.visibleFrame
        let origin = clampedOrigin(NSPoint(x: ball.frame.midX - OrbitGeometry.center.x, y: ball.frame.midY - OrbitGeometry.center.y), size: orbit.frame.size, screen: screen.insetBy(dx: 8, dy: 8))
        orbit.setFrameOrigin(origin)
        ball.setFrameOrigin(NSPoint(x: origin.x + OrbitGeometry.center.x - ball.frame.width / 2, y: origin.y + OrbitGeometry.center.y - ball.frame.height / 2))
        animate(orbit, show: true); ball.orderFrontRegardless()
    }
    private func closeOrbit(restore: Bool = true, reason: String = "explicit") {
        guard orbit != nil, panel != nil, orbitOpen || visibility.panel else { return }
        traceEvent("close-" + reason)
        orbitOpen = false; pinned = false; hoverIsland = nil; orbitView.selected = nil
        detailTransition += 1
        detailSizing = false
        if webReady { dispatch("context-lens-card-transition", "end") }
        visibility.collapse(); animate(panel, show: false); animate(orbit, show: false)
        if let origin = collapsedOrigin, restore { ball.setFrameOrigin(origin) }
        collapsedOrigin = nil
    }
    private func toggleOrbit() { traceEvent("ball-toggle"); if orbitOpen { closeOrbit(reason: "ball-toggle") } else { showOrbit(); pinned = true } }
    private func trackHover() {
        guard orbitOpen else { return }
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
        traceEvent("show-" + island.rawValue + (pin ? "-pinned" : "-hover"))
        showOrbit(); pinned = pin; activeIsland = island; orbitView.selected = island
        let wasVisible = visibility.panel
        if !settingsPresented { fitDetail(height: islandHeights[island] ?? island.height, width: uiStyle.theme.width(for: island)) }
        dispatch("context-lens-island", island.rawValue)
        visibility.open()
        if !wasVisible { animate(panel, show: true) }
        if pin { panel.makeKeyAndOrderFront(nil) }
    }
    @objc private func showPanel() { visibility.restore(); applyVisibility(); showIsland(activeIsland, pin: true) }
    @objc private func collapsePanel() { closeOrbit(reason: "collapse") }
    @objc private func toggleBall() {
        if visibility.ball { closeOrbit(reason: "hide"); visibility.hide() } else { visibility.restore() }
        applyVisibility()
    }
    @objc private func showSettings() {
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
        if visibility.panel { fitDetail(height: settingsPresented ? settingsHeight : islandHeights[activeIsland] ?? activeIsland.height, width: settingsPresented ? uiStyle.theme.settingsWidth : uiStyle.theme.width(for: activeIsland), animated: false) }
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
        timer?.invalidate(); hoverTimer?.invalidate(); if backend?.isRunning == true { backend?.terminate() }
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
        visibleHint = frontmostSession(app, client: client); targetRevision += 1
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
        let refreshRevision = targetRevision
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
            if hint != visibleHint { visibleHint = hint; targetRevision += 1 }
        }
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
            let next = data?["selected"] as? String ?? ""
            if next != selection { updateBall(nil, client: "正在读取", help: "自动跟随活跃对话") }
            selection = next
            let reason = data?["reason"] as? String ?? "无法定位活跃会话，请检查本地服务"
            dispatch("context-lens-active", ["session": selection, "reason": reason])
        }
        guard validSession(selection) else { updateBall(nil, client: "等待对话", help: "自动跟随活跃对话"); return }
        let key = selection, mode = view
        var url = URLComponents(url: origin.appendingPathComponent("api/snapshot"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "session", value: key), URLQueryItem(name: "view", value: mode)]
        do {
            let data = try await json(url.url!)
            guard key == selection && mode == view else { return }
            let context = data["context"] as? [String: Any] ?? [:]
            let percent = (context["percent"] as? NSNumber)?.doubleValue
            let value = percent.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
            let totals = (data["totals"] as? [String: Any])?["all"] as? [String: Any] ?? [:]
            if let input = totals["input"] as? Double, let output = totals["output"] as? Double { orbitView.labels[.usage]?.value = shortNumber(input + output) }
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
            let tool = key.split(separator: ":").first.map(String.init) ?? ""
            let name = ["claude": "Claude", "codex": "Codex", "opencode": "OpenCode", "mimocode": "MiMo", "deepseek": "DeepSeek", "zcode": "ZCode"][tool] ?? tool
            updateBall(value, client: name,
                       help: mode == "budget" ? "压缩预算" : "模型窗口")
        } catch { networkError = true; if key == selection { updateBall(nil, client: "离线", help: "连接中断或会话已移除；点击展开检查") } }
    }
    private func updateBall(_ percent: Double?, client: String, help: String) {
        orbitView.labels[.context]?.value = percent.map { String(format: "%.1f%%", $0) } ?? "—"
        if percent == nil && !["Claude", "Codex", "OpenCode", "MiMo", "DeepSeek", "ZCode"].contains(client) { for island in LensIsland.allCases { orbitView.labels[island]?.value = "—" } }
        ballView.percent = percent; ballView.toolTip = "\(client)\n\(help)"; ballView.needsDisplay = true
        let value = percent.map { String(format: "%@ %.1f%%", client, $0) } ?? "\(client) 未知"
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
            pinned = true; settingsPresented = true
            fitDetail(height: settingsHeight, width: uiStyle.theme.settingsWidth)
        case "settings-layout":
            guard settingsPresented, !detailSizing,
                  let reportedWidth = body["width"].flatMap(Double.init), reportedWidth.isFinite, abs(reportedWidth - web.frame.width) < 1,
                  let value = body["height"].flatMap(Double.init), value.isFinite, value > 0, value <= 100_000 else { return }
            settingsHeight = CGFloat(value)
            if visibility.panel { fitDetail(height: settingsHeight, width: uiStyle.theme.settingsWidth) }
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
}

@main struct ContextLens {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--self-test") {
            precondition(LensUITheme.allCases.count == 9)
            precondition(LensIsland.allCases.count == 7)
            precondition(LensIsland.usage.height == 520 && LensIsland.cost.height == 420)
            for material in LensMaterial.allCases {
                for island in LensIsland.allCases { precondition(LensIsland.at(island.labelPoint, material: material) == island) }
                precondition(LensIsland.at(OrbitGeometry.center, material: material) == nil)
                precondition(LensIsland.at(NSPoint(x: 1, y: 1), material: material) == nil)
            }
            let suite = "context-lens-ui-test-" + UUID().uuidString
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            var style = LensUIStyle.load(defaults)
            precondition(style.theme == .native && style.warningPulse)
            var faces = Set<String>()
            for preset in LensUITheme.allCases {
                precondition(style.apply(["uiTheme": preset.rawValue])); style.save(defaults); style = LensUIStyle.load(defaults)
                precondition(style.theme == preset && style.motion.enter >= style.motion.exit)
                let face = style.typography.numberFont(size: 16).fontName
                precondition(face.hasPrefix("TimesNewRoman")); faces.insert(face)
            }
            precondition(faces.count == 4)
            let before = style.message; var message = before; message["uiTheme"] = "unknown-theme"
            precondition(!style.apply(message) && style.message == before)
            for preset in LensUITheme.allCases {
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
                let ball = BallView(frame: NSRect(x: 0, y: 0, width: 56, height: 56)); ball.style = LensUIStyle(theme: preset)
                let down = NSEvent.mouseEvent(with: .leftMouseDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
                let up = NSEvent.mouseEvent(with: .leftMouseUp, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, eventNumber: 1, clickCount: 1, pressure: 0)!
                ball.mouseDown(with: down); precondition(ball.layer?.affineTransform() == .identity)
                ball.mouseUp(with: up); precondition(ball.layer?.affineTransform() == .identity && ball.bounds.size == NSSize(width: 56, height: 56))
            }
            precondition(abs(LensIsland.allCases.reduce(CGFloat(0)) { $0 + $1.span } - 360) < 0.001)
            for island in LensIsland.allCases { precondition(LensIsland.at(island.labelPoint) == island) }
            precondition(LensIsland.at(OrbitGeometry.center) == nil, "The central ball must remain reachable")
            precondition(LensIsland.at(NSPoint(x: 1, y: 1)) == nil, "Transparent corners must pass through")
            precondition(LensIsland.at(NSPoint(x: OrbitGeometry.center.x, y: OrbitGeometry.center.y + 70)) == nil, "The gaps between islands are not buttons")
            precondition(validSession("codex:abc-123")); precondition(validSession("deepseek:session_123")); precondition(!validSession("codex:../credentials")); precondition(!validSession("https://example.com"))
            precondition(visibleSessionId("codex://threads/abc-123?view=chat") == "abc-123")
            precondition(visibleSessionId("file:///Users/workspace") == nil)
            precondition(agentClient(bundle: "com.openai.codex", name: "Codex") == "codex")
            precondition(clampedOrigin(NSPoint(x: -10, y: 200), size: NSSize(width: 56, height: 56), screen: NSRect(x: 0, y: 0, width: 100, height: 100)) == NSPoint(x: 0, y: 44))
            precondition(clampedOrigin(NSPoint(x: -1400, y: -200), size: NSSize(width: 420, height: 620), screen: NSRect(x: -1920, y: 0, width: 1920, height: 1080)) == NSPoint(x: -1400, y: 0))
            precondition(fittedFrame(NSRect(x: 800, y: 300, width: 1440, height: 1200), screen: NSRect(x: 0, y: 24, width: 1024, height: 744)) == NSRect(x: 0, y: 24, width: 1024, height: 744))
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
            print("Context Lens desktop checks passed: seven islands, nine fixed themes, persistence, four Times New Roman faces, hit regions, identity, bounds and visibility")
        } else {
            let app = NSApplication.shared
            let delegate = LensApp(); app.delegate = delegate; app.setActivationPolicy(.accessory); app.run()
        }
    }
}
