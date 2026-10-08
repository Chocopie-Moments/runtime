//! Numeric and resource contract checked before compiling any motion or spring trajectory.
use crate::{program::*, rig::RigView};
use std::collections::BTreeSet;
fn range(value: f64, min: f64, max: f64) -> Result<(), String> {
    if value.is_finite() && value >= min && value <= max {
        Ok(())
    } else {
        Err(format!("Motion value outside [{min}, {max}]"))
    }
}
fn optional(value: Option<f64>, min: f64, max: f64) -> Result<(), String> {
    value.map_or(Ok(()), |v| range(v, min, max))
}
// Match the authoring contract's ECMAScript trim set, not Rust's Unicode White_Space
// property (which additionally includes U+0085 and excludes U+FEFF).
fn name_whitespace(value: char) -> bool {
    matches!(value,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
}
pub fn identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.as_bytes()[0].is_ascii_alphabetic()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn limit(length: usize, max: usize) -> Result<(), String> {
    if length <= max {
        Ok(())
    } else {
        Err(format!("Motion collection exceeds {max}"))
    }
}
fn point(value: &[f64; 2]) -> Result<(), String> {
    for v in value {
        range(*v, -4096., 4096.)?;
    }
    Ok(())
}
fn pose(value: &PoseInput) -> Result<(), String> {
    for v in [value.x, value.y, value.rotate] {
        optional(v, -4096., 4096.)?;
    }
    for v in [value.scale, value.scale_x, value.scale_y] {
        optional(v, 0.01, 4.)?;
    }
    optional(value.opacity, 0., 1.)
}
fn target(view: &RigView, id: &str) -> Result<(), String> {
    if !identifier(id, 80) {
        return Err("Invalid motion target identifier".into());
    }
    view.index(id).map(|_| ())
}
fn ambient(values: &[Ambient], max: usize, view: &RigView) -> Result<(), String> {
    limit(values.len(), max)?;
    for value in values {
        target(view, &value.part)?;
        if value.period.is_some_and(|v| v <= 0.) {
            return Err("Ambient period must be positive".into());
        }
        optional(value.period, 0., 60.)?;
        optional(value.phase, -10., 10.)?;
        for v in [value.x, value.y, value.deg, value.dx, value.dy] {
            optional(v, -4096., 4096.)?;
        }
        for v in [value.amount, value.stagger] {
            optional(v, 0., 10.)?;
        }
        for v in [value.fade, value.dim] {
            optional(v, 0., 1.)?;
        }
        optional(value.min, 0., 4.)?;
        let keys = value.keys.as_deref().unwrap_or_default();
        limit(keys.len(), 16)?;
        for key in keys {
            range(key.t, 0., 12.)?;
            pose(&key.pose)?;
        }
    }
    Ok(())
}
fn sequence(sequence: Option<&Sequence>, view: &RigView) -> Result<(), String> {
    let Some(sequence) = sequence else {
        return Ok(());
    };
    limit(sequence.beats.len(), 16)?;
    for value in &sequence.beats {
        if let Some(part) = &value.part {
            target(view, part)?;
        }
        optional(value.at, 0., 20.)?;
        optional(value.dur, 0., 10.)?;
        for v in [
            value.height,
            value.deg,
            value.px,
            value.y,
            value.turn,
            value.distance,
            value.angle,
            value.gravity,
        ] {
            optional(v, -4096., 4096.)?;
        }
        optional(value.times, 0., 20.)?;
        optional(value.amount, 0., 10.)?;
        optional(value.squash, 0., 1.)?;
        optional(value.turns, -10., 10.)?;
        optional(value.spread, 0., 360.)?;
        optional(value.size, 0., 200.)?;
        optional(value.stagger, 0., 5.)?;
        optional(value.end_scale, 0., 4.)?;
        if value.count.is_some_and(|v| v > 64) || value.seed.is_some_and(|v| v > 1_000_000) {
            return Err("Effect count or seed exceeds limit".into());
        }
        if let Some(from) = &value.from {
            point(from)?;
        }
        if let Some(p) = &value.pose {
            pose(p)?;
        }
        let points = value.points.as_deref().unwrap_or_default();
        limit(points.len(), 8)?;
        for p in points {
            point(p)?;
        }
        let colors = value.colors.as_deref().unwrap_or_default();
        limit(colors.len(), 6)?;
        for color in colors {
            if !["accent", "secondary", "ink", "background"].contains(&color.as_str())
                && !hex_color(color)
            {
                return Err("Invalid particle color".into());
            }
        }
        let shapes = value.shapes.as_deref().unwrap_or_default();
        limit(shapes.len(), 3)?;
        for shape in shapes {
            if !["circle", "rect", "star"].contains(&shape.as_str()) {
                return Err("Invalid particle shape".into());
            }
        }
    }
    Ok(())
}
pub fn hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

pub fn validate(score: &Score, rig: &Rig) -> Result<(), String> {
    range(rig.width, f64::from_bits(1), 1_000_000.)?;
    range(rig.height, f64::from_bits(1), 1_000_000.)?;
    limit(rig.parts.len(), 100)?;
    let mut count = rig.parts.len();
    let mut ids = BTreeSet::new();
    for part in &rig.parts {
        if !identifier(&part.id, 80)
            || !ids.insert(&part.id)
            || part
                .name
                .as_ref()
                .is_some_and(|v| v.encode_utf16().count() > 100)
        {
            return Err("Invalid rig part".into());
        }
        let children = part.children.as_deref().unwrap_or_default();
        limit(children.len(), 1800)?;
        count += children.len();
        limit(count, 2048)?;
        for bounds in std::iter::once(&part.r#box).chain(children) {
            for value in &bounds[..2] {
                range(*value, -1_000_000., 1_000_000.)?;
            }
            for value in &bounds[2..] {
                range(*value, 0., 1_000_000.)?;
            }
        }
    }
    for part in &rig.parts {
        if part
            .parent
            .as_ref()
            .is_some_and(|parent| !ids.contains(parent))
        {
            return Err("Unknown rig parent".into());
        }
    }
    optional(score.liveliness, 0., 1.5)?;
    optional(score.speed, 0.5, 2.)?;
    // Both drawn and attached graphs are validated by this owner, including cycles.
    let view = RigView::new(score, rig)?;
    if let Some(pivots) = &score.pivots {
        limit(pivots.len(), count)?;
        for (id, p) in pivots {
            target(&view, id)?;
            point(p)?;
        }
    }
    if let Some(attach) = &score.attach {
        limit(attach.len(), count)?;
        for (id, parent) in attach {
            target(&view, id)?;
            target(&view, parent)?;
        }
    }
    if let Some(gains) = &score.part_gain {
        limit(gains.len(), count)?;
        for (id, gain) in gains {
            target(&view, id)?;
            range(*gain, 0., 2.)?;
        }
    }
    if let Some(hidden) = &score.hidden {
        limit(hidden.len(), 32)?;
        for id in hidden {
            target(&view, id)?;
        }
    }
    ambient(score.ambient.as_deref().unwrap_or_default(), 16, &view)?;
    let follows = score.follow.as_deref().unwrap_or_default();
    limit(follows.len(), 8)?;
    for f in follows {
        target(&view, &f.part)?;
        optional(f.period, 0.2, 10.)?;
        optional(f.damping, 0., 5.)?;
        optional(f.gain, 0., 10.)?;
        optional(f.drag, 0., 20.)?;
        optional(f.amount, 0., 50.)?;
        optional(f.max, 0., 90.)?;
        optional(f.gain_x, -1., 1.)?;
        optional(f.gain_y, -1., 1.)?;
    }
    for s in [
        score.enter.as_ref(),
        score.hover.as_ref(),
        score.click.as_ref(),
    ] {
        sequence(s, &view)?;
    }
    if let Some(look) = &score.look {
        if look.parts.is_empty() {
            return Err("Gaze requires a part".into());
        }
        limit(look.parts.len(), 4)?;
        for id in &look.parts {
            target(&view, id)?;
        }
        optional(look.range, 0., 40.)?;
    }
    if let Some(states) = &score.states {
        limit(
            states.len()
                + 1
                + [
                    score.enter.as_ref(),
                    score.hover.as_ref(),
                    score.click.as_ref(),
                ]
                .iter()
                .filter(|s| s.is_some_and(|s| !s.beats.is_empty()))
                .count(),
            256,
        )?;
        for (id, state) in states {
            if !identifier(id, 80) || ["idle", "enter", "hover", "click"].contains(&id.as_str()) {
                return Err("Invalid or reserved state identifier".into());
            }
            if state.name.as_ref().is_some_and(|name| {
                name.chars().all(name_whitespace) || name.encode_utf16().count() > 60
            }) {
                return Err("Invalid state name".into());
            }
            ambient(state.ambient.as_deref().unwrap_or_default(), 8, &view)?;
            sequence(state.enter.as_ref(), &view)?;
        }
    }
    if score.initial_state.as_ref().is_some_and(|id| {
        !score
            .states
            .as_ref()
            .is_some_and(|states| states.contains_key(id))
    }) {
        return Err("Unknown initial state".into());
    }
    Ok(())
}
