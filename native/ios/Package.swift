// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Choco",
    platforms: [.iOS(.v16)],
    products: [.library(name: "Choco", targets: ["Choco"])],
    targets: [
        .binaryTarget(name: "ChocoNative", path: "Artifacts/ChocoNative.xcframework"),
        .target(name: "Choco", dependencies: ["ChocoNative"], linkerSettings: [
            .linkedLibrary("c++"), .linkedFramework("Security")
        ])
    ]
)
