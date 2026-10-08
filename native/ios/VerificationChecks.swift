import Choco
import UIKit

/// Runs the installed SDK on the simulator's main run loop, not a duplicate player implementation.
@MainActor
func verifyInstalledSDK(in container: UIView, states: (active: String, rest: String) = ("flight", "rest"), initialState: String? = nil) async throws -> [String] {
    struct Failure: Error { let check: String }
    var passed: [String] = []
    func check(_ name: String, _ condition: Bool) throws {
        guard condition else { throw Failure(check: name) }
        passed.append(name)
    }
    func rejected(_ name: String, _ operation: () throws -> Void) throws {
        var failed = false
        do { try operation() } catch { failed = true }
        try check(name, failed)
    }
    func wait() async throws { try await Task.sleep(for: .milliseconds(120)) }
    let asset = ChocoAsset(data: try Data(contentsOf: Bundle.main.url(forResource: "flows", withExtension: "choco")!))
    let view = ChocoView(frame: CGRect(x: 0, y: 0, width: 160, height: 160))
    var errors: [String] = []
    view.onError = { errors.append($0.message) }
    container.addSubview(view)
    defer { view.unload(); view.removeFromSuperview() }
    try view.load(asset)
    if let initialState { try view.setState(initialState) }
    let attachedReady = view.isLoaded && view.presentedFrames > 0 && view.isSchedulingFrames
    let diagnostic = attachedReady ? "" : " (applicationState=\(UIApplication.shared.applicationState.rawValue), reduceMotion=\(UIAccessibility.isReduceMotionEnabled), time=\(view.currentTime), frames=\(view.presentedFrames), scheduling=\(view.isSchedulingFrames))"
    try check("attached load presents and schedules" + diagnostic, attachedReady)
    try await wait()
    try check("display link advances native clock", view.currentTime > 0)
    try view.setPaused(true)
    let pausedTime = view.currentTime
    try await wait()
    try check("paused clock and display link stop", view.currentTime == pausedTime && !view.isSchedulingFrames)
    try view.seek(to: 0.35)
    try check("paused seek updates exact time", view.currentTime == 0.35)
    try view.setState(states.active)
    try view.trigger(.click)
    try view.seek(to: 0.8)
    let priorFrames = view.presentedFrames
    try rejected("bad replacement rejects", { try view.load(ChocoAsset(data: Data([1, 2, 3]))) })
    try check("bad replacement preserves loaded player", view.isLoaded && view.currentTime == 0.8 && view.presentedFrames == priorFrames)
    try rejected("unknown state rejects", { try view.setState("missing-verification-state") })
    try rejected("nonfinite seek rejects", { try view.seek(to: .nan) })
    try rejected("out-of-range palette rejects", { try view.setPalette(ChocoPalette(accent: 0x1000000, secondary: 0, ink: 0, background: 0)) })
    try view.setPalette(ChocoPalette(accent: 0xef6635, secondary: 0x29bca0, ink: 0x203040, background: 0xffffff))
    try view.look(at: CGPoint(x: 50, y: 80))
    try view.look(at: nil)
    view.frame.size = CGSize(width: 270, height: 150)
    view.layoutIfNeeded()
    try check("resize redraws while paused", view.presentedFrames > priorFrames && !view.isSchedulingFrames)
    try view.setPaused(false)
    try check("resume schedules", view.isSchedulingFrames)
    view.isPlaybackEnabled = false
    let disabledTime = view.currentTime
    try await wait()
    try check("offscreen suspension freezes clock", !view.isSchedulingFrames && view.currentTime == disabledTime)
    view.isPlaybackEnabled = true
    try check("offscreen reentry schedules", view.isSchedulingFrames)
    view.isHidden = true
    try check("hidden view stops display link", !view.isSchedulingFrames)
    view.isHidden = false
    try check("unhidden view schedules", view.isSchedulingFrames)
    view.removeFromSuperview()
    try check("detached view stops display link", !view.isSchedulingFrames)
    container.addSubview(view)
    try check("reattached view schedules", view.isSchedulingFrames)
    // Notification handling is tested here; real Home/reopen is exercised separately through the device.
    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
    try check("application suspension stops display link", !view.isSchedulingFrames)
    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
    try check("application activation schedules", view.isSchedulingFrames)
    try view.setState(states.rest)
    try view.seek(to: 60)
    try check("settled score stops display link", !view.isSchedulingFrames)
    try view.setState(states.active)
    try check("new state wakes settled view", view.isSchedulingFrames)
    weak var released: ChocoView?
    try autoreleasepool {
        let second = ChocoView(frame: view.frame)
        released = second
        container.addSubview(second)
        try second.setPaused(true)
        try second.load(asset)
        try second.seek(to: 0.4)
        try check("shared asset has independent clocks", second.currentTime == 0.4 && view.currentTime == 60)
        second.removeFromSuperview()
    }
    try check("detached instance deallocates", released == nil)
    for _ in 0..<20 {
        view.unload()
        try check("unload clears player and scheduling", !view.isLoaded && !view.isSchedulingFrames)
        try view.load(asset)
    }
    try check("no asynchronous presentation errors", errors.isEmpty)
    return passed
}
