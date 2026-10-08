// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Choco",
    platforms: [.iOS(.v16)],
    products: [.library(name: "Choco", targets: ["Choco"])],
    targets: [
        .binaryTarget(name: "ChocoNative", url: "https://github.com/Chocopie-Moments/runtime/releases/download/v0.1.0/choco-native-0.1.0.zip", checksum: "9cfcdeb764a41dd1afc2b2900c56a6b2e22867793410a21db855a276df8bd33a"),
        .target(name: "Choco", dependencies: ["ChocoNative"], path: "native/ios/Sources/Choco", linkerSettings: [
            .linkedLibrary("c++"), .linkedFramework("Security")
        ])
    ]
)
