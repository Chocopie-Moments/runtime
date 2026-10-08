import Foundation
import UIKit

/// React props and bounded asynchronous asset loading. Playback belongs to the shared UIKit SDK.
@MainActor
@objc(CPChocoHostView)
public final class ChocoHostView: UIView {
    @objc public var onLoad: (() -> Void)?
    @objc public var onError: ((String) -> Void)?
    private let moment = ChocoView()
    private var loading: Task<Void, Never>?
    private var source = ""
    private var state = ""
    private var paused = false
    private var generation = 0

    public override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(moment)
        moment.onError = { [weak self] error in self?.onError?(error.message) }
    }
    public required init?(coder: NSCoder) { fatalError("Use init(frame:)") }
    isolated deinit { loading?.cancel() }
    public override func layoutSubviews() { super.layoutSubviews(); moment.frame = bounds }
    @objc public func configure(source: String, state: String, paused: Bool, playbackEnabled: Bool) {
        moment.isPlaybackEnabled = playbackEnabled
        let changed = self.source != source
        self.state = state; self.paused = paused
        if !changed {
            applyState()
            return
        }
        reset()
        self.source = source
        let ownGeneration = generation
        guard !source.isEmpty else { return }
        loading = Task { [weak self] in
            do {
                let data = try await Self.readAsset(source)
                try Task.checkCancellation()
                guard let self, self.generation == ownGeneration else { return }
                try self.moment.setPaused(self.paused)
                try self.moment.load(ChocoAsset(data: data))
                if !self.state.isEmpty { try self.moment.setState(self.state == "idle" ? nil : self.state) }
                self.loading = nil
                self.onLoad?()
            } catch is CancellationError {
                // Replaced props or recycling owns cancellation; it is not a load failure.
            } catch {
                guard let self, self.generation == ownGeneration else { return }
                self.loading = nil
                self.onError?((error as? ChocoError)?.message ?? "The .choco asset could not be loaded")
            }
        }
    }
    @objc public func reset() {
        generation += 1
        loading?.cancel(); loading = nil
        source = ""
        moment.unload()
    }
    private func perform(_ operation: () throws -> Void) {
        do { try operation() }
        catch { onError?((error as? ChocoError)?.message ?? "The .choco control could not be applied") }
    }
    @objc public func trigger(_ name: String) {
        perform {
            let trigger: ChocoTrigger
            switch name {
            case "enter": trigger = .enter
            case "hover": trigger = .hover
            case "click": trigger = .click
            default: throw ChocoError(message: "Unknown .choco trigger")
            }
            try moment.trigger(trigger)
        }
    }
    @objc public func seek(_ seconds: Double) { perform { try moment.seek(to: seconds) } }
    @objc public func look(_ active: Bool, x: Double, y: Double) {
        perform { try moment.look(at: active ? CGPoint(x: x, y: y) : nil) }
    }
    @objc public func palette(_ accent: Double, secondary: Double, ink: Double, background: Double) {
        perform {
            guard [accent, secondary, ink, background].allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 0xffffff && $0.rounded() == $0 }) else {
                throw ChocoError(message: "Palette colors must be integers from 0x000000 to 0xFFFFFF")
            }
            try moment.setPalette(ChocoPalette(accent: UInt32(accent), secondary: UInt32(secondary), ink: UInt32(ink), background: UInt32(background)))
        }
    }
    private func applyState() {
        guard moment.isLoaded else { return }
        do {
            try moment.setPaused(paused)
            try moment.setState(state.isEmpty || state == "idle" ? nil : state)
        } catch { onError?((error as? ChocoError)?.message ?? "The .choco state could not be applied") }
    }
    @concurrent private static func readAsset(_ source: String) async throws -> Data {
        let limit = 2_097_152
        let url: URL
        if source.hasPrefix("bundle://") {
            let name = String(source.dropFirst("bundle://".count))
            guard !name.contains("/"), name.hasSuffix(".choco"),
                let resource = Bundle.main.url(forResource: String(name.dropLast(6)), withExtension: "choco") else {
                throw ChocoError(message: "The bundled .choco asset was not found")
            }
            url = resource
        } else {
            guard let parsed = URL(string: source) else { throw ChocoError(message: "Invalid .choco asset URL") }
            url = parsed
        }
        try Task.checkCancellation()
        if url.isFileURL {
            guard try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
                throw ChocoError(message: "The .choco asset must be a regular file")
            }
            let file = try FileHandle(forReadingFrom: url)
            defer { try? file.close() }
            guard let data = try file.read(upToCount: limit + 1), data.count <= limit else {
                throw ChocoError(message: "The .choco asset exceeds 2 MiB")
            }
            try Task.checkCancellation()
            return data
        }
        func allowed(_ url: URL?) -> Bool {
            guard let url else { return false }
            if url.scheme == "https" { return true }
            #if DEBUG
            return url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host ?? "")
            #else
            return false
            #endif
        }
        guard allowed(url) else { throw ChocoError(message: "Use a bundled file or HTTPS .choco asset") }
        let (bytes, response) = try await URLSession.shared.bytes(from: url)
        guard let response = response as? HTTPURLResponse, allowed(response.url),
            (200..<300).contains(response.statusCode), response.expectedContentLength <= limit else {
            throw ChocoError(message: "The .choco asset request failed or exceeds 2 MiB")
        }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < limit else { throw ChocoError(message: "The .choco asset exceeds 2 MiB") }
            data.append(byte)
        }
        return data
    }
}
