use crate::{
    archive, json,
    scene::{Document, Node, Paint, Scene},
};
use choco_core::{
    program::{Rig, Score},
    validation::{hex_color, identifier},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct File {
    sha256: String,
    #[serde(deserialize_with = "choco_core::program::integer_usize")]
    bytes: usize,
}
#[derive(Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
struct Capability {
    id: String,
    #[serde(deserialize_with = "choco_core::program::integer_u32")]
    version: u32,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: String,
    #[serde(deserialize_with = "choco_core::program::integer_u32")]
    format_version: u32,
    #[serde(deserialize_with = "choco_core::program::integer_u32")]
    format_revision: u32,
    #[serde(deserialize_with = "choco_core::program::integer_u32")]
    semantics_version: u32,
    name: String,
    kind: String,
    palette: BTreeMap<String, String>,
    states: Vec<String>,
    required: Vec<Capability>,
    files: BTreeMap<String, File>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Motion {
    kind: String,
    rig: Rig,
    score: Score,
}

fn read<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    json::check(bytes)?;
    serde_json::from_slice(bytes).map_err(|error| error.to_string())
}
pub fn palette(palette: &BTreeMap<String, String>) -> Result<(), String> {
    if palette.len() != 4
        || ["accent", "secondary", "ink", "background"]
            .iter()
            .any(|role| !palette.get(*role).is_some_and(|value| hex_color(value)))
    {
        return Err("A palette requires exactly four six-digit hex colors".into());
    }
    Ok(())
}
pub struct Asset {
    pub document: Document,
    manifest: Manifest,
    attribution: Option<String>,
}
impl Asset {
    pub fn metadata(&self) -> Result<Vec<u8>, String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Metadata<'a> {
            manifest: &'a Manifest,
            view_box: [f64; 4],
            attribution: &'a Option<String>,
        }
        serde_json::to_vec(&Metadata {
            manifest: &self.manifest,
            view_box: self.document.scene.view_box,
            attribution: &self.attribution,
        })
        .map_err(|error| error.to_string())
    }
}
pub fn decode(bytes: &[u8]) -> Result<Document, String> {
    Ok(decode_asset(bytes)?.document)
}
pub fn decode_asset(bytes: &[u8]) -> Result<Asset, String> {
    let files = archive::read(bytes)?;
    let manifest: Manifest = read(&files["manifest.json"])?;
    if manifest.format != "choco"
        || manifest.format_version != 0
        || manifest.format_revision != 2
        || manifest.semantics_version != 1
    {
        return Err("Unsupported .choco format or semantics".into());
    }
    if manifest.name.is_empty()
        || manifest.name.encode_utf16().count() > 80
        || manifest.kind.is_empty()
        || manifest.kind.encode_utf16().count() > 80
    {
        return Err("Invalid .choco identity".into());
    }
    palette(&manifest.palette)?;
    if manifest.states.is_empty()
        || manifest.states.len() > 256
        || manifest.states.iter().any(|id| !identifier(id, 80))
        || manifest.required.len() > 128
    {
        return Err("Invalid .choco state or capability declarations".into());
    }
    if files.len() != manifest.files.len() + 1
        || !manifest.files.contains_key("scene.json")
        || !manifest.files.contains_key("motion.json")
    {
        return Err("The manifest must describe every data entry".into());
    }
    for (name, descriptor) in &manifest.files {
        if !["scene.json", "motion.json", "ATTRIBUTION.txt"].contains(&name.as_str()) {
            return Err("Invalid .choco data entry".into());
        }
        let content = files.get(name).ok_or("Missing .choco data entry")?;
        if descriptor.bytes != content.len()
            || descriptor.sha256 != format!("{:x}", Sha256::digest(content))
        {
            return Err(format!("The .choco integrity check failed for {name}"));
        }
    }
    if let Some(attribution) = files.get("ATTRIBUTION.txt")
        && (attribution.len() > 16_384 || std::str::from_utf8(attribution).is_err())
    {
        return Err("Invalid .choco attribution".into());
    }
    let scene: Scene = read(&files["scene.json"])?;
    let motion: Motion = read(&files["motion.json"])?;
    if motion.kind != "score" {
        return Err("Unknown .choco motion program".into());
    }
    let document = Document {
        scene,
        rig: motion.rig,
        score: motion.score,
        palette: manifest.palette.clone(),
    };
    document.validate()?;
    let required = capabilities(&document);
    if manifest.required != required {
        return Err("The .choco declared capabilities do not match its contents".into());
    }
    let mut states = vec![String::from("idle")];
    states.extend(document.score.states.iter().flat_map(|s| s.keys()).cloned());
    for (id, sequence) in [
        ("enter", &document.score.enter),
        ("hover", &document.score.hover),
        ("click", &document.score.click),
    ] {
        if sequence.as_ref().is_some_and(|s| !s.beats.is_empty()) {
            states.push(id.into());
        }
    }
    states.sort();
    if states != manifest.states {
        return Err("The .choco declared states do not match its contents".into());
    }
    let attribution = files
        .get("ATTRIBUTION.txt")
        .map(|bytes| {
            String::from_utf8(bytes.clone()).map_err(|_| "Invalid attribution".to_string())
        })
        .transpose()?;
    Ok(Asset {
        document,
        manifest,
        attribution,
    })
}
fn capabilities(document: &Document) -> Vec<Capability> {
    let mut used: BTreeSet<String> = ["scene.palette", "scene.visibility", "motion.score"]
        .into_iter()
        .map(String::from)
        .collect();
    fn drawing(node: &Node, used: &mut BTreeSet<String>) {
        if node.transform != [1., 0., 0., 1., 0., 0.] {
            used.insert("scene.affine".into());
        }
        if node.opacity != 1. {
            used.insert("scene.opacity".into());
        }
        if let Some(shape) = &node.shape {
            used.insert("scene.path".into());
            if !shape.dasharray.is_empty() || shape.dashoffset != 0. {
                used.insert("scene.stroke.dashes".into());
            }
            if shape.fill_rule == "evenodd" {
                used.insert("scene.clip.evenodd".into());
            }
            for paint in [&shape.fill, &shape.stroke] {
                match paint {
                    Paint::Linear { spread, stops, .. } | Paint::Radial { spread, stops, .. } => {
                        used.insert(
                            if matches!(paint, Paint::Linear { .. }) {
                                "scene.linear"
                            } else {
                                "scene.radial"
                            }
                            .into(),
                        );
                        if spread != "pad" {
                            used.insert(format!("scene.gradient.{spread}"));
                        }
                        if stops.iter().any(|s| s.rgba[3] != 1.) {
                            used.insert("scene.opacity".into());
                        }
                    }
                    Paint::Color { rgba, .. } if rgba[3] != 1. => {
                        used.insert("scene.opacity".into());
                    }
                    _ => (),
                }
            }
        }
        for child in &node.children {
            drawing(child, used);
        }
        if let Some(clip) = &node.clip {
            used.insert("scene.clip".into());
            drawing(clip, used);
        }
    }
    drawing(&document.scene.root, &mut used);
    let score = &document.score;
    for (id, present) in [
        (
            "states",
            score.states.as_ref().is_some_and(|v| !v.is_empty()),
        ),
        ("look", score.look.is_some()),
        (
            "attach",
            score.attach.as_ref().is_some_and(|v| !v.is_empty()),
        ),
        (
            "pivots",
            score.pivots.as_ref().is_some_and(|v| !v.is_empty()),
        ),
        (
            "hidden",
            score.hidden.as_ref().is_some_and(|v| !v.is_empty()),
        ),
        (
            "strength",
            score.liveliness.is_some() || score.part_gain.is_some(),
        ),
        ("speed", score.speed.is_some()),
        (
            "reactions",
            score.enter.is_some() || score.hover.is_some() || score.click.is_some(),
        ),
    ] {
        if present {
            used.insert(format!("motion.{id}"));
        }
    }
    for ambient in score.ambient.iter().flatten().chain(
        score
            .states
            .iter()
            .flat_map(|states| states.values())
            .flat_map(|state| state.ambient.iter().flatten()),
    ) {
        used.insert(format!(
            "ambient.{}",
            serde_json::to_string(&ambient.kind)
                .expect("enum serialization")
                .trim_matches('"')
        ));
    }
    let sequences = [&score.enter, &score.hover, &score.click]
        .into_iter()
        .chain(
            score
                .states
                .iter()
                .flat_map(|states| states.values())
                .map(|state| &state.enter),
        );
    for beat in sequences.flatten().flat_map(|sequence| &sequence.beats) {
        used.insert(format!(
            "beat.{}",
            serde_json::to_string(&beat.kind)
                .expect("enum serialization")
                .trim_matches('"')
        ));
    }
    for follow in score.follow.iter().flatten() {
        used.insert(format!(
            "follow.{}",
            serde_json::to_string(&follow.mode.unwrap_or_default())
                .expect("enum serialization")
                .trim_matches('"')
        ));
    }
    used.into_iter()
        .map(|id| Capability { id, version: 1 })
        .collect()
}
