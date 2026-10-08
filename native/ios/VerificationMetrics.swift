// Verification application only. No instrumentation is installed in the SDK.
import Choco
import UIKit
import Darwin
import CryptoKit

private func residentBytes() throws -> UInt64 {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }
    guard result == KERN_SUCCESS else { throw NSError(domain: "ChocoVerification.Mach", code: Int(result)) }
    return UInt64(info.resident_size)
}

@MainActor
func physicalVerificationReceipt(in container: UIView) async throws -> [String: Any] {
    struct Failure: Error { let message: String }
    guard let url = Bundle.main.url(forResource: "flows", withExtension: "choco") else {
        throw Failure(message: "Missing bundled flows.choco fixture")
    }
    // viewDidAppear may precede didBecomeActive on a cold launch. Construct proof
    // views only after the actual application state is active; do not post fake lifecycle events.
    let activeDeadline = CACurrentMediaTime() + 5
    while UIApplication.shared.applicationState != .active && CACurrentMediaTime() < activeDeadline {
        try await Task.sleep(for: .milliseconds(20))
    }
    guard UIApplication.shared.applicationState == .active else {
        throw Failure(message: "Application did not become active within five seconds")
    }
    let checks = try await verifyInstalledSDK(in: container, states: ("active", "other"), initialState: "active")
    let bytes = try Data(contentsOf: url)
    let asset = ChocoAsset(data: bytes)
    let player = ChocoView(frame: CGRect(x: 0, y: 0, width: 160, height: 160))
    var errors: [String] = []
    player.onError = { errors.append($0.message) }
    container.addSubview(player)
    defer { player.unload(); player.removeFromSuperview() }
    try player.setPaused(true)
    let rssBefore = try residentBytes()
    let start = CACurrentMediaTime()
    try player.load(asset)
    let loadMilliseconds = (CACurrentMediaTime() - start) * 1000
    guard player.presentedFrames > 0 else { throw Failure(message: "Load did not present a frame") }
    try player.setState("active")
    // Read the actual SDK-created CGImage dimensions, rather than estimating screen scale.
    func image(in view: UIView) -> CGImage? {
        if let image = (view as? UIImageView)?.image?.cgImage { return image }
        return view.subviews.compactMap { image(in: $0) }.first
    }
    guard let pixels = image(in: player) else { throw Failure(message: "No presented pixel surface") }
    var samples: [Double] = []
    var rss = [rssBefore, try residentBytes()]
    // Warm-up is excluded. Each measured seek includes native rendering and UIKit image creation.
    for index in 0..<130 {
        let frames = player.presentedFrames
        let begin = CACurrentMediaTime()
        try player.seek(to: 0.12 + Double(index % 40) / 60)
        let elapsed = (CACurrentMediaTime() - begin) * 1000
        guard player.presentedFrames > frames else { throw Failure(message: "Seek did not render a changed frame") }
        if index >= 10 { samples.append(elapsed) }
        rss.append(try residentBytes())
        try await Task.sleep(for: .milliseconds(1))
    }
    guard errors.isEmpty else { throw Failure(message: errors.joined(separator: "; ")) }
    let sorted = samples.sorted()
    player.unload()
    rss.append(try residentBytes())
    return [
        "passed": true, "checks": checks,
        "fixture": "flows.choco", "fixtureBytes": bytes.count,
        "fixtureSha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
        "operatingSystem": ProcessInfo.processInfo.operatingSystemVersionString,
        "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
        "pixelWidth": pixels.width, "pixelHeight": pixels.height,
        "loadToFirstPresentedFrameMilliseconds": loadMilliseconds,
        "frameSeekSamplesMilliseconds": samples,
        "frameSeekMedianMilliseconds": (sorted[59] + sorted[60]) / 2,
        "frameSeekP95Milliseconds": sorted[113],
        "rssSamplesBytes": rss, "rssMaximumSampledBytes": rss.max()!,
        "scope": "One bundled flows fixture, 160x160 points, 10 warm-up and 120 paused seeks cycling from 0.12 to 0.77 seconds in the active flow interval. Load timing follows SDK checks (warm engine) and excludes file IO and process launch. Frame timings include rendering/image creation, not display scanout or vsync. RSS is task_info resident_size for the whole app, sampled not peak. Notification checks are simulated; no real background/foreground or energy claim."
    ]
}
