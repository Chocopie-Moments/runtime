//! Cross-language codec conformance: no renderer or platform objects are created.
use choco_native::scene::Document;
use std::{env, fs, io::Read};
fn main() -> Result<(), String> {
    for path in env::args().skip(1) {
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .map_err(|error| error.to_string())?
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        let result = Document::read(&bytes);
        println!(
            "{}",
            serde_json::json!({"path":path,"accepted":result.is_ok(),"error":result.err()})
        );
    }
    Ok(())
}
