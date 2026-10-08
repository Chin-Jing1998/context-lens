import AppKit

// Local UI acceptance fixture. It has no network access, provider credentials or chat contents.
@MainActor final class SessionFixture: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 460, y: 520, width: 340, height: 180), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "整理查询结果"
        let label = NSTextField(labelWithString: "Context Lens 会话切换验收")
        label.frame = NSRect(x: 24, y: 112, width: 300, height: 24)
        let first = NSButton(title: "切换到第一会话", target: self, action: #selector(showFirst))
        let second = NSButton(title: "切换到第二会话", target: self, action: #selector(showSecond))
        first.frame = NSRect(x: 20, y: 50, width: 145, height: 32); second.frame = NSRect(x: 175, y: 50, width: 145, height: 32)
        window.contentView?.addSubview(label); window.contentView?.addSubview(first); window.contentView?.addSubview(second)
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    @objc func showFirst() { window.title = "整理查询结果"; NSApp.activate(ignoringOtherApps: true) }
    @objc func showSecond() { window.title = "核对会话切换"; NSApp.activate(ignoringOtherApps: true) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
@main struct FixtureMain {
    @MainActor static func main() {
        let app = NSApplication.shared, delegate = SessionFixture()
        app.setActivationPolicy(.regular); app.delegate = delegate; app.run()
    }
}
