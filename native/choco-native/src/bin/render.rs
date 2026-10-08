//! Headless exercise of the same retained renderer used by the iOS host.
use choco_core::player::Player;
use choco_native::{render::Renderer, scene::Document};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{self, Read},
    time::Instant,
};

fn main() -> Result<(), String> {
    let destination = env::args().nth(1).ok_or("Supply an output RGBA path")?;
    let size: u32 = env::args()
        .nth(2)
        .map(|value| value.parse().map_err(|_| "Invalid render size"))
        .transpose()?
        .unwrap_or(320);
    let state = env::args().nth(3);
    let mut digest = (env::args().nth(4).as_deref() == Some("--verify-frames")).then(Sha256::new);
    let mut bytes = Vec::new();
    io::stdin()
        .take(2_097_153)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let load_started = Instant::now();
    let document = Document::read(&bytes)?;
    let decode_ms = load_started.elapsed().as_secs_f64() * 1000.;
    let started = Instant::now();
    let mut player = Player::new(document.score.clone(), &document.rig, false)?;
    if let Some(state) = state.as_deref() {
        player.set_state(Some(state), false)?;
    }
    let compile_ms = started.elapsed().as_secs_f64() * 1000.;
    let renderer_started = Instant::now();
    let mut renderer = Renderer::new(&document, &player, size, size)?;
    let renderer_init_ms = renderer_started.elapsed().as_secs_f64() * 1000.;
    let raster_started = Instant::now();
    let pixels = renderer.render(&player)?.pixels;
    let first_raster_ms = raster_started.elapsed().as_secs_f64() * 1000.;
    let first = started.elapsed().as_secs_f64() * 1000.;
    let load_to_first = load_started.elapsed().as_secs_f64() * 1000.;
    let rgba: Vec<u8> = pixels
        .iter()
        .flat_map(|pixel| pixel.to_le_bytes())
        .collect();
    if let Some(digest) = &mut digest {
        digest.update(&rgba);
    }
    fs::write(destination, rgba).map_err(|e| e.to_string())?;
    let mut samples = Vec::new();
    for _ in 0..240 {
        let start = Instant::now();
        player.advance(1. / 60.)?;
        let pixels = renderer.render(&player)?.pixels;
        samples.push(start.elapsed().as_secs_f64() * 1000.);
        if let Some(digest) = &mut digest {
            for pixel in pixels {
                digest.update(pixel.to_le_bytes());
            }
        }
    }
    samples.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"assetBytes": bytes.len(), "width": size, "height": size, "state": player.state(), "frames": samples.len(), "frameSha256": digest.map(|digest| format!("{:x}", digest.finalize())), "decodeMs": decode_ms, "compileMs": compile_ms, "rendererInitMs": renderer_init_ms, "firstRasterMs": first_raster_ms, "firstDrawMs": first, "loadToFirstFrameMs": load_to_first, "p50Ms": samples[120], "p95Ms": samples[228], "retainedPaints": renderer.retained_paints()})
    );
    Ok(())
}
