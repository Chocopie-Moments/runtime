import ChocoNative
import UIKit

/// Immutable bytes may be shared by views. Each view owns its own playback state.
public final class ChocoAsset: Sendable {
    public let data: Data
    public init(data: Data) { self.data = data }
}

public enum ChocoTrigger: UInt32, Sendable { case enter, hover, click }
public struct ChocoPalette: Sendable, Equatable {
    public let accent, secondary, ink, background: UInt32
    /// Opaque 0xRRGGBB colors. Values outside 24 bits fail at the native boundary.
    public init(accent: UInt32, secondary: UInt32, ink: UInt32, background: UInt32) {
        self.accent = accent; self.secondary = secondary; self.ink = ink; self.background = background
    }
}
public struct ChocoError: Error, LocalizedError, Sendable {
    public let message: String
    public var errorDescription: String? { message }
}

@MainActor
private final class DisplayTarget: NSObject {
    weak var view: ChocoView?
    @objc func tick(_ link: CADisplayLink) { view?.tick(link) }
}

/// Offline, native playback. All live instances render on the main actor. No runtime networking.
@MainActor
public final class ChocoView: UIView {
    public var onError: ((ChocoError) -> Void)?
    /// Hosts set this false for offscreen cells or obscured content that remains in the window.
    public var isPlaybackEnabled = true { didSet { schedule() } }
    public private(set) var isPaused = false
    public private(set) var currentTime = 0.0
    public private(set) var presentedFrames = 0
    public var isLoaded: Bool { player != nil }
    public var isSchedulingFrames: Bool { displayLink != nil }
    public override var isHidden: Bool { didSet { schedule() } }
    private var player: OpaquePointer?
    private var asset: ChocoAsset?
    private var error = [UInt8](repeating: 0, count: 512)
    private var displayLink: CADisplayLink?
    private let target = DisplayTarget()
    private var lastTime: CFTimeInterval?
    private var needsFrame = false
    private var applicationActive = UIApplication.shared.applicationState == .active
    private let imageView = UIImageView()
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    public override init(frame: CGRect) {
        super.init(frame: frame)
        imageView.contentMode = .scaleAspectFit
        addSubview(imageView)
        target.view = self
        NotificationCenter.default.addObserver(self, selector: #selector(suspendApplication), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resumeApplication), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(reducedMotionChanged), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(frame:)") }
    isolated deinit {
        displayLink?.invalidate()
        if let player { choco_player_destroy(player) }
        NotificationCenter.default.removeObserver(self)
    }
    public override func layoutSubviews() {
        super.layoutSubviews()
        imageView.frame = bounds
        present(delta: 0)
    }
    public override func didMoveToWindow() {
        super.didMoveToWindow()
        present(delta: 0)
        schedule()
    }
    /// The previous asset remains usable if decoding the replacement fails.
    public func load(_ asset: ChocoAsset) throws {
        if self.asset === asset { return }
        let (width, height) = dimensions()
        let next = asset.data.withUnsafeBytes { bytes in
            choco_player_create(bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count,
                width, height, UIAccessibility.isReduceMotionEnabled, &error, error.count)
        }
        guard let next else { throw failure() }
        if let player { choco_player_destroy(player) }
        player = next
        self.asset = asset
        currentTime = 0
        presentedFrames = 0
        lastTime = nil
        try check(choco_player_pause(next, isPaused, &error, error.count))
        present(delta: 0)
    }
    public func unload() {
        stop()
        if let player { choco_player_destroy(player) }
        player = nil; asset = nil; needsFrame = false
        imageView.image = nil
        currentTime = 0
    }
    public func setState(_ name: String?, restart: Bool = false) throws {
        let handle = try loaded()
        let bytes = Array((name ?? "").utf8)
        try check(bytes.withUnsafeBufferPointer { choco_player_state(handle, $0.baseAddress, $0.count, restart, &error, error.count) })
        present(delta: 0)
    }
    public func trigger(_ trigger: ChocoTrigger) throws {
        try check(choco_player_trigger(try loaded(), trigger.rawValue, &error, error.count))
        present(delta: 0)
    }
    public func seek(to seconds: Double) throws {
        try check(choco_player_seek(try loaded(), seconds, &error, error.count))
        lastTime = nil
        present(delta: 0)
    }
    public func setPaused(_ paused: Bool) throws {
        guard paused != isPaused else { return }
        if let player { try check(choco_player_pause(player, paused, &error, error.count)) }
        isPaused = paused
        lastTime = nil
        present(delta: 0)
    }
    public func setPalette(_ palette: ChocoPalette) throws {
        try check(choco_player_palette(try loaded(), palette.accent, palette.secondary, palette.ink, palette.background, &error, error.count))
        present(delta: 0)
    }
    /// Coordinates are in the asset's viewBox. Passing nil releases pointer gaze.
    public func look(at point: CGPoint?) throws {
        try check(choco_player_look(try loaded(), point != nil, Double(point?.x ?? 0), Double(point?.y ?? 0), &error, error.count))
        present(delta: 0)
    }
    @objc private func reducedMotionChanged() {
        guard let player else { return }
        do { try check(choco_player_reduced_motion(player, UIAccessibility.isReduceMotionEnabled, &error, error.count)); present(delta: 0) }
        catch let error as ChocoError { onError?(error) }
        catch { onError?(ChocoError(message: error.localizedDescription)) }
    }
    private func loaded() throws -> OpaquePointer {
        guard let player else { throw ChocoError(message: "Load a .choco asset first") }
        return player
    }
    private func failure() -> ChocoError { ChocoError(message: String(decoding: error.prefix { $0 != 0 }, as: UTF8.self)) }
    private func check(_ success: Bool) throws { if !success { throw failure() } }
    private func dimensions() -> (UInt32, UInt32) {
        let scale = window?.screen.scale ?? traitCollection.displayScale
        let width = max(1, bounds.width * scale), height = max(1, bounds.height * scale)
        // Preserve aspect ratio when fitting the native surface budget.
        let fit = min(1, 4096 / max(width, height), sqrt(4_194_304 / (width * height)))
        return (UInt32(max(1, floor(width * fit))), UInt32(max(1, floor(height * fit))))
    }
    private func stop() {
        displayLink?.invalidate(); displayLink = nil; lastTime = nil
    }
    @objc private func suspendApplication() { applicationActive = false; stop() }
    @objc private func resumeApplication() { applicationActive = true; schedule() }
    @objc private func schedule() {
        guard player != nil, needsFrame, !isPaused, isPlaybackEnabled, !isHidden,
            window != nil, applicationActive else { stop(); return }
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: target, selector: #selector(DisplayTarget.tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }
    fileprivate func tick(_ link: CADisplayLink) {
        let delta = lastTime.map { max(0, link.timestamp - $0) } ?? 0
        lastTime = link.timestamp
        present(delta: delta)
    }
    private func present(delta: Double) {
        guard let player else { return }
        let (width, height) = dimensions()
        let frame = choco_player_frame(player, delta, width, height, &error, error.count)
        guard let pixels = frame.pixels else { needsFrame = false; stop(); onError?(failure()); return }
        needsFrame = frame.needs_frame
        currentTime = frame.time
        if frame.changed {
            let data = Data(bytes: pixels, count: Int(width) * Int(height) * 4)
            guard let provider = CGDataProvider(data: data as CFData),
                let image = CGImage(width: Int(width), height: Int(height), bitsPerComponent: 8, bitsPerPixel: 32,
                    bytesPerRow: Int(width) * 4, space: colorSpace,
                    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                    provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else {
                needsFrame = false; stop(); onError?(ChocoError(message: "Could not present the rendered frame")); return
            }
            imageView.image = UIImage(cgImage: image)
            presentedFrames += 1
        }
        schedule()
    }
}
