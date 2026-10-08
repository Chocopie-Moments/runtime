use choco_core::{
    pose::{IDENTITY, Pose},
    tracks::{Bridge, Track, offset},
};
use std::sync::Arc;

#[test]
fn prepared_ambient_keys_preserve_duplicate_order_and_loop_seam() {
    let behavior = serde_json::from_str(r#"{"do":"keys","part":"shape","period":3,"keys":[{"t":2,"x":50},{"t":1,"x":10},{"t":1,"x":20}]}"#).unwrap();
    let motion = choco_core::behaviors::ambient(behavior, 0, 1);
    // A missing zero key carries the final authored pose. Equal-time keys retain
    // their authored order, with the second taking over immediately after the tie.
    for t in [0., 3., 6., -3.] {
        assert!((motion(t).x - 50.).abs() < 1e-9);
    }
    assert!((motion(1.).x - 10.).abs() < 1e-9);
    assert!((motion(1.000001).x - 20.).abs() < 1e-6);
    assert!((motion(2.).x - 50.).abs() < 1e-9);
    let snapped = serde_json::from_str(r#"{"do":"keys","part":"shape","period":2.7,"keys":[{"t":0,"x":0},{"t":1.35,"x":10},{"t":2.7,"x":0}]}"#).unwrap();
    let motion = choco_core::behaviors::ambient(snapped, 0, 1);
    assert!((motion(1.5).x - 10.).abs() < 1e-9);
    assert!(motion(3.).x.abs() < 1e-9);
}

#[test]
fn opacity_interpolates_clamped_keys() {
    let track = Track::new(
        Arc::new(|t| Pose {
            o: 1.5 - 2. * t,
            ..Pose::default()
        }),
        0.,
        1.,
        1.,
        false,
        0.,
        false,
    );
    assert!((track.pose(0.25).o - 0.75).abs() < 1e-9);
}

#[test]
fn skew_bridge_begins_in_each_drawing_slots_coordinates() {
    let shown = Pose {
        r: 45.,
        sx: 2.,
        ..Pose::default()
    };
    let next = Pose {
        sy: 2.,
        ..Pose::default()
    };
    let origin = [100., 100.];
    let bridge = Bridge::new(shown.matrix(origin), next, origin, 0., 0.).unwrap();
    for pivot in [[0., 0.], [10., -30.], origin] {
        let expected = offset(shown.matrix(pivot), next, pivot);
        for (actual, expected) in bridge.matrix(0., pivot).into_iter().zip(expected) {
            assert!((actual - expected).abs() < 1e-9);
        }
        assert_eq!(bridge.matrix(0.18, pivot), IDENTITY);
    }
}

#[test]
fn skew_bridge_matches_sampled_browser_affine_interpolation() {
    let matrix = [
        2_f64.sqrt(),
        0.5_f64.sqrt(),
        -0.5_f64.sqrt(),
        0.125_f64.sqrt(),
        0.,
        0.,
    ];
    let bridge = Bridge::new(matrix, Pose::default(), [0., 0.], 0., 0.).unwrap();
    // Actual Chrome computed transform at 90ms of the browser owner's 180ms handover.
    let expected = [1.07238, 0.0636168, -0.147623, 0.945946, 0., 0.];
    for (actual, expected) in bridge.matrix(0.09, [0., 0.]).into_iter().zip(expected) {
        assert!(
            (actual - expected).abs() < 1e-5,
            "actual={actual}, expected={expected}"
        );
    }
}
