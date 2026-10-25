import Cocoa
import WebKit
import UniformTypeIdentifiers

private enum SnapSide {
    case left, right, full
}

private final class TileHighlightView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        wantsLayer = true
    }

    override var isOpaque: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 14, yRadius: 14)
        NSColor(calibratedWhite: 1, alpha: 0.28).setFill()
        path.fill()
        NSColor(calibratedWhite: 1, alpha: 0.62).setStroke()
        path.lineWidth = 2
        path.stroke()
    }
}

private final class TileHighlightPanel: NSPanel {
    init() {
        super.init(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        isReleasedWhenClosed = false
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        ignoresMouseEvents = true
        hidesOnDeactivate = false
        level = .normal
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        contentView = TileHighlightView()
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

enum LaunchError: LocalizedError {
    case missingFiles
    case pythonMissing
    case serverFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingFiles:
            return "The Melon files could not be found."
        case .pythonMissing:
            return "Python 3 is needed to open Melon."
        case .serverFailed(let detail):
            return detail.isEmpty
                ? "Melon could not start. See /tmp/melon-server.log."
                : "Melon could not start. See /tmp/melon-server.log.\n\n\(detail)"
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let port = 5173
    private var window: NSWindow?
    private var webView: WKWebView?
    private var printWebView: WKWebView?
    private var server: Process?
    private var pendingTitle = "Melon"
    private var dragMonitor: Any?
    private var dragHoles: [NSRect] = []
    private var dragStartMouse: NSPoint?
    private var dragStartOrigin: NSPoint?
    private var dragStartFrame = NSRect.zero
    private var dragGrabFraction: CGFloat = 0.5
    private var dragGrabFromTop: CGFloat = 12
    private var preSnapFrame: NSRect?
    private var snapSide: SnapSide?
    private var snappedScreenFrame: NSRect?
    private var previewSide: SnapSide?
    private var previewScreenFrame: NSRect?
    private var tileHighlight: TileHighlightPanel?
    private let normalMinSize = NSSize(width: 880, height: 600)
    private let pointerSnapMargin: CGFloat = 12
    private let pointerHoldMargin: CGFloat = 36

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenu()
        if activateExisting() { return }
        NSApp.activate(ignoringOtherApps: true)
        do {
            let root = try siteRoot()
            try startServer(root: root)
            try waitUntilReady()
            showWindow()
        } catch {
            alert((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            NSApp.terminate(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        stopServer()
        return .terminateNow
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        switch message.name {
        case "melonPrint":
            let html = body["html"] as? String ?? ""
            pendingTitle = body["title"] as? String ?? "Melon"
            showPDF(html: html)
        case "melonSave":
            let filename = body["filename"] as? String ?? "Melon.xlsx"
            let base64 = body["base64"] as? String ?? ""
            showExcel(filename: filename, base64: base64)
        case "melonDrag":
            applyDragHoles(body["holes"])
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === self.webView {
            let title = webView.title ?? ""
            window?.title = title.isEmpty ? "Melon" : title
            return
        }
        exportPDF(from: webView)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https",
           let host = url.host,
           host != "127.0.0.1", host != "localhost" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func setupMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Melon", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Melon", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")

        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = main
    }

    private func activateExisting() -> Bool {
        let identifier = Bundle.main.bundleIdentifier ?? "local.melon.calculators"
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
            .filter { $0.processIdentifier != getpid() }
        guard let existing = others.first else { return false }
        existing.unhide()
        existing.activate(options: [.activateAllWindows])
        exit(0)
    }

    private func siteRoot() throws -> URL {
        let executable = Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0])
        let app = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let sibling = app.deletingLastPathComponent().appendingPathComponent("content", isDirectory: true)
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("site", isDirectory: true)
        if let bundled, isReadableSite(bundled) { return bundled }
        if isReadableSite(sibling) { return sibling }
        throw LaunchError.missingFiles
    }

    private func isReadableSite(_ root: URL) -> Bool {
        let index = root.appendingPathComponent("index/index.html")
        guard let data = try? Data(contentsOf: index) else { return false }
        return String(data: data, encoding: .utf8)?.contains("<title>Melon</title>") == true
    }

    private func startServer(root: URL) throws {
        freePort()
        let python = "/usr/bin/python3"
        guard FileManager.default.isExecutableFile(atPath: python) else { throw LaunchError.pythonMissing }
        let logURL = URL(fileURLWithPath: "/tmp/melon-server.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: logURL)
        try handle.seekToEnd()
        let banner = "---- \(Date()) ----\nserving \(root.path)\n"
        try handle.write(contentsOf: Data(banner.utf8))

        let process = Process()
        process.executableURL = URL(fileURLWithPath: python)
        process.arguments = ["-m", "http.server", "\(port)", "--bind", "127.0.0.1"]
        process.currentDirectoryURL = root
        process.standardOutput = handle
        process.standardError = handle
        try process.run()
        server = process
    }

    private func waitUntilReady() throws {
        guard let url = URL(string: "http://127.0.0.1:\(port)/index/index.html") else {
            throw LaunchError.serverFailed("")
        }
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if let server, !server.isRunning {
                throw LaunchError.serverFailed(logTail())
            }
            if pageIsReady(url) { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        }
        throw LaunchError.serverFailed(logTail())
    }

    private func pageIsReady(_ url: URL) -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        var ready = false
        let task = URLSession.shared.dataTask(with: url) { data, response, _ in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            ready = code == 200 && body.contains("<title>Melon</title>")
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 1)
        return ready
    }

    private func showWindow() {
        let dark = NSColor(srgbRed: 20 / 255, green: 20 / 255, blue: 20 / 255, alpha: 1)
        let content = WKUserContentController()
        let marker = WKUserScript(
            source: "document.documentElement.classList.add('melon-app')",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        let dragScript = WKUserScript(
            source: """
            (function () {
              function report() {
                var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.melonDrag
                var bar = document.querySelector('.titlebar')
                if (!handler || !bar) return
                var holes = Array.prototype.map.call(bar.querySelectorAll('button, a, input, select'), function (el) {
                  var rect = el.getBoundingClientRect()
                  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
                })
                handler.postMessage({ holes: holes })
              }
              var bar = document.querySelector('.titlebar')
              if (bar && window.ResizeObserver) new ResizeObserver(report).observe(bar)
              window.addEventListener('resize', report)
              report()
              requestAnimationFrame(report)
            })()
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        content.addUserScript(marker)
        content.addUserScript(dragScript)
        content.add(self, name: "melonPrint")
        content.add(self, name: "melonSave")
        content.add(self, name: "melonDrag")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = content

        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.underPageBackgroundColor = dark
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Melon"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = dark
        window.appearance = NSAppearance(named: .darkAqua)
        window.minSize = normalMinSize
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("MelonWindow")
        window.makeKeyAndOrderFront(nil)
        self.window = window
        self.webView = web
        installDragMonitor()
        web.addObserver(self, forKeyPath: #keyPath(WKWebView.title), options: .new, context: nil)
        if let url = URL(string: "http://127.0.0.1:\(port)/index/index.html") {
            web.load(URLRequest(url: url))
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    private func installDragMonitor() {
        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { [weak self] event in
            guard let self, let window = self.window else { return event }
            switch event.type {
            case .leftMouseDown:
                guard self.pointInTitlebar(event) else { return event }
                let mouse = NSEvent.mouseLocation
                window.setFrame(window.frame, display: false)
                self.dragStartMouse = mouse
                self.dragStartOrigin = window.frame.origin
                self.dragStartFrame = window.frame
                let width = max(window.frame.width, 1)
                self.dragGrabFraction = (mouse.x - window.frame.minX) / width
                self.dragGrabFromTop = window.frame.maxY - mouse.y
                return nil
            case .leftMouseDragged:
                guard let start = self.dragStartMouse, let origin = self.dragStartOrigin else { return event }
                let now = NSEvent.mouseLocation
                if self.snapSide != nil {
                    let moved = hypot(now.x - start.x, now.y - start.y)
                    if moved < 4 { return nil }
                    self.liftOutOfTile(at: now)
                } else {
                    window.setFrameOrigin(NSPoint(x: origin.x + now.x - start.x, y: origin.y + now.y - start.y))
                }
                self.updatePreview(at: now)
                return nil
            case .leftMouseUp:
                let dragging = self.dragStartMouse != nil
                if dragging, let side = self.previewSide, let screen = self.screen(matching: self.previewScreenFrame) {
                    self.commitTile(side, on: screen)
                } else if dragging, self.snapSide == nil {
                    self.preSnapFrame = nil
                    self.hidePreview()
                }
                self.dragStartMouse = nil
                self.dragStartOrigin = nil
                return dragging ? nil : event
            default:
                return event
            }
        }
    }

    private func screen(at point: NSPoint) -> NSScreen? {
        if let match = NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) }) {
            return match
        }
        return NSScreen.screens.min { lhs, rhs in
            hypot(lhs.frame.midX - point.x, lhs.frame.midY - point.y) < hypot(rhs.frame.midX - point.x, rhs.frame.midY - point.y)
        }
    }

    private func isOuterEdge(_ side: SnapSide, of screen: NSScreen) -> Bool {
        guard side == .left || side == .right else { return false }
        let frame = screen.frame
        let edge = side == .left ? frame.minX : frame.maxX
        return !NSScreen.screens.contains { other in
            guard other !== screen else { return false }
            let overlap = min(other.frame.maxY, frame.maxY) - max(other.frame.minY, frame.minY)
            guard overlap > 40 else { return false }
            let neighbor = side == .left ? other.frame.maxX : other.frame.minX
            return abs(neighbor - edge) < 4
        }
    }

    private func isTopEdge(of screen: NSScreen) -> Bool {
        let frame = screen.frame
        return !NSScreen.screens.contains { other in
            guard other !== screen else { return false }
            let overlap = min(other.frame.maxX, frame.maxX) - max(other.frame.minX, frame.minX)
            guard overlap > 40 else { return false }
            return abs(other.frame.minY - frame.maxY) < 4
        }
    }

    private func framesMatch(_ lhs: NSRect, _ rhs: NSRect) -> Bool {
        abs(lhs.minX - rhs.minX) < 1
            && abs(lhs.minY - rhs.minY) < 1
            && abs(lhs.width - rhs.width) < 1
            && abs(lhs.height - rhs.height) < 1
    }

    private func screen(matching frame: NSRect?) -> NSScreen? {
        guard let frame else { return nil }
        return NSScreen.screens.first { framesMatch($0.frame, frame) }
    }

    private func tileMargins() -> CGFloat {
        let value = CFPreferencesCopyAppValue("EnableTiledWindowMargins" as CFString, "com.apple.WindowManager" as CFString)
        let enabled = (value as? NSNumber)?.boolValue ?? true
        return enabled ? 8 : 0
    }

    private func previewTarget(at mouse: NSPoint) -> (SnapSide, NSScreen)? {
        guard let screen = screen(at: mouse) else { return nil }
        let frame = screen.frame
        if isOuterEdge(.left, of: screen), mouse.x - frame.minX <= pointerSnapMargin {
            return (.left, screen)
        }
        if isOuterEdge(.right, of: screen), frame.maxX - mouse.x <= pointerSnapMargin {
            return (.right, screen)
        }
        if isTopEdge(of: screen), mouse.y >= screen.visibleFrame.maxY - 2 {
            return (.full, screen)
        }
        return nil
    }

    private func pointerStillInPreview(_ mouse: NSPoint) -> Bool {
        guard let previewSide, let screen = screen(matching: previewScreenFrame) else { return false }
        let frame = screen.frame
        switch previewSide {
        case .left: return mouse.x - frame.minX <= pointerHoldMargin
        case .right: return frame.maxX - mouse.x <= pointerHoldMargin
        case .full:
            let overScreen = mouse.x >= frame.minX && mouse.x <= frame.maxX
            return overScreen && mouse.y >= screen.visibleFrame.maxY - pointerHoldMargin
        }
    }

    private func updatePreview(at mouse: NSPoint) {
        if let (side, screen) = previewTarget(at: mouse) {
            showPreview(side, on: screen)
        } else if previewSide != nil, !pointerStillInPreview(mouse) {
            hidePreview()
        }
    }

    private func showPreview(_ side: SnapSide, on screen: NSScreen) {
        guard let window else { return }
        let panel = tileHighlight ?? TileHighlightPanel()
        tileHighlight = panel
        let frame = snappedFrame(side, on: screen)
        let same = previewSide == side && previewScreenFrame.map { framesMatch($0, screen.frame) } == true
        previewSide = side
        previewScreenFrame = screen.frame
        if !same || !framesMatch(panel.frame, frame) {
            panel.setFrame(frame, display: true)
            panel.contentView?.needsDisplay = true
        }
        guard !panel.isVisible else {
            panel.order(.below, relativeTo: window.windowNumber)
            return
        }
        panel.alphaValue = 0
        panel.order(.below, relativeTo: window.windowNumber)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            panel.animator().alphaValue = 1
        }
    }

    private func hidePreview() {
        previewSide = nil
        previewScreenFrame = nil
        tileHighlight?.orderOut(nil)
    }

    private func snappedFrame(_ side: SnapSide, on screen: NSScreen) -> NSRect {
        let visible = screen.visibleFrame
        let scale = max(screen.backingScaleFactor, 1)
        func pixel(_ value: CGFloat) -> CGFloat { (value * scale).rounded() / scale }
        let margin = tileMargins()
        let minX = pixel(visible.minX + margin)
        let minY = pixel(visible.minY + margin)
        let maxX = pixel(visible.maxX - margin)
        let maxY = pixel(visible.maxY - margin)
        let height = maxY - minY
        switch side {
        case .full:
            return NSRect(x: minX, y: minY, width: maxX - minX, height: height)
        case .left, .right:
            if margin == 0 {
                let mid = pixel(minX + (maxX - minX) / 2)
                if side == .left {
                    return NSRect(x: minX, y: minY, width: mid - minX, height: height)
                }
                return NSRect(x: mid, y: minY, width: maxX - mid, height: height)
            }
            let width = pixel((maxX - minX - margin) / 2)
            if side == .left {
                return NSRect(x: minX, y: minY, width: width, height: height)
            }
            let x = pixel(maxX - width)
            return NSRect(x: x, y: minY, width: maxX - x, height: height)
        }
    }

    private func liftOutOfTile(at mouse: NSPoint) {
        guard let window, snapSide != nil else { return }
        let restored = preSnapFrame ?? dragStartFrame
        let size = restored.size
        window.minSize = NSSize(
            width: min(normalMinSize.width, size.width),
            height: min(normalMinSize.height, size.height)
        )
        let grabX = min(max(size.width * dragGrabFraction, 24), max(size.width - 24, 24))
        let fromTop = min(max(dragGrabFromTop, 8), max(size.height - 8, 8))
        let origin = NSPoint(x: mouse.x - grabX, y: mouse.y - (size.height - fromTop))
        let frame = NSRect(origin: origin, size: size)
        window.setFrame(frame, display: true)
        if size.width >= normalMinSize.width, size.height >= normalMinSize.height {
            window.minSize = normalMinSize
        }
        snapSide = nil
        snappedScreenFrame = nil
        dragStartMouse = mouse
        dragStartOrigin = origin
        dragStartFrame = frame
    }

    private func commitTile(_ side: SnapSide, on screen: NSScreen) {
        guard let window else { return }
        if preSnapFrame == nil {
            preSnapFrame = dragStartFrame
        }
        snapSide = side
        snappedScreenFrame = screen.frame
        hidePreview()
        let frame = snappedFrame(side, on: screen)
        window.minSize = NSSize(
            width: min(normalMinSize.width, frame.width),
            height: min(normalMinSize.height, frame.height)
        )
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.32
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            window.animator().setFrame(frame, display: true)
        } completionHandler: { [weak window] in
            guard let window, !self.framesMatch(window.frame, frame), self.snapSide == side else { return }
            window.setFrame(frame, display: true)
        }
    }

    private func pointInTitlebar(_ event: NSEvent) -> Bool {
        guard event.window === window, let webView else { return false }
        let local = webView.convert(event.locationInWindow, from: nil)
        let minY: CGFloat = webView.isFlipped ? 0 : webView.bounds.height - 38
        guard local.x >= 78, local.y >= minY, local.y <= minY + 38 else { return false }
        return !dragHoles.contains(where: { $0.insetBy(dx: -4, dy: -4).contains(local) })
    }

    private func applyDragHoles(_ raw: Any?) {
        guard let webView, let items = raw as? [Any] else { return }
        let height = webView.bounds.height
        let flipped = webView.isFlipped
        dragHoles = items.compactMap { item in
            guard let dict = item as? [String: Any] else { return nil }
            func length(_ key: String) -> CGFloat? {
                guard let number = dict[key] as? NSNumber else { return nil }
                return CGFloat(truncating: number)
            }
            guard let x = length("x"), let y = length("y"), let w = length("w"), let h = length("h"), w > 0, h > 0 else { return nil }
            let originY = flipped ? y : height - y - h
            return NSRect(x: x, y: originY, width: w, height: h)
        }
    }

    override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?) {
        guard keyPath == #keyPath(WKWebView.title) else { return }
        let title = webView?.title ?? ""
        window?.title = title.isEmpty ? "Melon" : title
    }

    private func showPDF(html: String) {
        guard let window else { return }
        printWebView?.removeFromSuperview()
        let printView = WKWebView(frame: NSRect(x: 0, y: 0, width: 816, height: 1056), configuration: WKWebViewConfiguration())
        printView.navigationDelegate = self
        printView.alphaValue = 0
        window.contentView?.addSubview(printView)
        printWebView = printView
        printView.loadHTMLString(html, baseURL: nil)
    }

    private func exportPDF(from webView: WKWebView) {
        webView.createPDF { [weak self] result in
            DispatchQueue.main.async {
                guard let self, let window = self.window else { return }
                switch result {
                case .success(let data):
                    self.save(data: data, title: self.pendingTitle, type: .pdf, fileExtension: "pdf")
                case .failure(let error):
                    self.alert(error.localizedDescription)
                }
                self.printWebView?.removeFromSuperview()
                self.printWebView = nil
                window.makeKeyAndOrderFront(nil)
            }
        }
    }

    private func showExcel(filename: String, base64: String) {
        guard let data = Data(base64Encoded: base64) else { return }
        let title = (filename as NSString).deletingPathExtension
        let type = UTType(filenameExtension: "xlsx") ?? .data
        save(data: data, title: title, type: type, fileExtension: "xlsx")
    }

    private func save(data: Data, title: String, type: UTType, fileExtension ext: String) {
        guard let window else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [type]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = safeName(title, ext: ext)
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url)
            } catch {
                self.alert(error.localizedDescription)
            }
        }
    }

    private func safeName(_ title: String, ext: String) -> String {
        let cleaned = title.replacingOccurrences(of: "[\\\\/:*?\"<>|]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let base = cleaned.isEmpty ? "Melon" : cleaned
        return "\(base).\(ext)"
    }

    private func freePort() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        task.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"]
        let output = Pipe()
        task.standardOutput = output
        task.standardError = Pipe()
        try? task.run()
        task.waitUntilExit()
        let text = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        for line in text.split(whereSeparator: \.isNewline) {
            guard let pid = Int32(line), pid != getpid() else { continue }
            let command = processCommand(pid)
            if command.contains("http.server") {
                kill(pid, SIGTERM)
            }
        }
    }

    private func processCommand(_ pid: Int32) -> String {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = ["-p", "\(pid)", "-o", "command="]
        let output = Pipe()
        task.standardOutput = output
        task.standardError = Pipe()
        try? task.run()
        task.waitUntilExit()
        return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    }

    private func stopServer() {
        guard let server, server.isRunning else { return }
        server.terminate()
        let deadline = Date().addingTimeInterval(1)
        while server.isRunning && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        if server.isRunning {
            kill(server.processIdentifier, SIGKILL)
        }
        self.server = nil
    }

    private func logTail() -> String {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: "/tmp/melon-server.log")),
              let text = String(data: data, encoding: .utf8) else { return "" }
        return text.split(whereSeparator: \.isNewline).suffix(8).joined(separator: "\n")
    }

    private func alert(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Melon"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }
}

let delegate = AppDelegate()
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
