use choco_native::ffi::*;
use serde_json::json;

fn source(color: &str) -> serde_json::Value {
    json!({
        "palette":{"accent":color,"secondary":"#000000","ink":"#000000","background":"#ffffff"},"score":{},"rig":{"width":16,"height":16,"parts":[]},
        "scene":{"viewBox":[0,0,16,16],"root":{
            "transform":[1,0,0,1,0,0],"opacity":1,"displayed":true,"visible":true,"children":[],
            "shape":{
                "contours":[{"start":[0,0],"closed":true,"segments":[
                    {"c1":[0,0],"c2":[16,0],"to":[16,0],"line":true},
                    {"c1":[16,0],"c2":[16,16],"to":[16,16],"line":true},
                    {"c1":[16,16],"c2":[0,16],"to":[0,16],"line":true}
                ]}],
                "fill":{"kind":"color","rgba":[1,0,0,1],"role":"accent"},"stroke":{"kind":"none"},
                "fillRule":"nonzero","strokeWidth":0,"linecap":"butt","linejoin":"miter","miterlimit":4,
                "dasharray":[],"dashoffset":0
            }
        }}
    })
}

fn document(color: &str) -> Vec<u8> {
    archive(source(color))
}

fn archive(source: serde_json::Value) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    let mut files = BTreeMap::from([
        ("scene.json", serde_json::to_vec(&source["scene"]).unwrap()),
        (
            "motion.json",
            serde_json::to_vec(
                &json!({"kind":"score","rig":source["rig"],"score":source["score"]}),
            )
            .unwrap(),
        ),
    ]);
    let mut required = vec![
        "motion.score".to_string(),
        "scene.palette".into(),
        "scene.path".into(),
        "scene.visibility".into(),
    ];
    let mut states = vec!["idle"];
    if source["score"]["states"]["future"].is_object() {
        states.push("future");
        required.push("motion.states".into());
        required.push(format!(
            "beat.{}",
            source["score"]["states"]["future"]["enter"]["beats"][0]["do"]
                .as_str()
                .unwrap()
        ));
    }
    if source["scene"]["root"]["opacity"].as_f64() != Some(1.) {
        required.push("scene.opacity".into());
    }
    required.sort();
    states.sort();
    let descriptors: BTreeMap<_, _> = files
        .iter()
        .map(|(name, content)| {
            (
                *name,
                json!({"bytes":content.len(),"sha256":format!("{:x}",Sha256::digest(content))}),
            )
        })
        .collect();
    files.insert("manifest.json", serde_json::to_vec(&json!({"format":"choco","formatVersion":0,"formatRevision":2,"semanticsVersion":1,"name":"Test","kind":"success","palette":source["palette"],"states":states,"required":required.iter().map(|id| json!({"id":id,"version":1})).collect::<Vec<_>>(),"files":descriptors})).unwrap());
    let mut bytes = Vec::new();
    let mut directory = Vec::new();
    for (name, content) in files {
        let offset = bytes.len() as u32;
        let crc = crc32fast::hash(&content);
        let mut header = vec![0_u8; 30];
        header[..4].copy_from_slice(&0x04034b50_u32.to_le_bytes());
        header[4..6].copy_from_slice(&20_u16.to_le_bytes());
        header[14..18].copy_from_slice(&crc.to_le_bytes());
        header[18..22].copy_from_slice(&(content.len() as u32).to_le_bytes());
        header[22..26].copy_from_slice(&(content.len() as u32).to_le_bytes());
        header[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
        bytes.extend(header);
        bytes.extend(name.as_bytes());
        bytes.extend(&content);
        let mut record = vec![0_u8; 46];
        record[..4].copy_from_slice(&0x02014b50_u32.to_le_bytes());
        record[6..8].copy_from_slice(&20_u16.to_le_bytes());
        record[16..20].copy_from_slice(&crc.to_le_bytes());
        record[20..24].copy_from_slice(&(content.len() as u32).to_le_bytes());
        record[24..28].copy_from_slice(&(content.len() as u32).to_le_bytes());
        record[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
        record[42..46].copy_from_slice(&offset.to_le_bytes());
        directory.extend(record);
        directory.extend(name.as_bytes());
    }
    let mut end = vec![0_u8; 22];
    end[..4].copy_from_slice(&0x06054b50_u32.to_le_bytes());
    end[8..10].copy_from_slice(&3_u16.to_le_bytes());
    end[10..12].copy_from_slice(&3_u16.to_le_bytes());
    end[12..16].copy_from_slice(&(directory.len() as u32).to_le_bytes());
    end[16..20].copy_from_slice(&(bytes.len() as u32).to_le_bytes());
    bytes.extend(directory);
    bytes.extend(end);
    bytes
}

fn ffi_draws_pixels_reports_errors_and_keeps_other_instances_alive() {
    let bytes = document("#ff0000");
    let mut error = [0_u8; 512];
    unsafe {
        let first = choco_player_create(
            bytes.as_ptr(),
            bytes.len(),
            16,
            16,
            false,
            error.as_mut_ptr(),
            error.len(),
        );
        let second = choco_player_create(
            bytes.as_ptr(),
            bytes.len(),
            16,
            16,
            false,
            error.as_mut_ptr(),
            error.len(),
        );
        assert!(!first.is_null() && !second.is_null());
        choco_player_destroy(first);
        let frame = choco_player_frame(second, 1. / 60., 16, 16, error.as_mut_ptr(), error.len());
        assert!(frame.changed);
        let pixels = frame.pixels;
        assert!(!pixels.is_null());
        assert_eq!(
            std::slice::from_raw_parts(pixels.add((8 * 16 + 8) * 4), 4),
            [255, 0, 0, 255]
        );
        assert!(!choco_player_state(
            second,
            b"missing".as_ptr(),
            7,
            false,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(String::from_utf8_lossy(&error).starts_with("Unknown state"));
        assert!(
            choco_player_frame(second, 0., 4097, 16, error.as_mut_ptr(), error.len())
                .pixels
                .is_null()
        );
        let unchanged = choco_player_frame(second, 0., 16, 16, error.as_mut_ptr(), error.len());
        assert!(!unchanged.pixels.is_null());
        assert!(!unchanged.changed);
        assert_eq!(unchanged.pixels, pixels);
        let resized = choco_player_frame(second, 0., 32, 32, error.as_mut_ptr(), error.len());
        assert!(!resized.pixels.is_null());
        assert!(resized.changed);
        assert_eq!(
            std::slice::from_raw_parts(resized.pixels.add((16 * 32 + 16) * 4), 4),
            [255, 0, 0, 255]
        );
        assert!(!resized.needs_frame);
        assert!(choco_player_seek(
            second,
            2.,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(choco_player_pause(
            second,
            true,
            error.as_mut_ptr(),
            error.len()
        ));
        assert_eq!(
            choco_player_frame(second, 100., 32, 32, error.as_mut_ptr(), error.len()).time,
            2.
        );
        assert!(!choco_player_seek(
            second,
            f64::NAN,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(!choco_player_trigger(
            second,
            3,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(choco_player_trigger(
            second,
            2,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(!choco_player_look(
            second,
            true,
            f64::INFINITY,
            0.,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(choco_player_reduced_motion(
            second,
            true,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(choco_player_palette(
            second,
            0x00ff00,
            0,
            0,
            0xffffff,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(!choco_player_palette(
            second,
            0x1000000,
            0,
            0,
            0xffffff,
            error.as_mut_ptr(),
            error.len()
        ));
        let recolored = choco_player_frame(second, 0., 32, 32, error.as_mut_ptr(), error.len());
        assert_eq!(
            std::slice::from_raw_parts(recolored.pixels.add((16 * 32 + 16) * 4), 4),
            [0, 255, 0, 255]
        );
        choco_player_destroy(second);
    }
}

fn concurrent_render_threads_fail_before_entering_the_backend() {
    let bytes = document("#ff0000");
    let mut error = [0_u8; 512];
    let owner = unsafe {
        choco_player_create(
            bytes.as_ptr(),
            bytes.len(),
            16,
            16,
            false,
            error.as_mut_ptr(),
            error.len(),
        )
    };
    assert!(!owner.is_null());
    let threads: Vec<_> = (0..4)
        .map(|_| {
            std::thread::spawn(|| {
                let bytes = document("#ff0000");
                for _ in 0..32 {
                    let mut error = [0_u8; 512];
                    let handle = unsafe {
                        choco_player_create(
                            bytes.as_ptr(),
                            bytes.len(),
                            16,
                            16,
                            false,
                            error.as_mut_ptr(),
                            error.len(),
                        )
                    };
                    assert!(handle.is_null());
                    assert!(String::from_utf8_lossy(&error).contains("same rendering thread"));
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    unsafe {
        assert!(
            !choco_player_frame(owner, 0., 16, 16, error.as_mut_ptr(), error.len())
                .pixels
                .is_null()
        );
        choco_player_destroy(owner);
    }
    // A new presentation context may select another thread after all handles are gone.
    std::thread::spawn(ffi_draws_pixels_reports_errors_and_keeps_other_instances_alive)
        .join()
        .unwrap();
}

fn malformed_input_and_non_ascii_palette_return_errors() {
    for bytes in [b"not json".to_vec(), document("#ééff")] {
        let mut error = [0_u8; 512];
        let handle = unsafe {
            choco_player_create(
                bytes.as_ptr(),
                bytes.len(),
                16,
                16,
                false,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        assert!(handle.is_null());
        assert_ne!(error[0], 0);
    }
}

fn flow_copies_follow_clock_palette_and_cancellation() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    let mut value = source("#ff0000");
    value["rig"] =
        json!({"width":64,"height":64,"parts":[{"id":"shape","parent":null,"box":[0,0,16,16]}]});
    value["scene"]["viewBox"] = json!([0, 0, 64, 64]);
    value["scene"]["root"]["bindings"] = json!(["shape"]);
    value["scene"]["root"]["part"] = json!({"id":"shape","name":"Shape","background":false});
    value["score"] = json!({"enter":{"beats":[{"do":"flow","part":"shape","points":[[48,0]],"dur":2,"at":0.2,"count":1,"endScale":1}]},"click":{"beats":[{"do":"flow","part":"shape","points":[[0,48]],"dur":2,"count":1,"endScale":1}]},"states":{"flight":{"enter":{"beats":[{"do":"flow","part":"shape","points":[[0,48]],"dur":2,"count":1,"endScale":1}]}},"rest":{}}});
    let document: Document = serde_json::from_value(value.clone()).unwrap();
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    player.trigger("enter").unwrap();
    let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    let count = renderer.retained_paints();
    let rest = renderer.render(&player).unwrap().pixels.to_vec();
    assert_eq!(rest[8 * 64 + 8].to_le_bytes(), [255, 0, 0, 255]);
    assert_eq!(rest[8 * 64 + 32], 0);
    player.seek(1.2).unwrap();
    let moving = renderer.render(&player).unwrap().pixels.to_vec();
    assert_eq!(moving[8 * 64 + 32].to_le_bytes(), [255, 0, 0, 255]);
    player.set_paused(true);
    player.advance(100.).unwrap();
    assert!(!renderer.render(&player).unwrap().changed);
    let mut palette = document.palette.clone();
    palette.insert("accent".into(), "#00ff00".into());
    renderer.set_palette(&palette).unwrap();
    assert_eq!(
        renderer.render(&player).unwrap().pixels[8 * 64 + 32].to_le_bytes(),
        [0, 255, 0, 255]
    );
    player.seek(3.).unwrap();
    assert_eq!(renderer.render(&player).unwrap().pixels[8 * 64 + 32], 0);
    player.seek(1.2).unwrap();
    assert_eq!(
        renderer.render(&player).unwrap().pixels[8 * 64 + 32].to_le_bytes(),
        [0, 255, 0, 255]
    );
    player.set_state(Some("flight"), false).unwrap();
    player.seek(2.2).unwrap();
    assert_ne!(renderer.render(&player).unwrap().pixels[32 * 64 + 8], 0);
    player.set_state(Some("rest"), false).unwrap();
    assert_eq!(renderer.render(&player).unwrap().pixels[32 * 64 + 8], 0);
    for _ in 0..100 {
        player.trigger("click").unwrap();
        player.seek(player.time() + 1.).unwrap();
        assert_ne!(renderer.render(&player).unwrap().pixels[32 * 64 + 8], 0);
        assert_eq!(renderer.retained_paints(), count);
    }
    let mut reduced = Player::new(document.score.clone(), &document.rig, true).unwrap();
    reduced.trigger("enter").unwrap();
    reduced.seek(1.2).unwrap();
    assert_eq!(renderer.render(&reduced).unwrap().pixels[8 * 64 + 32], 0);
    // Reject excessive geometry even when only an inactive state requests it.
    value["score"] = json!({"states":{"huge":{"enter":{"beats":(0..16).map(|_| json!({"do":"flow","part":"shape","points":[[1,1]],"dur":1,"count":12})).collect::<Vec<_>>()}}}});
    let child = source("#ff0000")["scene"]["root"].clone();
    value["scene"]["root"]["children"] = json!((0..30).map(|_| child.clone()).collect::<Vec<_>>());
    let document: Document = serde_json::from_value(value).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    assert!(
        Renderer::new(&document, &player, 64, 64)
            .err()
            .unwrap()
            .contains("retained geometry budget")
    );
}

#[test]
fn native_boundary_lifecycle_and_failures() {
    shared_assets_own_metadata_and_independent_players();
    native_selection_follows_animated_wrappers_and_hides_invisible_parts();
    nested_selection_preserves_parent_spaces_order_and_visibility();
    painted_hits_respect_holes_masks_motion_descendants_and_effect_exclusion();
    translucent_overlap_has_uniform_color_and_stays_opaque();
    an_empty_authored_dash_preserves_the_shapes_fill();
    strokes_reveal_without_changing_fill_and_restore_on_cancellation();
    group_opacity_is_composited_once_after_a_hidden_first_frame();
    degenerate_and_maximum_bursts_stay_bounded();
    bursts_follow_clock_palette_cancellation_and_reduced_motion();
    extreme_viewports_fail_without_invalidating_the_previous_frame();
    retained_frames_follow_motion_palette_and_resize();
    malformed_input_and_non_ascii_palette_return_errors();
    flow_copies_follow_clock_palette_and_cancellation();
    concurrent_render_threads_fail_before_entering_the_backend();
    for _ in 0..64 {
        ffi_draws_pixels_reports_errors_and_keeps_other_instances_alive();
    }
}

fn translucent_overlap_has_uniform_color_and_stays_opaque() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    let mut value = source("#ff0000");
    let mut overlay = value["scene"]["root"].clone();
    overlay["shape"]["fill"] = json!({"kind":"color","rgba":[0,0,1,0.5]});
    // Odd start and span length exercise scalar alignment, SIMD pairs and scalar tails.
    overlay["transform"] = json!([1, 0, 0, 1, 1, 0]);
    value["scene"]["root"]["children"] = json!([overlay]);
    let document: Document = serde_json::from_value(value).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 16, 16).unwrap();
    let pixels = renderer.render(&player).unwrap().pixels;
    for y in 1..15 {
        for x in 1..16 {
            assert_eq!(
                pixels[y * 16 + x].to_le_bytes(),
                [127, 0, 128, 255],
                "overlap at ({x}, {y})"
            );
        }
    }
}

fn an_empty_authored_dash_preserves_the_shapes_fill() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    let mut value = source("#ff0000");
    let shape = &mut value["scene"]["root"]["shape"];
    shape["stroke"] = json!({"kind":"color","rgba":[0,0,0,1]});
    shape["strokeWidth"] = json!(2);
    shape["dasharray"] = json!([64, 64]);
    shape["dashoffset"] = json!(64);
    let document: Document = serde_json::from_value(value).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 16, 16).unwrap();
    assert_eq!(
        renderer.render(&player).unwrap().pixels[8 * 16 + 8].to_le_bytes(),
        [255, 0, 0, 255]
    );
}

fn group_opacity_is_composited_once_after_a_hidden_first_frame() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    let mut value = source("#ff0000");
    let child = value["scene"]["root"].clone();
    value["scene"]["root"]
        .as_object_mut()
        .unwrap()
        .remove("shape");
    value["scene"]["root"]["children"] = json!([child, child]);
    value["scene"]["root"]["bindings"] = json!(["group"]);
    value["scene"]["root"]["part"] = json!({"id":"group","name":"Group","background":false});
    value["rig"]["parts"] = json!([{"id":"group","parent":null,"box":[0,0,16,16]}]);
    value["score"] = json!({"enter":{"beats":[
        {"do":"to","part":"group","dur":0,"pose":{"opacity":0}},
        {"do":"to","part":"group","dur":0.32,"pose":{"opacity":1}}
    ]}});
    let document: Document = serde_json::from_value(value).unwrap();
    for hidden_first in [false, true] {
        let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
        player.trigger("enter").unwrap();
        let mut renderer = Renderer::new(&document, &player, 16, 16).unwrap();
        if hidden_first {
            assert!(
                renderer
                    .render(&player)
                    .unwrap()
                    .pixels
                    .iter()
                    .all(|p| *p == 0)
            );
        }
        player.seek(0.2).unwrap();
        let alpha = (player.opacity(0) * 255.).round() as u8;
        assert!(alpha > 0 && alpha < 255);
        assert_eq!(
            renderer.render(&player).unwrap().pixels[8 * 16 + 8].to_le_bytes(),
            [alpha, 0, 0, alpha]
        );
    }
}

fn degenerate_and_maximum_bursts_stay_bounded() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    for size in [0., 1e-300, 200.] {
        for duration in [0., 1.] {
            let mut value = source("#ff0000");
            value["scene"]["root"]
                .as_object_mut()
                .unwrap()
                .remove("shape");
            value["score"] = json!({"enter":{"beats":[{"do":"burst","count":64,"size":size,"dur":duration,"distance":0,"gravity":0}]}});
            let document: Document = serde_json::from_value(value).unwrap();
            let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
            player.trigger("enter").unwrap();
            let mut renderer = Renderer::new(&document, &player, 16, 16).unwrap();
            player.advance(0.5).unwrap();
            let pixels = renderer.render(&player).unwrap().pixels;
            if size < 1. || duration == 0. {
                assert!(pixels.iter().all(|p| *p == 0));
            }
            // Scene root, viewport, effect layer and the compiler's 24-particle cap.
            assert_eq!(renderer.retained_paints(), 27);
        }
    }
}

fn extreme_viewports_fail_without_invalidating_the_previous_frame() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    for extent in [1e-300, 1e-100] {
        let mut value = source("#ff0000");
        value["rig"]["width"] = json!(extent);
        value["rig"]["height"] = json!(extent);
        value["scene"]["viewBox"] = json!([0, 0, extent, extent]);
        let document: Document = serde_json::from_value(value).unwrap();
        document.validate().unwrap();
        let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
        let error = Renderer::new(&document, &player, 64, 64).err().unwrap();
        assert_eq!(error, "Viewport exceeds the renderer numeric budget");
    }
    let mut value = source("#ff0000");
    value["rig"]["width"] = json!(1e-6);
    value["rig"]["height"] = json!(1e-6);
    value["scene"]["viewBox"] = json!([0, 0, 1e-6, 1e-6]);
    value["scene"]["root"]
        .as_object_mut()
        .unwrap()
        .remove("shape");
    let document: Document = serde_json::from_value(value).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 1, 1).unwrap();
    assert!(renderer.render(&player).unwrap().changed);
    assert!(renderer.resize(4096, 1024).is_err());
    assert_eq!(renderer.size(), (1, 1));
    let frame = renderer.render(&player).unwrap();
    assert!(!frame.changed);
    assert_eq!(frame.pixels, [0]);
}

fn retained_frames_follow_motion_palette_and_resize() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    let mut value = source("#ff0000");
    value["rig"]["parts"] = json!([{"id":"shape","parent":null,"box":[0,0,16,16]}]);
    value["scene"]["root"]["bindings"] = json!(["shape"]);
    value["scene"]["root"]["part"] = json!({"id":"shape","name":"Shape","background":false});
    value["score"] = json!({"states":{
        "moved":{"enter":{"beats":[{"do":"to","part":"shape","dur":1,"pose":{"x":8,"opacity":0.5}}]}},
        "gone":{"enter":{"beats":[{"do":"hide","part":"shape"}]}}
    }});
    let document: Document = serde_json::from_value(value).unwrap();
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 16, 16).unwrap();
    let first = renderer.render(&player).unwrap();
    assert!(first.changed);
    assert_eq!(first.pixels[8 * 16 + 8].to_le_bytes(), [255, 0, 0, 255]);
    player.advance(1.).unwrap();
    assert!(!renderer.render(&player).unwrap().changed);
    player.set_state(Some("moved"), false).unwrap();
    player.advance(1.).unwrap();
    let moved = renderer.render(&player).unwrap();
    assert!(moved.changed);
    assert_eq!(moved.pixels[8 * 16 + 2], 0);
    assert_eq!(moved.pixels[8 * 16 + 12].to_le_bytes(), [128, 0, 0, 128]);
    player.set_paused(true);
    player.advance(20.).unwrap();
    assert!(!renderer.render(&player).unwrap().changed);
    let mut palette = document.palette.clone();
    palette.insert("accent".into(), "#00ff00".into());
    renderer.set_palette(&palette).unwrap();
    let recolored = renderer.render(&player).unwrap();
    assert!(recolored.changed);
    assert_eq!(
        recolored.pixels[8 * 16 + 12].to_le_bytes(),
        [0, 128, 0, 128]
    );
    palette.insert("accent".into(), "invalid".into());
    assert!(renderer.set_palette(&palette).is_err());
    assert!(!renderer.render(&player).unwrap().changed);
    renderer.resize(32, 32).unwrap();
    let resized = renderer.render(&player).unwrap();
    assert!(resized.changed);
    assert_eq!(resized.pixels.len(), 1024);
    assert_eq!(resized.pixels[16 * 32 + 24].to_le_bytes(), [0, 128, 0, 128]);
    renderer.resize(32, 32).unwrap();
    assert!(renderer.resize(0, 32).is_err());
    assert!(!renderer.render(&player).unwrap().changed);
    player.seek(0.).unwrap();
    let rewound = renderer.render(&player).unwrap();
    assert!(rewound.changed);
    assert_eq!(rewound.pixels[16 * 32 + 4].to_le_bytes(), [0, 255, 0, 255]);
    player.set_state(Some("gone"), false).unwrap();
    player.seek(3.).unwrap();
    let hidden = renderer.render(&player).unwrap();
    assert!(hidden.changed);
    assert!(hidden.pixels.iter().all(|pixel| *pixel == 0));
    assert!(!renderer.render(&player).unwrap().changed);
}

fn bursts_follow_clock_palette_cancellation_and_reduced_motion() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    let mut value = source("#ff0000");
    value["scene"]["root"]
        .as_object_mut()
        .unwrap()
        .remove("shape");
    let burst = json!({"beats":[{"do":"burst","from":[8,8],"count":3,"shapes":["circle","rect","star"],"colors":["accent"],"size":3,"distance":0,"gravity":0,"dur":1,"at":0.2,"stagger":0.1}]});
    value["score"] = json!({"speed":2,"enter":burst,"click":burst,"states":{"future":{"enter":burst},"empty":{}}});
    let document: Document = serde_json::from_value(value).unwrap();
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 128, 128).unwrap();
    renderer.render(&player).unwrap();
    let baseline = renderer.retained_paints();
    player.trigger("enter").unwrap();
    assert!(
        renderer
            .render(&player)
            .unwrap()
            .pixels
            .iter()
            .all(|p| *p == 0)
    );
    assert_eq!(renderer.retained_paints(), baseline + 3);
    player.advance(0.3).unwrap();
    let first = renderer.render(&player).unwrap().pixels.to_vec();
    assert!(first.iter().any(|p| p.to_le_bytes() == [255, 0, 0, 255]));
    player.set_paused(true);
    player.advance(30.).unwrap();
    assert!(!renderer.render(&player).unwrap().changed);
    let mut palette = document.palette.clone();
    palette.insert("accent".into(), "#00ff00".into());
    renderer.set_palette(&palette).unwrap();
    assert!(
        renderer
            .render(&player)
            .unwrap()
            .pixels
            .iter()
            .any(|p| p.to_le_bytes() == [0, 255, 0, 255])
    );
    renderer.set_palette(&document.palette).unwrap();
    player.seek(2.).unwrap();
    assert!(
        renderer
            .render(&player)
            .unwrap()
            .pixels
            .iter()
            .all(|p| *p == 0)
    );
    player.seek(0.3).unwrap();
    assert_eq!(renderer.render(&player).unwrap().pixels, first);
    player.set_state(Some("future"), false).unwrap();
    renderer.render(&player).unwrap();
    assert_eq!(renderer.retained_paints(), baseline + 6);
    player.trigger("click").unwrap();
    assert!(
        renderer
            .render(&player)
            .unwrap()
            .pixels
            .iter()
            .all(|p| *p == 0)
    );
    assert_eq!(renderer.retained_paints(), baseline + 6);
    player.set_state(Some("empty"), false).unwrap();
    renderer.render(&player).unwrap();
    assert_eq!(renderer.retained_paints(), baseline + 3);
    for _ in 0..100 {
        player.trigger("click").unwrap();
        player.seek(player.time() + 0.3).unwrap();
        renderer.render(&player).unwrap();
        assert_eq!(renderer.retained_paints(), baseline + 3);
    }
    let mut reduced = Player::new(document.score.clone(), &document.rig, true).unwrap();
    reduced.trigger("enter").unwrap();
    let mut reduced_renderer = Renderer::new(&document, &reduced, 128, 128).unwrap();
    assert!(
        reduced_renderer
            .render(&reduced)
            .unwrap()
            .pixels
            .iter()
            .all(|p| *p == 0)
    );
    assert_eq!(reduced_renderer.retained_paints(), baseline);
    reduced.advance(0.3).unwrap();
    assert!(!reduced_renderer.render(&reduced).unwrap().changed);
}

fn strokes_reveal_without_changing_fill_and_restore_on_cancellation() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    let mut value = source("#ff0000");
    value["rig"]["parts"] = json!([{"id":"shape","parent":null,"box":[0,0,16,16]}]);
    value["scene"]["root"]["bindings"] = json!(["shape"]);
    value["scene"]["root"]["part"] = json!({"id":"shape","name":"Shape","background":false});
    let shape = &mut value["scene"]["root"]["shape"];
    shape["contours"] = json!([{"start":[2,8],"closed":false,"segments":[{"c1":[2,8],"c2":[14,8],"to":[14,8],"line":true}]}]);
    shape["fill"] = json!({"kind":"none"});
    shape["stroke"] = json!({"kind":"color","rgba":[1,0,0,1],"role":"accent"});
    shape["strokeWidth"] = json!(2);
    shape["dasharray"] = json!([2, 2]);
    shape["dashoffset"] = json!(1);
    let reveal = json!({"beats":[{"do":"drawOn","part":"shape","at":0.2,"dur":1}]});
    let erase = json!({"beats":[{"do":"drawOff","part":"shape","dur":1}]});
    value["score"] =
        json!({"speed":2,"click":erase,"states":{"reveal":{"enter":reveal},"rest":{}}});
    let document: Document = serde_json::from_value(value.clone()).unwrap();
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 128, 128).unwrap();
    let baseline = renderer.render(&player).unwrap().pixels.to_vec();
    let paints = renderer.retained_paints();
    player.set_state(Some("reveal"), false).unwrap();
    assert!(
        renderer
            .render(&player)
            .unwrap()
            .pixels
            .iter()
            .all(|p| *p == 0)
    );
    player.advance(0.05).unwrap();
    assert!(!renderer.render(&player).unwrap().changed);
    player.seek(0.35).unwrap(); // speed 2: .2 delay + .5 reveal
    let half = renderer.render(&player).unwrap().pixels.to_vec();
    assert_eq!(half[64 * 128 + 40].to_le_bytes(), [255, 0, 0, 255]);
    assert_eq!(half[64 * 128 + 88], 0);
    player.set_paused(true);
    player.advance(100.).unwrap();
    assert!(!renderer.render(&player).unwrap().changed);
    player.seek(0.6).unwrap();
    let full = renderer.render(&player).unwrap().pixels.to_vec();
    assert_eq!(full[64 * 128 + 88].to_le_bytes(), [255, 0, 0, 255]);
    assert_ne!(full, baseline);
    player.seek(0.35).unwrap();
    assert_eq!(renderer.render(&player).unwrap().pixels, half);
    player.trigger("click").unwrap(); // newer trigger replaces the state's draw
    assert_eq!(renderer.render(&player).unwrap().pixels, full);
    player.seek(0.85).unwrap();
    assert!(
        renderer
            .render(&player)
            .unwrap()
            .pixels
            .iter()
            .all(|p| *p == 0)
    );
    player.set_state(Some("rest"), false).unwrap(); // trigger survives state cancellation
    assert!(!renderer.render(&player).unwrap().changed);
    player.set_state(Some("reveal"), false).unwrap(); // newest state now wins
    player.seek(1.45).unwrap();
    assert_eq!(renderer.render(&player).unwrap().pixels, full);
    for _ in 0..100 {
        player.trigger("click").unwrap();
        renderer.render(&player).unwrap();
        assert_eq!(renderer.retained_paints(), paints);
    }
    // A state-only player returns precisely to authored dashes when cancelled.
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    player.set_state(Some("reveal"), false).unwrap();
    renderer.render(&player).unwrap();
    player.set_state(Some("rest"), false).unwrap();
    assert_eq!(renderer.render(&player).unwrap().pixels, baseline);
    let mut reduced = Player::new(document.score.clone(), &document.rig, true).unwrap();
    reduced.set_state(Some("reveal"), false).unwrap();
    reduced.trigger("click").unwrap();
    assert_eq!(renderer.render(&reduced).unwrap().pixels, baseline);
    assert!(!renderer.render(&reduced).unwrap().changed);

    // Targeting an ancestor also reaches child geometry, without revealing fills or clip paths.
    let mut child = value["scene"]["root"].clone();
    child.as_object_mut().unwrap().remove("part");
    child["bindings"] = json!([]);
    child["shape"]["contours"][0]["closed"] = json!(true);
    child["shape"]["contours"][0]["segments"] = json!([
        {"c1":[2,8],"c2":[14,8],"to":[14,8],"line":true},
        {"c1":[14,8],"c2":[8,14],"to":[8,14],"line":true}
    ]);
    child["shape"]["fill"] = json!({"kind":"color","rgba":[0,1,0,1]});
    value["scene"]["root"]
        .as_object_mut()
        .unwrap()
        .remove("shape");
    value["scene"]["root"]["children"] = json!([child]);
    let document: Document = serde_json::from_value(value).unwrap();
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    player.set_state(Some("reveal"), false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 128, 128).unwrap();
    let pixels = renderer.render(&player).unwrap().pixels;
    assert_eq!(pixels[80 * 128 + 64].to_le_bytes(), [0, 255, 0, 255]);
    assert!(!pixels.iter().any(|p| p.to_le_bytes()[0] > 0));
}

fn shared_assets_own_metadata_and_independent_players() {
    let bytes = document("#ff0000");
    let mut error = [0_u8; 512];
    unsafe {
        let asset =
            choco_asset_create(bytes.as_ptr(), bytes.len(), error.as_mut_ptr(), error.len());
        assert!(!asset.is_null());
        let count = choco_asset_metadata(asset, std::ptr::null_mut(), 0);
        assert!(count > 0);
        let mut short = [0x7f_u8; 4];
        assert_eq!(
            choco_asset_metadata(asset, short.as_mut_ptr(), short.len()),
            count
        );
        assert_eq!(short, [0x7f; 4]);
        let mut metadata = vec![0; count];
        assert_eq!(
            choco_asset_metadata(asset, metadata.as_mut_ptr(), count),
            count
        );
        let metadata: serde_json::Value = serde_json::from_slice(&metadata).unwrap();
        assert_eq!(metadata["manifest"]["name"], "Test");
        assert_eq!(metadata["viewBox"], json!([0., 0., 16., 16.]));
        assert!(metadata["attribution"].is_null());
        let first = choco_player_from_asset(asset, 16, 16, false, error.as_mut_ptr(), error.len());
        let second = choco_player_from_asset(asset, 16, 16, false, error.as_mut_ptr(), error.len());
        assert!(!first.is_null() && !second.is_null());
        choco_asset_destroy(asset);
        assert!(choco_player_palette(
            first,
            0x00ff00,
            0,
            0,
            0xffffff,
            error.as_mut_ptr(),
            error.len()
        ));
        let green = choco_player_frame(first, 1., 16, 16, error.as_mut_ptr(), error.len());
        assert_eq!(
            std::slice::from_raw_parts(green.pixels.add((8 * 16 + 8) * 4), 4),
            [0, 255, 0, 255]
        );
        let red = choco_player_frame(second, 0., 16, 16, error.as_mut_ptr(), error.len());
        assert_eq!(red.time, 0.);
        assert_eq!(
            std::slice::from_raw_parts(red.pixels.add((8 * 16 + 8) * 4), 4),
            [255, 0, 0, 255]
        );
        choco_player_destroy(first);
        assert!(
            !choco_player_frame(second, 0., 32, 32, error.as_mut_ptr(), error.len())
                .pixels
                .is_null()
        );
        choco_player_destroy(second);
        assert!(
            choco_asset_create(b"broken".as_ptr(), 6, error.as_mut_ptr(), error.len()).is_null()
        );
        assert_eq!(
            choco_asset_metadata(std::ptr::null(), std::ptr::null_mut(), 0),
            0
        );
    }
}

fn native_selection_follows_animated_wrappers_and_hides_invisible_parts() {
    let mut value = source("#ff0000");
    value["rig"]["parts"] = json!([{"id":"shape","parent":null,"box":[0,0,16,16]}]);
    value["scene"]["root"]["bindings"] = json!(["shape"]);
    value["scene"]["root"]["part"] = json!({"id":"shape","name":"Shape","background":false});
    value["score"] = json!({"states":{"future":{"enter":{"beats":[{"do":"to","part":"shape","dur":1,"pose":{"x":16}}]}}}});
    let bytes = archive(value.clone());
    let mut error = [0_u8; 512];
    unsafe {
        let player = choco_player_create(
            bytes.as_ptr(),
            bytes.len(),
            32,
            32,
            false,
            error.as_mut_ptr(),
            error.len(),
        );
        assert!(!player.is_null(), "{}", String::from_utf8_lossy(&error));
        fn info(player: *const ChocoPlayer) -> serde_json::Value {
            let mut error = [0_u8; 512];
            unsafe {
                let count = choco_player_info(
                    player,
                    std::ptr::null_mut(),
                    0,
                    error.as_mut_ptr(),
                    error.len(),
                );
                assert!(count > 0);
                let mut bytes = vec![0; count];
                assert_eq!(
                    choco_player_info(
                        player,
                        bytes.as_mut_ptr(),
                        count,
                        error.as_mut_ptr(),
                        error.len()
                    ),
                    count
                );
                serde_json::from_slice(&bytes).unwrap()
            }
        }
        assert!(
            !choco_player_frame(player, 0., 32, 32, error.as_mut_ptr(), error.len())
                .pixels
                .is_null()
        );
        let count = choco_player_hit_test(
            player,
            8.,
            8.,
            std::ptr::null_mut(),
            0,
            error.as_mut_ptr(),
            error.len(),
        );
        assert!(count > 0);
        let mut hit = vec![0; count];
        assert_eq!(
            choco_player_hit_test(
                player,
                8.,
                8.,
                hit.as_mut_ptr(),
                count,
                error.as_mut_ptr(),
                error.len()
            ),
            count
        );
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&hit).unwrap(),
            json!({"id":"shape","name":"Shape"})
        );
        let mut short = [0x7f_u8; 2];
        assert_eq!(
            choco_player_hit_test(
                player,
                8.,
                8.,
                short.as_mut_ptr(),
                short.len(),
                error.as_mut_ptr(),
                error.len()
            ),
            count
        );
        assert_eq!(short, [0x7f; 2]);
        let mut miss = [0_u8; 4];
        assert_eq!(
            choco_player_hit_test(
                player,
                -1.,
                8.,
                miss.as_mut_ptr(),
                miss.len(),
                error.as_mut_ptr(),
                error.len()
            ),
            4
        );
        assert_eq!(&miss, b"null");
        assert_eq!(
            info(player)["parts"][0]["bounds"],
            json!([0., 0., 16., 16.])
        );
        assert!(choco_player_state(
            player,
            b"future".as_ptr(),
            6,
            false,
            error.as_mut_ptr(),
            error.len()
        ));
        assert!(!choco_player_settled(player));
        assert!(choco_player_seek(
            player,
            1.1,
            error.as_mut_ptr(),
            error.len()
        ));
        let moved = info(player);
        assert_eq!(moved["state"], "future");
        assert_eq!(moved["parts"][0]["bounds"], json!([16., 0., 16., 16.]));
        assert!(choco_player_settled(player));
        choco_player_destroy(player);
    }
    for field in ["opacity", "displayed", "visible"] {
        let mut hidden = value.clone();
        hidden["scene"]["root"][field] = if field == "opacity" {
            json!(0)
        } else {
            json!(false)
        };
        let bytes = archive(hidden);
        unsafe {
            let player = choco_player_create(
                bytes.as_ptr(),
                bytes.len(),
                16,
                16,
                false,
                error.as_mut_ptr(),
                error.len(),
            );
            assert!(!player.is_null(), "{}", String::from_utf8_lossy(&error));
            let count = choco_player_info(
                player,
                std::ptr::null_mut(),
                0,
                error.as_mut_ptr(),
                error.len(),
            );
            let mut bytes = vec![0; count];
            choco_player_info(
                player,
                bytes.as_mut_ptr(),
                count,
                error.as_mut_ptr(),
                error.len(),
            );
            let info: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(info["parts"], json!([]), "{field}");
            choco_player_destroy(player);
        }
    }
}

fn nested_selection_preserves_parent_spaces_order_and_visibility() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    let mut value = source("#ff0000");
    value["rig"] = json!({"width":64,"height":64,"parts":[
        {"id":"outer","parent":null,"box":[5,3,18,20]},
        {"id":"inner","parent":"outer","box":[7,7,16,16]}
    ]});
    let root = &mut value["scene"]["root"];
    let mut child = root.clone();
    root["transform"] = json!([1, 0, 0, 1, 5, 3]);
    root["bindings"] = json!(["outer"]);
    root["part"] = json!({"id":"outer","name":"Outer","background":false});
    child["transform"] = json!([1, 0, 0, 1, 2, 4]);
    child["bindings"] = json!(["inner"]);
    child["part"] = json!({"id":"inner","name":"Inner","background":false});
    root["children"] = json!([child]);
    value["scene"]["viewBox"] = json!([0, 0, 64, 64]);
    value["score"] = json!({"states":{
        "move":{"enter":{"beats":[{"do":"to","part":"outer","dur":1,"pose":{"x":10}},{"do":"to","part":"inner","at":0,"dur":1,"pose":{"y":8}}]}},
        "hide":{"enter":{"beats":[{"do":"hide","part":"outer","dur":0}]}}
    }});
    let document: Document = serde_json::from_value(value.clone()).unwrap();
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    let parts = serde_json::to_value(renderer.selection(&player).unwrap()).unwrap();
    assert_eq!(parts[0]["id"], "outer");
    assert_eq!(parts[1]["id"], "inner");
    assert_eq!(parts[1]["bounds"], json!([7., 7., 16., 16.]));
    player.set_state(Some("move"), false).unwrap();
    player.seek(1.1).unwrap();
    let parts = serde_json::to_value(renderer.selection(&player).unwrap()).unwrap();
    assert_eq!(parts[0]["bounds"], json!([15., 3., 18., 20.]));
    assert_eq!(parts[1]["bounds"], json!([17., 15., 16., 16.]));
    assert_eq!(parts[1]["transform"], json!([1., 0., 0., 1., 10., 8.]));
    player.set_state(Some("hide"), false).unwrap();
    player.advance(2.).unwrap();
    assert!(renderer.selection(&player).unwrap().is_empty());
    for visibility in ["opacity", "displayed"] {
        let mut hidden = value.clone();
        hidden["scene"]["root"][visibility] = if visibility == "opacity" {
            json!(0)
        } else {
            json!(false)
        };
        let document: Document = serde_json::from_value(hidden).unwrap();
        let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
        let renderer = Renderer::new(&document, &player, 64, 64).unwrap();
        assert!(renderer.selection(&player).unwrap().is_empty());
    }
    value["scene"]["root"]["part"]["background"] = json!(true);
    let document: Document = serde_json::from_value(value).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    let parts = serde_json::to_value(renderer.selection(&player).unwrap()).unwrap();
    assert_eq!(parts.as_array().unwrap().len(), 1);
    assert_eq!(parts[0]["id"], "inner");
}

fn painted_hits_respect_holes_masks_motion_descendants_and_effect_exclusion() {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    fn contour(points: &[[f64; 2]]) -> serde_json::Value {
        json!({"start":points[0],"closed":true,"segments":points[1..].iter().map(|point| json!({"c1":point,"c2":point,"to":point,"line":true})).collect::<Vec<_>>()})
    }
    let mut value = source("#ff0000");
    value["rig"] =
        json!({"width":64,"height":64,"parts":[{"id":"shape","parent":null,"box":[0,0,40,40]}]});
    value["scene"]["viewBox"] = json!([0, 0, 64, 64]);
    value["scene"]["root"]["bindings"] = json!(["shape"]);
    value["scene"]["root"]["part"] = json!({"id":"shape","name":"Shape","background":false});
    let outer = contour(&[[0., 0.], [40., 0.], [40., 40.], [0., 40.]]);
    let hole = contour(&[[12., 12.], [28., 12.], [28., 28.], [12., 28.]]);
    value["scene"]["root"]["shape"]["contours"] = json!([outer.clone(), hole.clone()]);
    value["scene"]["root"]["shape"]["fillRule"] = json!("evenodd");
    let document: Document = serde_json::from_value(value.clone()).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    renderer.render(&player).unwrap();
    assert_eq!(renderer.hit_test(&player, 8., 8.).unwrap().id, "shape");
    assert!(
        renderer.hit_test(&player, 20., 20.).is_none(),
        "An even-odd path hole must not select its rig rectangle"
    );
    assert!(renderer.hit_test(&player, f64::NAN, 20.).is_none());
    assert!(renderer.hit_test(&player, 64., 20.).is_none());

    // Unnamed descendants select the closest named ancestor; later painted named nodes win overlaps.
    let mut descendant = value.clone();
    let mut child = descendant["scene"]["root"].clone();
    child.as_object_mut().unwrap().remove("part");
    child["bindings"] = json!([]);
    descendant["scene"]["root"]
        .as_object_mut()
        .unwrap()
        .remove("shape");
    descendant["scene"]["root"]["children"] = json!([child]);
    let document: Document = serde_json::from_value(descendant.clone()).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    renderer.render(&player).unwrap();
    assert_eq!(renderer.hit_test(&player, 8., 8.).unwrap().id, "shape");
    let mut top = source("#ff0000")["scene"]["root"].clone();
    top["transform"] = json!([1, 0, 0, 1, 4, 4]);
    top["bindings"] = json!(["top"]);
    top["part"] = json!({"id":"top","name":"Top","background":false});
    descendant["scene"]["root"]["children"]
        .as_array_mut()
        .unwrap()
        .push(top);
    descendant["rig"]["parts"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"top","parent":"shape","box":[4,4,16,16]}));
    for hidden in [false, true] {
        let mut tree = descendant.clone();
        tree["scene"]["root"]["children"][1]["displayed"] = json!(!hidden);
        let document: Document = serde_json::from_value(tree).unwrap();
        let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
        let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
        renderer.render(&player).unwrap();
        assert_eq!(
            renderer.hit_test(&player, 8., 8.).unwrap().id,
            if hidden { "shape" } else { "top" }
        );
    }

    // Source opacity/visibility, including parent state visibility, exclude stale backend geometry.
    for field in ["opacity", "displayed", "visible"] {
        let mut hidden = value.clone();
        hidden["scene"]["root"][field] = if field == "opacity" {
            json!(0)
        } else {
            json!(false)
        };
        let document: Document = serde_json::from_value(hidden).unwrap();
        let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
        let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
        renderer.render(&player).unwrap();
        assert!(renderer.hit_test(&player, 8., 8.).is_none(), "{field}");
    }
    let mut moving = value.clone();
    moving["score"] = json!({"states":{"move":{"enter":{"beats":[{"do":"to","part":"shape","dur":1,"pose":{"x":20}}]}},"hide":{"enter":{"beats":[{"do":"hide","part":"shape","dur":0}]}}}});
    let document: Document = serde_json::from_value(moving).unwrap();
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    player.set_state(Some("move"), false).unwrap();
    player.seek(1.1).unwrap();
    renderer.render(&player).unwrap();
    assert!(renderer.hit_test(&player, 8., 8.).is_none());
    assert_eq!(renderer.hit_test(&player, 28., 8.).unwrap().id, "shape");
    assert!(
        renderer.hit_test(&player, 40., 20.).is_none(),
        "The transformed hole stays empty"
    );
    player.set_state(Some("hide"), false).unwrap();
    player.advance(2.).unwrap();
    renderer.render(&player).unwrap();
    assert!(renderer.hit_test(&player, 28., 8.).is_none());

    // Masks gate coverage, including holes and nested masks. This tests geometry, not alpha blending.
    let mut clipped = value.clone();
    clipped["scene"]["root"]["shape"]["contours"] = json!([outer.clone()]);
    let mut mask = value["scene"]["root"].clone();
    mask.as_object_mut().unwrap().remove("part");
    mask["bindings"] = json!([]);
    mask["shape"]["fill"] = json!({"kind":"color","rgba":[1,1,1,1]});
    let mut inner = mask.clone();
    inner["shape"]["contours"] = json!([contour(&[[0., 0.], [20., 0.], [20., 40.], [0., 40.]])]);
    mask["clip"] = inner;
    clipped["scene"]["root"]["clip"] = mask;
    let document: Document = serde_json::from_value(clipped).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    renderer.render(&player).unwrap();
    assert_eq!(renderer.hit_test(&player, 8., 8.).unwrap().id, "shape");
    assert!(
        renderer.hit_test(&player, 20., 20.).is_none(),
        "Mask holes stay empty"
    );
    assert!(
        renderer.hit_test(&player, 36., 8.).is_none(),
        "Nested masks gate outer-mask coverage"
    );

    // Stroke-only selection follows the retained stroked path, not an enclosing box.
    let mut stroked = value.clone();
    stroked["scene"]["root"]["shape"]["fill"] = json!({"kind":"none"});
    stroked["scene"]["root"]["shape"]["stroke"] = json!({"kind":"color","rgba":[1,0,0,1]});
    stroked["scene"]["root"]["shape"]["strokeWidth"] = json!(2);
    stroked["scene"]["root"]["shape"]["contours"] = json!([{"start":[4,4],"closed":false,"segments":[{"c1":[4,4],"c2":[28,4],"to":[28,4],"line":true}]}]);
    let document: Document = serde_json::from_value(stroked).unwrap();
    let player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    renderer.render(&player).unwrap();
    assert_eq!(renderer.hit_test(&player, 12., 4.).unwrap().id, "shape");
    assert!(renderer.hit_test(&player, 12., 12.).is_none());

    let mut flowing = value.clone();
    flowing["scene"]["root"]["shape"] = source("#ff0000")["scene"]["root"]["shape"].clone();
    flowing["rig"]["parts"][0]["box"] = json!([0, 0, 16, 16]);
    flowing["score"] = json!({"enter":{"beats":[{"do":"flow","part":"shape","points":[[48,0]],"dur":2,"count":1,"endScale":1}]}});
    let document: Document = serde_json::from_value(flowing).unwrap();
    let mut player = Player::new(document.score.clone(), &document.rig, false).unwrap();
    player.trigger("enter").unwrap();
    player.seek(1.).unwrap();
    let mut renderer = Renderer::new(&document, &player, 64, 64).unwrap();
    assert_ne!(renderer.render(&player).unwrap().pixels[8 * 64 + 32], 0);
    assert!(
        renderer.hit_test(&player, 32., 8.).is_none(),
        "Flow copies are not selectable source geometry"
    );
    assert_eq!(renderer.hit_test(&player, 8., 8.).unwrap().id, "shape");
}
