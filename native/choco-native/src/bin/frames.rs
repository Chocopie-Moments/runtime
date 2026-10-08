//! Deterministic frame capture through the production decoder/player/renderer boundary.
use choco_core::player::Player;
use choco_native::{render::Renderer, scene::Document};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    env, fs,
    io::{self, Read},
};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum Input {
    Seek {
        seconds: f64,
    },
    Trigger {
        name: String,
    },
    State {
        name: Option<String>,
        #[serde(default)]
        restart: bool,
    },
    Palette {
        colors: BTreeMap<String, String>,
    },
    Advance {
        seconds: f64,
    },
    Pause {
        paused: bool,
    },
    ReducedMotion {
        reduced: bool,
    },
    Look {
        x: Option<f64>,
        y: Option<f64>,
    },
    Resize {
        width: u32,
        height: u32,
    },
}
fn main() -> Result<(), String> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 {
        return Err("Usage: frames OUTPUT_DIRECTORY INPUT_TRACE_JSON < asset.choco".into());
    }
    let trace: Vec<Input> = serde_json::from_slice(&fs::read(&args[2]).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    io::stdin()
        .take(2_097_153)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let document = Document::read(&bytes)?;
    let mut player = Player::new(document.score.clone(), &document.rig, false)?;
    player.trigger("enter")?;
    let mut renderer = Renderer::new(&document, &player, 320, 320)?;
    fs::create_dir_all(&args[1]).map_err(|e| e.to_string())?;
    for (index, input) in trace.into_iter().enumerate() {
        match input {
            Input::Seek { seconds } => player.seek(seconds)?,
            Input::Trigger { name } => player.trigger(&name)?,
            Input::State { name, restart } => player.set_state(name.as_deref(), restart)?,
            Input::Palette { colors } => renderer.set_palette(&colors)?,
            Input::Advance { seconds } => player.advance(seconds)?,
            Input::Pause { paused } => player.set_paused(paused),
            Input::ReducedMotion { reduced } => player.set_reduced_motion(reduced),
            Input::Look { x, y } => player.look(x.zip(y).map(|(x, y)| [x, y]))?,
            Input::Resize { width, height } => renderer.resize(width, height)?,
        }
        let frame = renderer.render(&player)?;
        let pixels: Vec<_> = frame.pixels.iter().flat_map(|p| p.to_le_bytes()).collect();
        fs::write(format!("{}/{index}.rgba", args[1]), pixels).map_err(|e| e.to_string())?;
    }
    Ok(())
}
