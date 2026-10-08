//! Reject ambiguous map keys and excessive nesting before serde creates the document.
use std::collections::BTreeSet;
pub fn check(bytes: &[u8]) -> Result<(), String> {
    std::str::from_utf8(bytes).map_err(|_| "The .choco JSON is not UTF-8")?;
    let mut stack: Vec<(Option<BTreeSet<String>>, bool)> = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'"' => {
                let start = at;
                at += 1;
                while at < bytes.len() && bytes[at] != b'"' {
                    if bytes[at] == b'\\' {
                        at += 1;
                    }
                    at += 1;
                }
                if at >= bytes.len() {
                    return Err("Unterminated .choco JSON string".into());
                }
                if let Some((Some(keys), true)) = stack.last_mut() {
                    let key: String = serde_json::from_slice(&bytes[start..=at])
                        .map_err(|error| error.to_string())?;
                    if !keys.insert(key) {
                        return Err("Duplicate .choco JSON key".into());
                    }
                }
            }
            b'{' | b'[' => {
                if stack.len() >= 96 {
                    return Err(".choco JSON nesting exceeds 96".into());
                }
                stack.push((
                    if bytes[at] == b'{' {
                        Some(BTreeSet::new())
                    } else {
                        None
                    },
                    bytes[at] == b'{',
                ));
            }
            b'}' | b']' => {
                stack.pop();
            }
            b':' | b',' => {
                if let Some((keys, key)) = stack.last_mut() {
                    *key = bytes[at] == b',' && keys.is_some();
                }
            }
            _ => (),
        }
        at += 1;
    }
    Ok(())
}
