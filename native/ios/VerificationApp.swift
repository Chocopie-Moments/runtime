// Conformance host consuming the staged Swift Package and XCFramework.
import UIKit
import SwiftUI
import Choco

@MainActor
final class VerificationController: UIViewController {
    private struct Fixture: Decodable {
        let resource: String
        let name: String
        let states: [String]
    }
    private let moment = ChocoView()
    private let status = UILabel()
    private let metrics = UILabel()
    private var document: ChocoAsset?
    private var documentName = "Morsel order animation"
    private let states = UIStackView()
    private var playbackButton: UIButton?
    private var automaticProofStarted = false
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard ProcessInfo.processInfo.arguments.contains("--choco-physical-proof"), !automaticProofStarted else { return }
        automaticProofStarted = true
        let receiptURL = URL.documentsDirectory.appendingPathComponent("physical-proof.json")
        do {
            if FileManager.default.fileExists(atPath: receiptURL.path) { try FileManager.default.removeItem(at: receiptURL) }
        } catch { status.text = "Cannot clear old proof receipt: \(error)"; return }
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--choco-proof-id"), arguments.indices.contains(index + 1),
            !arguments[index + 1].isEmpty, !arguments[index + 1].hasPrefix("--") else {
            status.text = "Physical proof requires --choco-proof-id <nonce>"
            return
        }
        let proofID = arguments[index + 1]
        moment.unload()
        Task {
            do {
                var receipt = try await physicalVerificationReceipt(in: view)
                receipt["proofID"] = proofID
                let bytes = try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
                try bytes.write(to: receiptURL, options: .atomic)
                status.text = "Physical proof receipt complete"
            } catch {
                let bytes = try? JSONSerialization.data(withJSONObject: ["passed": false, "proofID": proofID, "error": String(describing: error)])
                try? bytes?.write(to: receiptURL, options: .atomic)
                status.text = "Physical proof failed: \(error)"
            }
        }
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let title = UILabel()
        title.text = "Choco native verification"
        title.font = .preferredFont(forTextStyle: .title2)
        status.numberOfLines = 0
        status.accessibilityIdentifier = "playback-status"
        metrics.numberOfLines = 0
        metrics.font = .preferredFont(forTextStyle: .footnote)
        moment.onError = { [weak self] error in self?.status.text = error.localizedDescription }
        states.axis = .vertical
        states.spacing = 6
        let fixtures = UIStackView(arrangedSubviews: [
            button("Morsel") { [weak self] in self?.loadFixture("order", name: "Morsel order animation", states: ["placed", "cooking", "on_the_way", "delivered"]) },
            button("Particles") { [weak self] in self?.loadFixture("particles", name: "Particle bursts", states: ["active", "other"]) },
            button("Strokes") { [weak self] in self?.loadFixture("strokes", name: "Stroke reveal", states: ["reveal", "erase", "rest"]) },
            button("Flows") { [weak self] in self?.loadFixture("flows", name: "Flow copies", states: ["flight", "rest"]) }
        ])
        fixtures.distribution = .fillEqually
        fixtures.spacing = 6
        if let url = Bundle.main.url(forResource: "community", withExtension: "json") {
            do {
                let entries = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
                let community = UIButton(type: .system)
                community.configuration = .bordered()
                community.setTitle("Community", for: .normal)
                community.showsMenuAsPrimaryAction = true
                community.menu = UIMenu(children: entries.map { entry in
                    UIAction(title: entry.name) { [weak self] _ in
                        self?.loadFixture(entry.resource, name: entry.name, states: entry.states)
                    }
                })
                fixtures.addArrangedSubview(community)
            } catch { status.text = error.localizedDescription }
        }
        let playback = button("Pause") { [weak self] in
                guard let self else { return }
                perform { try moment.setPaused(!moment.isPaused) }
                updatePlaybackButton()
                status.text = moment.isPaused ? "Paused" : "Playing"
                metrics.text = statistics()
            }
        playbackButton = playback
        let controls = UIStackView(arrangedSubviews: [
            playback,
            button("Unmount") { [weak self] in
                guard let self else { return }
                metrics.text = statistics()
                moment.unload(); status.text = "Unmounted"
                updatePlaybackButton()
            },
            button("Step 100 ms") { [weak self] in
                guard let self, moment.isLoaded else { return }
                perform { try moment.setPaused(true); try moment.seek(to: moment.currentTime + 0.1) }
                updatePlaybackButton()
                status.text = "Paused · stepped 100 ms"
                metrics.text = statistics()
            },
            button("SwiftUI") { [weak self] in
                guard let self, let document else { return }
                let controller = UIHostingController(rootView: ChocoMoment(asset: document, accessibilityLabel: documentName))
                present(controller, animated: true)
            },
            button("SDK checks") { [weak self] in
                guard let self else { return }
                Task {
                    do {
                        let checks = try await verifyInstalledSDK(in: view)
                        let receipt = try JSONSerialization.data(withJSONObject: ["passed": checks], options: [.prettyPrinted, .sortedKeys])
                        let path = URL.documentsDirectory.appendingPathComponent("sdk-checks.json")
                        try receipt.write(to: path, options: .atomic)
                        status.text = "SDK checks passed: \(checks.count)"
                    } catch { status.text = "SDK check failed: \(error)" }
                }
            },
            button("Reload") { [weak self] in
                guard let self, let document else { return }
                metrics.text = nil
                moment.unload()
                perform { try moment.load(document) }
                updatePlaybackButton()
            }
        ])
        controls.axis = .vertical
        controls.spacing = 6
        let stack = UIStackView(arrangedSubviews: [title, fixtures, moment, status, states, controls, metrics])
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -12),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),
            moment.heightAnchor.constraint(equalToConstant: 280)
        ])
        if !ProcessInfo.processInfo.arguments.contains("--choco-physical-proof") {
            loadFixture("order", name: documentName, states: ["placed", "cooking", "on_the_way", "delivered"])
        }
    }
    private func loadFixture(_ resource: String, name: String, states names: [String]) {
        do {
            guard let url = Bundle.main.url(forResource: resource, withExtension: "choco") else {
                status.text = "Missing verification fixture"; return
            }
            let data = try Data(contentsOf: url)
            document = ChocoAsset(data: data)
            documentName = name
            for child in states.arrangedSubviews { states.removeArrangedSubview(child); child.removeFromSuperview() }
            for state in names { states.addArrangedSubview(button(state) { [weak self] in self?.perform { try self?.moment.setState(state) } }) }
            metrics.text = nil
            try moment.load(document!)
            moment.isAccessibilityElement = true
            moment.accessibilityLabel = name
            status.text = "Ready · native package"
            updatePlaybackButton()
        } catch { status.text = error.localizedDescription }
    }
    private func statistics() -> String {
        String(format: "%d drawn · %@ · %.2f s", moment.presentedFrames, moment.isSchedulingFrames ? "display link active" : "display link stopped", moment.currentTime)
    }
    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { status.text = error.localizedDescription }
    }
    private func updatePlaybackButton() {
        playbackButton?.setTitle(moment.isPaused ? "Resume" : "Pause", for: .normal)
        playbackButton?.isEnabled = moment.isLoaded
    }
    private func button(_ title: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.configuration = .bordered()
        button.setTitle(title, for: .normal)
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }
}

@main
@MainActor
final class VerificationApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = VerificationController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
