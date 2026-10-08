//! Compare the JSON reader's exact numeric representation against the browser encoder.
use std::io::{self, Read};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut source = String::new();
    io::stdin().take(4_194_304).read_to_string(&mut source)?;
    let spellings: Vec<String> = serde_json::from_str(&source)?;
    let bits = spellings
        .iter()
        .map(|spelling| {
            serde_json::from_str::<f64>(spelling).map(|value| format!("{:016x}", value.to_bits()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    println!("{}", serde_json::to_string(&bits)?);
    Ok(())
}
