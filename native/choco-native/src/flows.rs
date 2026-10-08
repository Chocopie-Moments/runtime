//! Bounded, prebuilt copies of authored geometry. Input changes assign flights; frames only
//! sample transforms. Clones never contain bindings or recursively copy another flight.
use crate::{
    scene::{Node, Paint},
    tvg::{self, check},
};
use choco_core::{
    emitters::FlowPlayback,
    player::Player,
    pose::Point,
    program::{BeatKind, Score},
    sequence::CompiledSequence,
};
use std::{collections::BTreeMap, sync::Arc};

pub(crate) struct Flight {
    sequence: Arc<CompiledSequence>,
    start: f64,
    state: bool,
    playback: FlowPlayback,
}
pub(crate) struct Slot {
    pub paint: tvg::Raw,
    pub part: usize,
    pub pivot: Point,
    flight: Option<Flight>,
    transform: Option<[f32; 9]>,
    opacity: u8,
}
impl Slot {
    pub fn new(paint: tvg::Raw, part: usize, pivot: Point) -> Self {
        Self {
            paint,
            part,
            pivot,
            flight: None,
            transform: None,
            opacity: 0,
        }
    }
}
pub(crate) struct Flows {
    pub slots: Vec<Slot>,
    // Each anchor sits inside the target's motion wrappers, immediately after its source.
    pub anchors: Vec<(tvg::Raw, std::ops::Range<usize>)>,
    active: Vec<(Arc<CompiledSequence>, f64, bool)>,
}
impl Flows {
    pub fn new() -> Self {
        Self {
            slots: Vec::new(),
            anchors: Vec::new(),
            active: Vec::with_capacity(2),
        }
    }
    pub fn update(&mut self, player: &Player, dirty: &mut bool) -> Result<(), String> {
        let effects = || {
            player
                .effects
                .iter()
                .filter(|e| !e.sequence.flows.is_empty() && player.effect_time(e).is_some())
        };
        let same = self.active.len() == effects().count()
            && self
                .active
                .iter()
                .zip(effects())
                .all(|((sequence, start, state), e)| {
                    Arc::ptr_eq(sequence, &e.sequence) && *start == e.start && *state == e.state
                });
        if !same {
            *dirty = true;
            for slot in &mut self.slots {
                slot.flight = None;
                if slot.opacity != 0 {
                    unsafe {
                        check(tvg::tvg_paint_set_opacity(slot.paint, 0))?;
                    }
                    slot.opacity = 0;
                }
            }
            self.active.clear();
            // Insertion is source.after(holder): newest flights paint below older ones.
            // Append in reverse creation order, sharing the anchor for aliased targets.
            for (anchor, range) in &self.anchors {
                unsafe {
                    check(tvg::tvg_scene_remove(*anchor, std::ptr::null_mut()))?;
                }
                for effect in player
                    .effects
                    .iter()
                    .rev()
                    .filter(|e| !e.sequence.flows.is_empty() && player.effect_time(e).is_some())
                {
                    for spec in effect.sequence.flows.iter().rev() {
                        if !self.slots[range.clone()]
                            .iter()
                            .any(|s| s.part == spec.part)
                        {
                            continue;
                        }
                        let slot = self.slots[range.clone()]
                            .iter_mut()
                            .find(|s| s.part == spec.part && s.flight.is_none())
                            .ok_or("Flow capacity invariant failed")?;
                        slot.flight = Some(Flight {
                            sequence: effect.sequence.clone(),
                            start: effect.start,
                            state: effect.state,
                            playback: FlowPlayback::new(spec),
                        });
                        unsafe {
                            check(tvg::tvg_scene_add(*anchor, slot.paint))?;
                        }
                    }
                }
            }
            self.active
                .extend(effects().map(|e| (e.sequence.clone(), e.start, e.state)));
        }
        for slot in &mut self.slots {
            let Some(flight) = &slot.flight else { continue };
            let effect = effects()
                .find(|e| {
                    Arc::ptr_eq(&flight.sequence, &e.sequence)
                        && flight.start == e.start
                        && flight.state == e.state
                })
                .ok_or("Flow lifetime is out of sync")?;
            let pose = flight
                .playback
                .at(player.effect_time(effect).ok_or("Missing flow clock")?);
            let matrix = pose.matrix(slot.pivot);
            if !pose.finite() || matrix.iter().any(|v| !v.is_finite() || v.abs() > 1e9) {
                return Err("Flow geometry exceeds the renderer numeric budget".into());
            }
            let matrix = tvg::matrix(matrix);
            let opacity = tvg::byte(pose.o);
            if opacity != 0 && slot.transform != Some(matrix.0) {
                *dirty = true;
                unsafe {
                    check(tvg::tvg_paint_set_transform(slot.paint, &matrix))?;
                }
                slot.transform = Some(matrix.0);
            }
            if slot.opacity != opacity {
                *dirty = true;
                unsafe {
                    check(tvg::tvg_paint_set_opacity(slot.paint, opacity))?;
                }
                slot.opacity = opacity;
            }
        }
        Ok(())
    }
}

