//! The same bounded ZIP32 subset as src/moments/choco/archive.ts. No filesystem extraction.
use flate2::{Decompress, FlushDecompress, Status};
use std::collections::BTreeMap;
const NAMES: [&str; 4] = [
    "manifest.json",
    "scene.json",
    "motion.json",
    "ATTRIBUTION.txt",
];
const ERROR: &str = "Invalid or unsupported .choco ZIP archive";
fn u16_at(bytes: &[u8], at: usize) -> Result<u16, String> {
    Ok(u16::from_le_bytes(
        bytes
            .get(at..at + 2)
            .ok_or(ERROR)?
            .try_into()
            .map_err(|_| ERROR)?,
    ))
}
fn u32_at(bytes: &[u8], at: usize) -> Result<u32, String> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at + 4)
            .ok_or(ERROR)?
            .try_into()
            .map_err(|_| ERROR)?,
    ))
}
struct Entry {
    name: String,
    offset: usize,
    size: usize,
    expanded: usize,
    crc: u32,
    method: u16,
    flags: u16,
}

pub fn read(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    if !(22..=1_048_576).contains(&bytes.len()) {
        return Err(ERROR.into());
    }
    let end = bytes.len() - 22;
    if u32_at(bytes, end)? != 0x06054b50
        || [4, 6, 20]
            .into_iter()
            .any(|offset| u16_at(bytes, end + offset) != Ok(0))
    {
        return Err(ERROR.into());
    }
    let count = u16_at(bytes, end + 10)?;
    let directory = u32_at(bytes, end + 16)? as usize;
    if !(3..=4).contains(&count)
        || u16_at(bytes, end + 8)? != count
        || directory + u32_at(bytes, end + 12)? as usize != end
    {
        return Err(ERROR.into());
    }
    let mut entries = BTreeMap::new();
    let mut total = 0;
    let mut at = directory;
    for _ in 0..count {
        if at + 46 > end || u32_at(bytes, at)? != 0x02014b50 {
            return Err(ERROR.into());
        }
        let flags = u16_at(bytes, at + 8)?;
        let method = u16_at(bytes, at + 10)?;
        let name_length = u16_at(bytes, at + 28)? as usize;
        if ![0, 0x800].contains(&flags)
            || ![0, 8].contains(&method)
            || [30, 32, 34]
                .into_iter()
                .any(|offset| u16_at(bytes, at + offset) != Ok(0))
            || at + 46 + name_length > end
        {
            return Err(ERROR.into());
        }
        let name =
            std::str::from_utf8(&bytes[at + 46..at + 46 + name_length]).map_err(|_| ERROR)?;
        if !NAMES.contains(&name) || entries.values().any(|entry: &Entry| entry.name == name) {
            return Err(ERROR.into());
        }
        let expanded = u32_at(bytes, at + 24)? as usize;
        total += expanded;
        if total > 2_097_152 {
            return Err(ERROR.into());
        }
        let offset = u32_at(bytes, at + 42)? as usize;
        if entries
            .insert(
                offset,
                Entry {
                    name: name.into(),
                    offset,
                    size: u32_at(bytes, at + 20)? as usize,
                    expanded,
                    crc: u32_at(bytes, at + 16)?,
                    method,
                    flags,
                },
            )
            .is_some()
        {
            return Err(ERROR.into());
        }
        at += 46 + name_length;
    }
    if at != end
        || NAMES[..3]
            .iter()
            .any(|name| !entries.values().any(|entry| entry.name == *name))
    {
        return Err(ERROR.into());
    }
    let mut next = 0;
    let mut files = BTreeMap::new();
    for entry in entries.values() {
        let at = entry.offset;
        let start = at + 30 + entry.name.len();
        if at != next
            || start + entry.size > directory
            || u32_at(bytes, at)? != 0x04034b50
            || u16_at(bytes, at + 6)? != entry.flags
            || u16_at(bytes, at + 8)? != entry.method
            || u32_at(bytes, at + 14)? != entry.crc
            || u32_at(bytes, at + 18)? as usize != entry.size
            || u32_at(bytes, at + 22)? as usize != entry.expanded
            || u16_at(bytes, at + 26)? as usize != entry.name.len()
            || u16_at(bytes, at + 28)? != 0
            || bytes.get(at + 30..start) != Some(entry.name.as_bytes())
        {
            return Err(ERROR.into());
        }
        let compressed = &bytes[start..start + entry.size];
        let mut output;
        if entry.method == 0 {
            if entry.size != entry.expanded {
                return Err(ERROR.into());
            }
            output = compressed.to_vec();
        } else {
            // One sentinel byte distinguishes exact-size output from a forged length. The decoder
            // must consume exactly one complete stream, rejecting appended or concatenated data.
            output = vec![0; entry.expanded + 1];
            let mut inflater = Decompress::new(false);
            let status = inflater
                .decompress(compressed, &mut output, FlushDecompress::Finish)
                .map_err(|_| ERROR)?;
            if status != Status::StreamEnd
                || inflater.total_in() != entry.size as u64
                || inflater.total_out() != entry.expanded as u64
            {
                return Err(ERROR.into());
            }
            output.truncate(entry.expanded);
        }
        if crc32fast::hash(&output) != entry.crc {
            return Err(ERROR.into());
        }
        files.insert(entry.name.clone(), output);
        next = start + entry.size;
    }
    if next != directory {
        return Err(ERROR.into());
    }
    Ok(files)
}
