// Full-page screenshots with the system WebKit (macOS), used by visual-compare.mjs
// when Playwright is not installed. Reads jobs from stdin, one per line:
//   <url>\t<width>\t<height>\t<light|dark>\t<output.png>
// Pages run with a fixed clock and no animations so captures are repeatable.
import AppKit
import WebKit

let freezeClock = """
(() => {
  const fixed = Date.parse('2026-10-20T14:00:00Z');
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(fixed); }
    static now() { return fixed; }
  }
  globalThis.Date = FixedDate;
})();
"""
let stillness = """
(() => {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.documentElement.appendChild(style);
})();
"""

struct Job { let url: URL; let width: CGFloat; let height: CGFloat; let dark: Bool; let output: String }

final class Capturer: NSObject, WKNavigationDelegate {
  var jobs: [Job]
  var webView: WKWebView!
  var current: Job?

  init(jobs: [Job]) { self.jobs = jobs }

  func next() {
    guard !jobs.isEmpty else { NSApp.terminate(nil); return }
    let job = jobs.removeFirst()
    current = job
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.addUserScript(
      WKUserScript(source: freezeClock, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.addUserScript(
      WKUserScript(source: stillness, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    webView = WKWebView(frame: NSRect(x: 0, y: 0, width: job.width, height: job.height), configuration: config)
    webView.appearance = NSAppearance(named: job.dark ? .darkAqua : .aqua)
    webView.navigationDelegate = self
    webView.load(URLRequest(url: job.url))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // Let React render and fixture fetches settle, then wait for web fonts.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      webView.callAsyncJavaScript(
        "await document.fonts.ready; return Math.ceil(document.documentElement.scrollHeight);",
        arguments: [:], in: nil, in: .page
      ) { result in
        let job = self.current!
        let height = max(job.height, CGFloat((try? result.get() as? Double) ?? Double(job.height)))
        webView.setFrameSize(NSSize(width: job.width, height: height))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.snapshot(height: height) }
      }
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    FileHandle.standardError.write("Failed \(current!.url): \(error)\n".data(using: .utf8)!)
    next()
  }

  func snapshot(height: CGFloat) {
    let job = current!
    let config = WKSnapshotConfiguration()
    config.rect = NSRect(x: 0, y: 0, width: job.width, height: height)
    config.snapshotWidth = NSNumber(value: Double(job.width))  // 1 CSS px = 1 image px
    webView.takeSnapshot(with: config) { image, error in
      if let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
         let png = bitmap.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: job.output))
      } else {
        FileHandle.standardError.write("Snapshot failed \(job.output): \(String(describing: error))\n".data(using: .utf8)!)
      }
      self.next()
    }
  }
}

var jobs: [Job] = []
while let line = readLine() {
  let parts = line.split(separator: "\t").map(String.init)
  guard parts.count == 5, let url = URL(string: parts[0]),
        let width = Double(parts[1]), let height = Double(parts[2]) else { continue }
  jobs.append(Job(url: url, width: width, height: height, dark: parts[3] == "dark", output: parts[4]))
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let capturer = Capturer(jobs: jobs)
DispatchQueue.main.async { capturer.next() }
app.run()
