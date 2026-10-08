require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'ChocoReactNative'
  s.version = package['version']
  s.summary = 'Unreleased Choco native playback adapter'
  s.homepage = 'https://chocopie.lol'
  s.license = { :type => 'Apache-2.0', :file => 'LICENSE' }
  s.author = 'Chocopie'
  s.source = { :git => 'https://github.com/Chocopie-Moments/runtime.git', :tag => s.version.to_s }
  s.platforms = { :ios => '16.0' }
  s.swift_version = '6.0'
  s.source_files = 'ios/*.{h,mm,swift}', 'ios/SDK/*.swift'
  s.vendored_frameworks = 'ios/Artifacts/ChocoNative.xcframework'
  s.libraries = 'c++'
  s.frameworks = 'UIKit', 'Security'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20' }
  install_modules_dependencies(s)
end
