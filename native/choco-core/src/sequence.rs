use crate::{
    behaviors::{effect, entrance, whole_turns},
    ease::Ease,
    emitters::{self, Draw, Flow, Particle},
    follow,
    motion::{Motion, PoseFn},
    pose::{Point, Pose},
    program::{Beat, BeatKind as B, Follow, Sequence},
    rig::RigView,
    visibility::{self, Step},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub struct CompiledSequence {
    pub duration: f64,
    pub moved: f64,
    pub spins: BTreeSet<usize>,
    pub hold: bool,
    pub parts: Motion,
    pub bases: Motion,
    pub follow: Motion,
    pub visibility: BTreeMap<usize, Vec<Step>>,
    pub particles: Vec<Particle>,
    pub flows: Vec<Flow>,
    pub draws: Vec<Draw>,
}
impl CompiledSequence {
    pub fn hold_at(&self, seconds: f64) -> BTreeMap<usize, Pose> {
        self.bases
            .iter()
            .filter_map(|(part, f)| {
                let pose = f(seconds);
                (!pose.is_rest()).then_some((*part, pose))
            })
            .collect()
    }
}
#[derive(Clone)]
enum Segment {
    Base {
        at: f64,
        dur: f64,
        from: Pose,
        to: Pose,
        ease: Ease,
    },
    Travel {
        at: f64,
        dur: f64,
        from: Pose,
        points: Vec<Point>,
        turn: f64,
        ease: Ease,
    },
    Effect {
        beat: Box<Beat>,
        gain: f64,
    },
}
fn along(points: &[Point], e: f64) -> Point {
    if points.len() < 2 {
        return points[0];
    }
    let n = points.len() - 1;
    let f = e.clamp(0., 1.) * n as f64;
    let index = (f.floor() as usize).min(n - 1);
    let k = f - index as f64;
    let p = |j: isize| points[j.clamp(0, n as isize) as usize];
    let cr = |axis: usize| {
        let (a, b, c, d) = (
            p(index as isize - 1)[axis],
            p(index as isize)[axis],
            p(index as isize + 1)[axis],
            p(index as isize + 2)[axis],
        );
        0.5 * (2. * b
            + (-a + c) * k
            + (2. * a - 5. * b + 4. * c - d) * k * k
            + (-a + 3. * b - 3. * c + d) * k * k * k)
    };
    [cr(0), cr(1)]
}
fn evaluate(segments: Vec<Segment>, initial: Pose) -> PoseFn {
    Arc::new(move |seconds| {
        let (mut base, mut fx) = (initial, Pose::default());
        for segment in &segments {
            match segment {
                Segment::Effect { beat, gain } => {
                    if beat.duration() > 0.
                        && seconds >= beat.start()
                        && seconds <= beat.start() + beat.duration()
                    {
                        let mut pose = effect(beat, (seconds - beat.start()) / beat.duration());
                        if beat.kind == B::Spin && *gain > 0. {
                            pose.r *= whole_turns(beat.turns.unwrap_or(1.) * gain)
                                / (whole_turns(beat.turns.unwrap_or(1.)) * gain);
                        }
                        fx = fx.combine(pose);
                    }
                }
                Segment::Base {
                    at,
                    dur,
                    from,
                    to,
                    ease,
                } => {
                    if seconds < *at {
                        break;
                    }
                    let u = if *dur <= 0. {
                        1.
                    } else {
                        ((seconds - at) / dur).clamp(0., 1.)
                    };
                    base = from.mix(*to, ease.at(u));
                }
                Segment::Travel {
                    at,
                    dur,
                    from,
                    points,
                    turn,
                    ease,
                } => {
                    if seconds < *at {
                        break;
                    }
                    let u = if *dur <= 0. {
                        1.
                    } else {
                        ((seconds - at) / dur).clamp(0., 1.)
                    };
                    let point = along(points, ease.at(u));
                    base = Pose {
                        x: point[0],
                        y: point[1],
                        r: from.r + turn * (std::f64::consts::PI * u).sin(),
                        ..*from
                    };
                }
            }
        }
        base.combine(fx)
    })
}
fn part_motion(beats: &[Beat], carried: Pose, gain: f64, hold: bool) -> (PoseFn, PoseFn, f64) {
    let first = beats
        .iter()
        .find(|b| b.kind.entrance() || matches!(b.kind, B::To | B::Travel));
    let initial = first
        .filter(|b| b.kind.entrance())
        .map_or(carried, |b| Pose {
            o: 1.,
            ..entrance(b).0
        });
    let mut previous = initial;
    let mut segments = Vec::new();
    for b in beats {
        if b.kind.entrance() {
            let (pose, easing) = entrance(b);
            segments.push(Segment::Base {
                at: b.start(),
                dur: b.duration(),
                from: Pose { o: 1., ..pose },
                to: Pose::default(),
                ease: b.ease.unwrap_or(easing),
            });
            previous = Pose::default();
        } else if b.kind == B::To {
            let to = Pose {
                o: 1.,
                ..b.pose.as_ref().map_or_else(Pose::default, |p| p.pose())
            };
            segments.push(Segment::Base {
                at: b.start(),
                dur: b.duration(),
                from: previous,
                to,
                ease: b.ease.unwrap_or(Ease::Spring),
            });
            previous = to;
        } else if b.kind == B::Travel {
            let mut points = vec![[previous.x, previous.y]];
            points.extend_from_slice(b.points.as_deref().unwrap_or_default());
            let last = *points.last().unwrap();
            segments.push(Segment::Travel {
                at: b.start(),
                dur: b.duration(),
                from: previous,
                points,
                turn: b.turn.unwrap_or(0.),
                ease: b.ease.unwrap_or(Ease::InOut),
            });
            previous.x = last[0];
            previous.y = last[1];
        } else if b.kind.effect() {
            segments.push(Segment::Effect {
                beat: Box::new(b.clone()),
                gain,
            });
        }
    }
    let mut end = beats
        .iter()
        .map(|b| b.start() + b.duration())
        .fold(0., f64::max);
    if !hold && !previous.is_rest() {
        segments.push(Segment::Base {
            at: end,
            dur: 0.7,
            from: previous,
            to: Pose::default(),
            ease: Ease::Soft,
        });
        end += 0.7;
    }
    let base = evaluate(
        segments
            .iter()
            .filter(|s| !matches!(s, Segment::Effect { .. }))
            .cloned()
            .collect(),
        initial,
    );
    let motion = evaluate(segments, initial);
    let strengthened: PoseFn = Arc::new(move |t| motion(t).scale(gain, false));
    (strengthened, base, end)
}
pub fn compile(
    view: &RigView,
    sequence: Option<&Sequence>,
    hold: bool,
    follows: &[Follow],
    hide: &[usize],
    from: &BTreeMap<usize, Pose>,
) -> Result<Option<CompiledSequence>, String> {
    let beats = sequence.map_or(&[][..], |s| s.beats.as_slice());
    if beats.is_empty() && hide.is_empty() && from.is_empty() {
        return Ok(None);
    }
    let mut grouped: BTreeMap<usize, Vec<Beat>> = BTreeMap::new();
    let (mut particles, mut flows, mut draws) = (Vec::new(), Vec::new(), Vec::new());
    let mut end: f64 = 0.2;
    for b in beats {
        end = end.max(b.start() + b.duration());
        if b.kind == B::Burst {
            particles.extend(emitters::burst(view, b)?);
            continue;
        }
        let Some(name) = &b.part else { continue };
        let part = view.index(name)?;
        match b.kind {
            B::Flow => flows.extend(emitters::flows(b, part)),
            B::DrawOn | B::DrawOff => draws.push(Draw {
                part,
                delay: b.start(),
                duration: b.duration(),
                on: b.kind == B::DrawOn,
            }),
            _ => grouped.entry(part).or_default().push(b.clone()),
        }
    }
    let (mut parts, mut bases, mut visibility) =
        (BTreeMap::new(), BTreeMap::new(), BTreeMap::new());
    for (part, mut list) in grouped {
        list.sort_by(|a, b| a.start().total_cmp(&b.start()));
        let steps = visibility::steps(&list);
        if !steps.is_empty() {
            visibility.insert(part, steps);
        }
        if !list
            .iter()
            .any(|b| b.kind.entrance() || b.kind.effect() || matches!(b.kind, B::To | B::Travel))
        {
            continue;
        }
        let (function, base, moved) = part_motion(
            &list,
            from.get(&part).copied().unwrap_or_default(),
            view.parts[part].strength,
            hold,
        );
        parts.insert(part, function);
        if hold {
            bases.insert(part, base);
        }
        end = end.max(moved);
    }
    for (part, pose) in from {
        if !parts.contains_key(part) && !pose.is_rest() {
            let pose = *pose;
            let home: PoseFn = Arc::new(move |t| {
                pose.mix(Pose::default(), Ease::Soft.at((t / 0.6).clamp(0., 1.)))
            });
            let gain = view.parts[*part].strength;
            let cloned = home.clone();
            let strengthened: PoseFn = Arc::new(move |t| cloned(t).scale(gain, false));
            parts.insert(*part, strengthened);
            if hold {
                bases.insert(*part, home);
            }
            end = end.max(0.6);
        }
    }
    for part in hide {
        visibility
            .entry(*part)
            .or_insert_with(|| vec![visibility::hide()]);
    }
    for p in &particles {
        end = end.max(p.delay + p.duration);
    }
    for f in &flows {
        end = end.max(f.delay + f.duration);
    }
    let follow = follow::solve(view, follows, &parts, end, false)?;
    let spins = beats
        .iter()
        .filter(|b| b.kind == B::Spin)
        .filter_map(|b| b.part.as_ref())
        .filter_map(|p| view.index(p).ok())
        .filter(|p| parts.contains_key(p))
        .collect();
    Ok(Some(CompiledSequence {
        duration: end + if follow.is_empty() { 0. } else { 1.6 },
        moved: end,
        spins,
        hold,
        parts,
        bases,
        follow,
        visibility,
        particles,
        flows,
        draws,
    }))
}
