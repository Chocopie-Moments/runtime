use choco_core::{
    player::Player,
    program::{Rig, Score},
};

fn player() -> Player {
    let rig: Rig = serde_json::from_str(
        r#"{"width":100,"height":100,"parts":[{"id":"eye","parent":null,"box":[40,40,20,20]}]}"#,
    )
    .unwrap();
    let score: Score = serde_json::from_str(r#"{"look":{"parts":["eye"],"range":4}}"#).unwrap();
    Player::new(score, &rig, false).unwrap()
}
fn x(player: &Player) -> f64 {
    player.matrix(0, |_| [50., 50.])[4]
}

#[test]
fn gaze_leaving_and_reentering_carries_the_displayed_offset() {
    let mut p = player();
    p.look(Some([250., 50.])).unwrap();
    p.advance(0.16).unwrap();
    assert!((x(&p) - 4.).abs() < 1e-6);
    p.look(None).unwrap();
    assert!((x(&p) - 4.).abs() < 1e-6);
    p.advance(0.04).unwrap();
    let returning = x(&p);
    assert!(returning > 0. && returning < 4.);
    p.look(Some([-150., 50.])).unwrap();
    assert!((x(&p) - returning).abs() < 1e-6);
    p.advance(0.16).unwrap();
    assert!((x(&p) + 4.).abs() < 1e-6);
    p.look(None).unwrap();
    p.advance(0.16).unwrap();
    assert!(x(&p).abs() < 1e-6);
}

#[test]
fn pause_preserves_clock_and_clock_overflow_is_rejected() {
    let mut p = player();
    p.advance(0.1).unwrap();
    p.set_paused(true);
    p.advance(120.).unwrap();
    assert_eq!(p.time(), 0.1);
    p.set_paused(false);
    p.seek(f64::MAX).unwrap();
    assert!(p.advance(f64::MAX).is_err());
    assert_eq!(p.time(), f64::MAX);
}

#[test]
fn reduced_motion_settles_primary_motion_without_secondary_follow() {
    let rig: Rig = serde_json::from_str(r#"{"width":100,"height":100,"parts":[{"id":"carrier","parent":null,"box":[0,0,20,20]},{"id":"child","box":[0,0,20,20],"parent":"carrier"}]}"#).unwrap();
    let score: Score = serde_json::from_str(r#"{"follow":[{"part":"child","mode":"lean","period":2,"damping":0,"amount":10}],"click":{"beats":[{"do":"to","part":"carrier","dur":0.8,"pose":{"x":100}}]}}"#).unwrap();
    let mut p = Player::new(score, &rig, true).unwrap();
    p.trigger("click").unwrap();
    assert_eq!(p.matrix(1, |_| [10., 10.]), choco_core::pose::IDENTITY);
}

#[test]
fn draw_offsets_follow_delay_speed_zero_duration_and_creation_order() {
    let rig: Rig = serde_json::from_str(
        r#"{"width":100,"height":100,"parts":[{"id":"line","parent":null,"box":[0,0,80,10]}]}"#,
    )
    .unwrap();
    let score: Score = serde_json::from_str(r#"{"speed":2,"click":{"beats":[{"do":"drawOff","part":"line","at":0.2,"dur":0}]},"states":{"show":{"enter":{"beats":[{"do":"drawOn","part":"line","at":0.2,"dur":1}]}},"empty":{}}}"#).unwrap();
    let mut p = Player::new(score.clone(), &rig, false).unwrap();
    assert_eq!(p.draw_offsets().count(), 0);
    p.set_state(Some("show"), false).unwrap();
    assert_eq!(p.draw_offsets().collect::<Vec<_>>(), [(0, 1.)]);
    p.seek(0.35).unwrap();
    assert!((p.draw_offsets().next().unwrap().1 - 0.5).abs() < 1e-6);
    p.trigger("click").unwrap();
    assert_eq!(p.draw_offsets().last().unwrap(), (0, 0.));
    p.seek(0.451).unwrap();
    assert_eq!(p.draw_offsets().last().unwrap(), (0, 1.));
    p.set_state(Some("empty"), false).unwrap();
    assert_eq!(p.draw_offsets().collect::<Vec<_>>(), [(0, 1.)]);
    p.set_state(Some("show"), false).unwrap();
    p.seek(1.06).unwrap();
    assert_eq!(p.draw_offsets().collect::<Vec<_>>(), [(0, 1.), (0, 0.)]);
    let mut reduced = Player::new(score, &rig, true).unwrap();
    reduced.set_state(Some("show"), false).unwrap();
    reduced.trigger("click").unwrap();
    assert_eq!(reduced.draw_offsets().count(), 0);
}

#[test]
fn scheduling_stops_after_flights_and_wakes_for_inputs() {
    let rig: Rig = serde_json::from_str(
        r#"{"width":100,"height":100,"parts":[{"id":"piece","parent":null,"box":[0,0,16,16]}]}"#,
    )
    .unwrap();
    let score: Score = serde_json::from_str(r#"{"speed":2,"click":{"beats":[{"do":"flow","part":"piece","at":0.2,"dur":1,"count":2,"stagger":0.3,"points":[[40,0]]}]},"states":{"move":{"enter":{"beats":[{"do":"to","part":"piece","dur":1,"pose":{"x":20}}]}},"rest":{}}}"#).unwrap();
    let mut player = Player::new(score, &rig, false).unwrap();
    assert!(!player.needs_frame());
    player.trigger("click").unwrap();
    assert!(player.needs_frame());
    player.seek(0.74).unwrap();
    assert!(player.needs_frame());
    player.seek(0.75).unwrap();
    assert!(!player.needs_frame());
    player.set_state(Some("move"), false).unwrap();
    assert!(player.needs_frame());
    player.set_paused(true);
    assert!(!player.needs_frame());
    player.set_paused(false);
    player.set_reduced_motion(true);
    assert!(!player.needs_frame());
    player.set_reduced_motion(false);
    assert!(player.needs_frame());
    player.seek(2.).unwrap();
    assert!(!player.needs_frame());
    player.set_state(Some("rest"), false).unwrap();
    assert!(player.needs_frame());
    player.advance(3.).unwrap();
    assert!(!player.needs_frame());
}

#[test]
fn finite_completion_excludes_ambient_and_survives_pause_seek_and_reduced_motion() {
    let rig: Rig = serde_json::from_str(
        r#"{"width":100,"height":100,"parts":[{"id":"eye","parent":null,"box":[40,40,20,20]}]}"#,
    )
    .unwrap();
    let score: Score = serde_json::from_str(r#"{"ambient":[{"part":"eye","do":"bob","period":2,"amount":3}],"click":{"beats":[{"do":"to","part":"eye","dur":1,"pose":{"x":10}}]}}"#).unwrap();
    let mut p = Player::new(score, &rig, false).unwrap();
    assert!(p.needs_frame());
    assert!(p.is_settled());
    p.trigger("click").unwrap();
    assert!(!p.is_settled());
    p.advance(0.5).unwrap();
    p.set_paused(true);
    assert!(!p.needs_frame());
    assert!(!p.is_settled());
    p.advance(100.).unwrap();
    assert!(!p.is_settled());
    p.seek(3.).unwrap();
    assert!(p.is_settled());
    p.set_paused(false);
    assert!(p.needs_frame());
    p.seek(0.1).unwrap();
    assert!(!p.is_settled());
    p.set_reduced_motion(true);
    assert!(p.is_settled());
}
