use std::{env, path::Path};
fn main() {
    println!("cargo:rerun-if-env-changed=CHOCO_THORVG_LIB");
    let directory = env::var("CHOCO_THORVG_LIB").expect(
        "Set CHOCO_THORVG_LIB to the pinned renderer's target-specific static library directory",
    );
    assert!(
        Path::new(&directory).join("libthorvg-1.a").is_file(),
        "Missing ThorVG static library"
    );
    println!("cargo:rerun-if-changed={directory}/libthorvg-1.a");
    println!("cargo:rustc-link-search=native={directory}");
    println!("cargo:rustc-link-lib=static=thorvg-1");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("android") {
        println!("cargo:rustc-link-lib=c++");
    }
}
