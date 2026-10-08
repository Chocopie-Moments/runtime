//! A deterministic player clock, ordered state inputs, and renderer-independent frame evaluation.
use crate::{
    motion::Motion,
    pose::{IDENTITY, LOOP_WINDOW, Matrix, Point, Pose, multiply},
    program::{Rig, Score},
    score::CompiledScore,
    sequence::CompiledSequence,
    tracks::{self, Bridge, Track},
    visibility::{self, Step},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
const AMBIENT: usize = 0;
const STATE_AMBIENT: usize = 1;
const STATE: usize = 2;
const SEQUENCE: usize = 3;
const FOLLOW: usize = 4;
const STATE_FOLLOW: usize = 5;
const SEQUENCE_FOLLOW: usize = 6;
const LAYERS: usize = 7;
#[derive(Clone)]
struct Visibility {
    steps: Vec<Step>,
    baseline: f64,
    start: f64,
    duration: f64,
}
struct Entered {
    sequence: Arc<CompiledSequence>,
    from: BTreeMap<usize, Pose>,
    start: f64,
}
pub struct ActiveEffects {
    pub sequence: Arc<CompiledSequence>,
    pub start: f64,
    pub state: bool,
}
pub struct Player {
    pub compiled: CompiledScore,
    tracks: Vec<[Option<Track>; LAYERS]>,
    bridges: Vec<[Option<Bridge>; LAYERS]>,
    visibility: Vec<Visibility>,
    pub effects: Vec<ActiveEffects>,
    entered: Option<Entered>,
    active_state: Option<String>,
    now: f64,
    paused: bool,
    reduced_motion: bool,
    look: Option<(Option<Point>, f64, Vec<Point>)>,
}
impl Player {
    pub fn new(score: Score, rig: &Rig, reduced_motion: bool) -> Result<Self, String> {
        let compiled = CompiledScore::new(score, rig)?;
        let count = compiled.view.parts.len();
        let visibility = compiled
            .view
            .parts
            .iter()
            .map(|part| Visibility {
                steps: Vec::new(),
                baseline: if part.hidden { 0. } else { 1. },
                start: 0.,
                duration: 0.,
            })
            .collect();
        let mut player = Self {
            compiled,
            tracks: vec![std::array::from_fn(|_| None); count],
            bridges: vec![std::array::from_fn(|_| None); count],
            visibility,
            effects: Vec::new(),
            entered: None,
            active_state: None,
            now: 0.,
            paused: false,
            reduced_motion,
            look: None,
        };
        let ambient = player.compiled.ambient.clone();
        let follow = player.compiled.ambient_follow.clone();
        player.loop_layer(&ambient, AMBIENT, 0., &BTreeMap::new());
        player.loop_layer(&follow, FOLLOW, 0., &BTreeMap::new());
        if let Some(initial) = player.compiled.score.initial_state.clone() {
            player.set_state(Some(&initial), false)?;
        }
        Ok(player)
    }
    pub fn time(&self) -> f64 {
        self.now
    }
    pub fn state(&self) -> Option<&str> {
        self.active_state.as_deref()
    }
    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }
    pub fn set_reduced_motion(&mut self, reduced: bool) {
        self.reduced_motion = reduced;
    }
    /// Scheduling hint for hosts. Inputs and resizes still request one presentation even when
    /// this is false. A held pose never requires a display link to keep showing its pixels.
    pub fn needs_frame(&self) -> bool {
        if self.paused || self.reduced_motion {
            return false;
        }
        self.pending_motion(true)
    }
    /// Whether finite motion has completed. Ambient loops do not delay host actions.
    /// Pausing preserves this flag; reduced motion is already settled.
    pub fn is_settled(&self) -> bool {
        self.reduced_motion || !self.pending_motion(false)
    }
    fn pending_motion(&self, include_loops: bool) -> bool {
        self.tracks
            .iter()
            .flatten()
            .flatten()
            .any(|track| (include_loops || !track.looping) && track.needs_frame(self.now))
            || self
                .bridges
                .iter()
                .flatten()
                .flatten()
                .any(|bridge| match bridge {
                    Bridge::Pose {
                        start, duration, ..
                    } => self.now < start + duration,
                    Bridge::Skew { start, .. } => self.now < start + 0.18,
                })
            || self.visibility.iter().any(|v| {
                !v.steps.is_empty() && (self.now - v.start).max(0.) * self.speed() < v.duration
            })
            || self.effects.iter().any(|effect| {
                let time = (self.now - effect.start).max(0.) * self.speed();
                effect
                    .sequence
                    .flows
                    .iter()
                    .any(|f| time < f.delay + f.duration)
                    || effect
                        .sequence
                        .particles
                        .iter()
                        .any(|p| time < p.delay + p.duration)
                    || effect
                        .sequence
                        .draws
                        .iter()
                        .any(|d| time < d.delay + d.duration)
            })
            || (self.compiled.score.look.is_some()
                && self
                    .look
                    .as_ref()
                    .is_some_and(|(_, start, _)| self.now < start + 0.16))
    }
    pub fn advance(&mut self, seconds: f64) -> Result<(), String> {
        if !seconds.is_finite() || seconds < 0. {
            return Err("Clock delta must be finite and nonnegative".into());
        }
        if !self.paused {
            let next = self.now + seconds;
            if !next.is_finite() {
                return Err("Player clock overflow".into());
            }
            self.now = next;
        }
        Ok(())
    }
    pub fn seek(&mut self, seconds: f64) -> Result<(), String> {
        if !seconds.is_finite() || seconds < 0. {
            return Err("Seek time must be finite and nonnegative".into());
        }
        self.now = seconds;
        Ok(())
    }
    fn speed(&self) -> f64 {
        self.compiled.score.speed.unwrap_or(1.)
    }
    fn loop_layer(
        &mut self,
        motion: &Motion,
        layer: usize,
        delay: f64,
        turning: &BTreeMap<usize, f64>,
    ) {
        for (part, function) in motion {
            let delay = turning
                .get(part)
                .map_or(delay, |angle| -tracks::phase_at(function, *angle));
            self.tracks[*part][layer] = Some(Track::new(
                function.clone(),
                self.now,
                LOOP_WINDOW,
                self.speed(),
                true,
                delay,
                false,
            ));
        }
    }
    fn play_sequence(&mut self, sequence: Arc<CompiledSequence>, state: bool) {
        let (parts, follow) = if state {
            (STATE, STATE_FOLLOW)
        } else {
            (SEQUENCE, SEQUENCE_FOLLOW)
        };
        for (part, function) in &sequence.parts {
            self.tracks[*part][parts] = Some(Track::new(
                function.clone(),
                self.now,
                sequence.duration,
                self.speed(),
                false,
                0.,
                sequence.spins.contains(part),
            ));
        }
        for (part, function) in &sequence.follow {
            self.tracks[*part][follow] = Some(Track::new(
                function.clone(),
                self.now,
                sequence.duration,
                self.speed(),
                false,
                0.,
                false,
            ));
        }
        for (part, steps) in &sequence.visibility {
            let baseline = self.visible(*part);
            self.visibility[*part] = Visibility {
                steps: steps.clone(),
                baseline,
                start: self.now,
                duration: sequence.duration,
            };
        }
        self.effects.push(ActiveEffects {
            sequence,
            start: self.now,
            state,
        });
    }
    fn layer_matrix(&self, part: usize, layer: usize, pivot: Point) -> Matrix {
        if self.reduced_motion && matches!(layer, FOLLOW | STATE_FOLLOW | SEQUENCE_FOLLOW) {
            return IDENTITY;
        }
        let mut matrix = IDENTITY;
        if let Some(track) = &self.tracks[part][layer]
            && (!self.reduced_motion || !track.looping)
        {
            let pose = if self.reduced_motion {
                (track.function)(track.duration)
            } else {
                track.pose(self.now)
            };
            matrix = pose.matrix(pivot);
        }
        if !self.reduced_motion
            && let Some(bridge) = &self.bridges[part][layer]
        {
            matrix = multiply(matrix, bridge.matrix(self.now, pivot));
        }
        matrix
    }
    fn handover(
        &mut self,
        layer: usize,
        starts: &BTreeMap<usize, Pose>,
        keep: &BTreeSet<usize>,
    ) -> BTreeMap<usize, f64> {
        let mut turning = BTreeMap::new();
        for part in 0..self.tracks.len() {
            if self.tracks[part][layer].is_none() && self.bridges[part][layer].is_none() {
                continue;
            }
            let pivot = self.compiled.view.parts[part].pivot;
            let shown = self.layer_matrix(part, layer, pivot);
            let speed = self.tracks[part][layer]
                .as_ref()
                .map_or(0., |t| t.turn_speed(self.now))
                + self.bridges[part][layer]
                    .as_ref()
                    .map_or(0., |b| b.turn_speed(self.now));
            let next = starts.get(&part).copied().unwrap_or_default();
            self.bridges[part][layer] = None;
            if !self.reduced_motion {
                if keep.contains(&part) && speed.abs() >= 45. {
                    turning.insert(
                        part,
                        tracks::from_matrix(tracks::offset(shown, next, pivot), pivot).r,
                    );
                } else {
                    self.bridges[part][layer] = Bridge::new(shown, next, pivot, speed, self.now);
                }
            }
            self.tracks[part][layer] = None;
        }
        turning
    }
    pub fn set_state(&mut self, name: Option<&str>, restart: bool) -> Result<(), String> {
        if self.active_state.as_deref() == name && !restart {
            return Ok(());
        }
        let from = if name.is_some() && self.active_state.as_deref() == name {
            self.entered
                .as_ref()
                .map(|e| e.from.clone())
                .unwrap_or_default()
        } else {
            self.entered
                .as_ref()
                .map(|e| {
                    e.sequence
                        .hold_at(if e.sequence.parts.is_empty() || self.reduced_motion {
                            f64::INFINITY
                        } else {
                            (self.now - e.start).max(0.) * self.speed()
                        })
                })
                .unwrap_or_default()
        };
        let next = name
            .map(|name| self.compiled.state(name, &from))
            .transpose()?;
        let starts = if next.is_some() {
            from.iter()
                .map(|(part, pose)| {
                    (
                        *part,
                        pose.scale(self.compiled.view.parts[*part].strength, false),
                    )
                })
                .collect()
        } else {
            BTreeMap::new()
        };
        let spinning = next
            .as_ref()
            .map(|s| {
                s.ambient
                    .iter()
                    .filter_map(|(part, f)| {
                        Track::new(
                            f.clone(),
                            self.now,
                            LOOP_WINDOW,
                            self.speed(),
                            true,
                            0.,
                            false,
                        )
                        .turns
                        .then_some(*part)
                    })
                    .collect()
            })
            .unwrap_or_default();
        self.handover(STATE, &starts, &BTreeSet::new());
        let turning = self.handover(STATE_AMBIENT, &BTreeMap::new(), &spinning);
        self.handover(STATE_FOLLOW, &BTreeMap::new(), &BTreeSet::new());
        self.effects.retain(|e| !e.state);
        self.entered = None;
        self.active_state = name.map(str::to_owned);
        if let Some(state) = next {
            let delay = state.enter.as_ref().map_or(0., |s| s.moved);
            if let Some(sequence) = state.enter {
                let sequence = Arc::new(sequence);
                self.play_sequence(sequence.clone(), true);
                self.entered = Some(Entered {
                    sequence,
                    from,
                    start: self.now,
                });
            }
            self.loop_layer(&state.ambient, STATE_AMBIENT, delay, &turning);
        }
        Ok(())
    }
    pub fn trigger(&mut self, name: &str) -> Result<(), String> {
        let sequence = self
            .compiled
            .triggers
            .get(name)
            .ok_or_else(|| format!("Unknown trigger: {name}"))?
            .clone();
        let Some(sequence) = sequence else {
            return Ok(());
        };
        for part in &mut self.tracks {
            part[SEQUENCE] = None;
            part[SEQUENCE_FOLLOW] = None;
        }
        self.effects.retain(|e| e.state);
        self.play_sequence(sequence, false);
        Ok(())
    }
    pub fn visible(&self, part: usize) -> f64 {
        let v = &self.visibility[part];
        if self.reduced_motion {
            return visibility::at(&v.steps, v.baseline, f64::INFINITY);
        }
        let t = (self.now - v.start).max(0.) * self.speed();
        if v.duration <= 0. || t >= v.duration {
            return visibility::at(&v.steps, v.baseline, t);
        }
        let n = (v.duration * 30.).ceil().max(2.);
        let position = t / v.duration * n;
        let k = position.floor();
        let a = visibility::at(&v.steps, v.baseline, k / n * v.duration);
        let b = visibility::at(&v.steps, v.baseline, (k + 1.) / n * v.duration);
        a + (b - a) * (position - k)
    }
    pub fn look(&mut self, point: Option<Point>) -> Result<(), String> {
        if point.is_some_and(|p| p.iter().any(|v| !v.is_finite())) {
            return Err("Look coordinates must be finite".into());
        }
        self.look = Some((
            point,
            self.now,
            (0..self.tracks.len())
                .map(|part| self.look_offset(part))
                .collect(),
        ));
        Ok(())
    }
    fn look_offset(&self, part: usize) -> Point {
        if self.reduced_motion {
            return [0., 0.];
        }
        let Some(config) = &self.compiled.score.look else {
            return [0., 0.];
        };
        if !config.parts.contains(&self.compiled.view.parts[part].id) {
            return [0., 0.];
        }
        let Some((point, start, from)) = &self.look else {
            return [0., 0.];
        };
        let target = point.map_or([0., 0.], |point| {
            let center = self.compiled.view.center(part);
            let (dx, dy) = (point[0] - center[0], point[1] - center[1]);
            let divisor = dx.hypot(dy).max(f64::MIN_POSITIVE);
            let reach = config.range.unwrap_or(4.) * (divisor / 200.).min(1.);
            [dx / divisor * reach, dy / divisor * reach]
        });
        let u = crate::ease::bezier(
            ((self.now - start) / 0.16).clamp(0., 1.),
            [0.23, 1., 0.32, 1.],
        );
        [
            from[part][0] + (target[0] - from[part][0]) * u,
            from[part][1] + (target[1] - from[part][1]) * u,
        ]
    }
    /// Local animation transform. The adapter supplies each pivot in this drawing node's space.
    pub fn matrix(&self, part: usize, pivot: impl Fn(usize) -> Point) -> Matrix {
        let mut m = IDENTITY;
        for carrier in &self.compiled.view.parts[part].carried {
            for layer in 0..LAYERS {
                m = multiply(m, self.layer_matrix(*carrier, layer, pivot(*carrier)));
            }
        }
        for layer in 0..LAYERS {
            m = multiply(m, self.layer_matrix(part, layer, pivot(part)));
        }
        let look = self.look_offset(part);
        multiply(m, [1., 0., 0., 1., look[0], look[1]])
    }
    pub fn opacity(&self, part: usize) -> f64 {
        let mut opacity = self.visible(part);
        for carrier in &self.compiled.view.parts[part].carried {
            opacity *= self.visible(*carrier);
        }
        if !self.reduced_motion {
            for track in self.tracks[part].iter().flatten() {
                if track.opacity {
                    opacity *= track.pose(self.now).o.clamp(0., 1.);
                }
            }
        }
        opacity
    }
    /// Stroke dash offsets in animation creation order. Later entries replace earlier ones,
    /// including during their delay (backwards fill). The renderer resolves ancestor targets.
    pub fn draw_offsets(&self) -> impl Iterator<Item = (usize, f64)> + '_ {
        self.effects.iter().flat_map(|effect| {
            let time = self.effect_time(effect);
            effect.sequence.draws.iter().filter_map(move |draw| {
                let time = time?;
                let progress = if draw.duration <= 0. {
                    if time < draw.delay { 0. } else { 1. }
                } else {
                    ((time - draw.delay) / draw.duration).clamp(0., 1.)
                };
                let eased = crate::ease::bezier(progress, [0.65, 0., 0.35, 1.]);
                Some((draw.part, if draw.on { 1. - eased } else { eased }))
            })
        })
    }
    pub fn effect_time(&self, effect: &ActiveEffects) -> Option<f64> {
        if self.reduced_motion {
            None
        } else {
            Some((self.now - effect.start).max(0.) * self.speed())
        }
    }
}
