#![no_main]
use choco_native::scene::Document;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|bytes: &[u8]| {
    // The real public byte loader: ZIP framing, inflation, JSON, integrity and graph admission.
    // Do not catch panics: libFuzzer must retain every crashing input.
    let _ = Document::read(bytes);
});
