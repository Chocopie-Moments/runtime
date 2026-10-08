import SwiftUI

/// A declarative host over the same native view. Share one asset across instances; state is local.
public struct ChocoMoment: UIViewRepresentable {
    public let asset: ChocoAsset
    public var state: String?
    public var paused: Bool
    public var accessibilityLabel: String?
    public var onError: ((ChocoError) -> Void)?
    public init(asset: ChocoAsset, state: String? = nil, paused: Bool = false,
                accessibilityLabel: String? = nil, onError: ((ChocoError) -> Void)? = nil) {
        self.asset = asset; self.state = state; self.paused = paused
        self.accessibilityLabel = accessibilityLabel; self.onError = onError
    }
    public func makeUIView(context: Context) -> ChocoView { ChocoView() }
    public func updateUIView(_ view: ChocoView, context: Context) {
        view.onError = onError
        view.isAccessibilityElement = accessibilityLabel != nil
        view.accessibilityLabel = accessibilityLabel
        do {
            try view.setPaused(paused)
            try view.load(asset)
            if let state { try view.setState(state == "idle" ? nil : state) }
        } catch let error as ChocoError { onError?(error) }
        catch { onError?(ChocoError(message: error.localizedDescription)) }
    }
    public static func dismantleUIView(_ view: ChocoView, coordinator: ()) { view.unload() }
}