/// Reserve the maximum per target in either live group. This is deliberately conservative:
/// inactive states cannot introduce an allocation spike or evade the geometry budget.
pub(crate) fn capacities(score: &Score, root: &Node) -> Result<BTreeMap<String, usize>, String> {
    let mut groups = [
        BTreeMap::<String, usize>::new(),
        BTreeMap::<String, usize>::new(),
    ];
    let triggers = [
        score.enter.as_ref(),
        score.hover.as_ref(),
        score.click.as_ref(),
    ]
    .into_iter()
    .flatten();
    let states = score
        .states
        .iter()
        .flat_map(|s| s.values())
        .filter_map(|s| s.enter.as_ref());
    for (group, sequences) in [triggers.collect::<Vec<_>>(), states.collect::<Vec<_>>()]
        .into_iter()
        .enumerate()
    {
        for sequence in sequences {
            let mut counts = BTreeMap::<String, usize>::new();
            for beat in &sequence.beats {
                if beat.kind == BeatKind::Flow {
                    let part = beat.part.as_ref().ok_or("Flow target is missing")?.clone();
                    *counts.entry(part).or_default() += beat.count.unwrap_or(3).clamp(1, 12);
                }
            }
            for (part, count) in counts {
                groups[group]
                    .entry(part)
                    .and_modify(|n| *n = (*n).max(count))
                    .or_insert(count);
            }
        }
    }
    let [mut result, states] = groups;
    for (part, count) in states {
        *result.entry(part).or_default() += count;
    }
    if result.is_empty() {
        return Ok(result);
    }
    #[derive(Default)]
    struct Cost {
        paints: u64,
        segments: u64,
        stops: u64,
    }
    fn cost(node: &Node) -> Cost {
        let mut total = Cost {
            paints: 1,
            ..Cost::default()
        };
        if let Some(shape) = &node.shape {
            total.paints += 1;
            total.segments += shape
                .contours
                .iter()
                .map(|c| c.segments.len() + 1)
                .sum::<usize>() as u64;
            for paint in [&shape.fill, &shape.stroke] {
                if let Paint::Linear { stops, .. } | Paint::Radial { stops, .. } = paint {
                    total.stops += stops.len() as u64;
                }
            }
        }
        for child in node.children.iter().chain(node.clip.as_deref()) {
            let next = cost(child);
            total.paints += next.paints;
            total.segments += next.segments;
            total.stops += next.stops;
        }
        total
    }
    fn check_nodes(
        node: &Node,
        counts: &BTreeMap<String, usize>,
        total: &mut Cost,
    ) -> Result<(), String> {
        let count: u64 = node
            .bindings
            .iter()
            .filter_map(|id| counts.get(id))
            .map(|n| *n as u64)
            .sum();
        if count > 0 {
            let geometry = cost(node);
            total.paints += 2 + count * (geometry.paints + 1);
            total.segments += count * geometry.segments;
            total.stops += count * geometry.stops;
            if total.paints > 10_000 || total.segments > 200_000 || total.stops > 8192 {
                return Err("Flow copies exceed the retained geometry budget (10000 paints / 200000 segments / 8192 stops)".into());
            }
        }
        for child in &node.children {
            check_nodes(child, counts, total)?;
        }
        Ok(())
    }
    check_nodes(root, &result, &mut Cost::default())?;
    Ok(result)
}
