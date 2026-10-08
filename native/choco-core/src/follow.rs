use crate::{
    behaviors::round,
    motion::{Motion, PoseFn},
    pose::{IDENTITY, Matrix, Pose, apply, multiply},
    program::{Follow, FollowMode},
    rig::RigView,
};
use std::{
    collections::BTreeMap,
    f64::consts::{PI, TAU},
    sync::Arc,
};
const DT: f64 = 1. / 240.;
struct Run {
    duration: f64,
    looping: bool,
    steps: usize,
    laps: usize,
}
impl Run {
    fn time(&self, i: usize) -> f64 {
        if self.looping {
            (i as f64 * DT) % self.duration
        } else {
            i as f64 * DT
        }
    }
}
fn world(view: &RigView, part: usize, primary: &Motion, solved: &Motion) -> impl Fn(f64) -> Matrix {
    let links: Vec<_> = view.parts[part]
        .chain
        .iter()
        .chain(std::iter::once(&part))
        .filter_map(|index| {
            let (a, b) = (primary.get(index).cloned(), solved.get(index).cloned());
            if a.is_none() && b.is_none() {
                None
            } else {
                Some((a, b, view.parts[*index].pivot))
            }
        })
        .collect();
    move |t| {
        links.iter().fold(IDENTITY, |m, (a, b, pivot)| {
            let pose = a
                .as_ref()
                .map_or_else(Pose::default, |f| f(t))
                .combine(b.as_ref().map_or_else(Pose::default, |f| f(t)));
            multiply(m, pose.matrix(*pivot))
        })
    }
}
fn spring(f: &Follow, period: f64, damping: f64) -> (f64, f64) {
    let w = TAU / f.period.unwrap_or(period);
    (w * w, 2. * f.damping.unwrap_or(damping) * w)
}
fn pendulum(
    view: &RigView,
    part: usize,
    f: &Follow,
    primary: &Motion,
    solved: &Motion,
    run: &Run,
) -> Option<Vec<f64>> {
    let carrier = view.parts[part].parent?;
    let world = world(view, carrier, primary, solved);
    let hinge = view.parts[part].pivot;
    let center = view.center(part);
    let arm = [center[0] - hinge[0], center[1] - hinge[1]];
    let inertia = (arm[0] * arm[0] + arm[1] * arm[1]).max(100.);
    let (gain, drag) = (f.gain.unwrap_or(0.4), f.drag.unwrap_or(3.));
    let (k, c) = spring(f, 0.55, 0.3);
    let angle = |m: Matrix| m[1].atan2(m[0]);
    let limit = f.max.map_or(1., |value| value.abs() * PI / 180.);
    let mut out = Vec::with_capacity(run.steps + 1);
    let (mut phi, mut omega) = (0., 0.);
    for i in 0..=run.steps {
        let t = run.time(i);
        let (m0, m1, m2) = (world(t - DT), world(t), world(t + DT));
        let (p0, p1, p2) = (apply(m0, hinge), apply(m1, hinge), apply(m2, hinge));
        let v = [(p2[0] - p0[0]) / (2. * DT), (p2[1] - p0[1]) / (2. * DT)];
        let a = [
            (p2[0] - 2. * p1[0] + p0[0]) / (DT * DT),
            (p2[1] - 2. * p1[1] + p0[1]) / (DT * DT),
        ];
        let parent_acc = (angle(m2) - 2. * angle(m1) + angle(m0)) / (DT * DT);
        let theta = angle(m1) + phi;
        let arm_x = arm[0] * theta.cos() - arm[1] * theta.sin();
        let arm_y = arm[0] * theta.sin() + arm[1] * theta.cos();
        let torque = gain * (arm_y * (a[0] + drag * v[0]) - arm_x * (a[1] + drag * v[1])) / inertia;
        omega += (torque - k * phi - c * omega - parent_acc) * DT;
        phi = (phi + omega * DT).clamp(-limit, limit);
        out.push(phi * 180. / PI);
    }
    Some(out)
}
fn lean(
    view: &RigView,
    part: usize,
    f: &Follow,
    primary: &Motion,
    solved: &Motion,
    run: &Run,
) -> Vec<f64> {
    let is_lean = matches!(f.mode.unwrap_or_default(), FollowMode::Lean);
    let world = world(view, part, primary, solved);
    let own = view.parts[part].pivot;
    let (k, c) = spring(f, 0.4, 0.5);
    let max = f.max.unwrap_or(if is_lean { 6. } else { 0.03 });
    let (mut x, mut v) = (0., 0.);
    let mut out = Vec::with_capacity(run.steps + 1);
    for i in 0..=run.steps {
        let t = run.time(i);
        let (p0, p2) = (apply(world(t - DT), own), apply(world(t + DT), own));
        let (vx, vy) = ((p2[0] - p0[0]) / (2. * DT), (p2[1] - p0[1]) / (2. * DT));
        let target = if is_lean {
            (f.gain_x.unwrap_or(-0.005) * vx + f.gain_y.unwrap_or(0.02) * vy).clamp(-max, max)
                * f.amount.unwrap_or(1.)
        } else {
            max.min(f.gain.unwrap_or(0.0002) * vx.hypot(vy))
        };
        v += (k * (target - x) - c * v) * DT;
        x += v * DT;
        out.push(x);
    }
    out
}
pub fn solve(
    view: &RigView,
    follows: &[Follow],
    primary: &Motion,
    duration: f64,
    looping: bool,
) -> Result<Motion, String> {
    let laps = if looping { 3 } else { 1 };
    let total = if looping {
        duration * laps as f64
    } else {
        duration + 1.6
    };
    let run = Run {
        duration,
        looping,
        laps,
        steps: (total / DT).ceil() as usize,
    };
    if run.steps > 100_000 {
        return Err("Follow program exceeds the sample limit".into());
    }
    let mut ordered = follows
        .iter()
        .map(|f| view.index(&f.part).map(|p| (p, f)))
        .collect::<Result<Vec<_>, _>>()?;
    ordered.sort_by_key(|(part, f)| {
        view.parts[*part].chain.len() * 2
            + usize::from(matches!(f.mode.unwrap_or_default(), FollowMode::Pendulum))
    });
    let mut solved = BTreeMap::new();
    for (part, f) in ordered {
        if f.period.is_some_and(|p| !(0.2..=10.).contains(&p)) {
            return Err("Follow period is outside the stable solver range".into());
        }
        let samples = if matches!(f.mode.unwrap_or_default(), FollowMode::Pendulum) {
            pendulum(view, part, f, primary, &solved, &run)
        } else {
            Some(lean(view, part, f, primary, &solved, &run))
        };
        let Some(samples) = samples else { continue };
        if samples.iter().any(|value| !value.is_finite()) {
            return Err("Nonfinite follow solution".into());
        }
        let offset = if looping {
            round(duration * (run.laps - 1) as f64 / DT)
        } else {
            0.
        };
        let max = run.steps;
        let mode = f.mode.unwrap_or_default();
        let amount = f.amount.unwrap_or(1.);
        let strength = view.parts[part].strength;
        let function: PoseFn = Arc::new(move |t| {
            let value = samples[(offset + round(t / DT)).clamp(0., max as f64) as usize];
            let mut pose = Pose::default();
            if matches!(mode, FollowMode::Stretch) {
                pose.sx = 1. / (1. + value);
                pose.sy = 1. + value;
            } else {
                pose.r = value
                    * if matches!(mode, FollowMode::Pendulum) {
                        amount
                    } else {
                        1.
                    };
            }
            pose.scale(strength, false)
        });
        solved.insert(part, function);
    }
    Ok(solved)
}
