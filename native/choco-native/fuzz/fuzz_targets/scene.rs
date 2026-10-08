#![no_main]
use choco_core::player::Player;
use choco_native::{render::Renderer, scene::Document};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|bytes: &[u8]| {
    // Mutate expanded documents so ZIP checksums/hashes cannot hide the semantic/renderer
    // interface from coverage. Renderer::new validates this public Rust input itself.
    if bytes.len() > 2_097_152 {
        return;
    }
    let Ok(document) = serde_json::from_slice::<Document>(bytes) else {
        return;
    };
    if document.validate().is_err() {
        return;
    }
    let Ok(mut player) = Player::new(document.score.clone(), &document.rig, false) else {
        return;
    };
    let Ok(mut renderer) = Renderer::new(&document, &player, 64, 64) else {
        return;
    };
    let _ = renderer.render(&player);
    for state in document
        .score
        .states
        .iter()
        .flat_map(|states| states.keys())
        .take(8)
    {
        if player.set_state(Some(state), false).is_err() {
            continue;
        }
        for delta in [0., 1. / 60., 0.37, 1.] {
            if player.advance(delta).is_ok() {
                let _ = renderer.render(&player);
            }
        }
    }
    if renderer.resize(32, 64).is_ok() {
        let _ = renderer.render(&player);
    }
});
