use crate::{
    behaviors::{ambient, round},
    pose::{LOOP_WINDOW, Pose},
    program::{Ambient, AmbientKind},
    rig::RigView,
};
use std::{collections::BTreeMap, sync::Arc};

pub type PoseFn = Arc<dyn Fn(f64) -> Pose + Send + Sync>;
pub type Motion = BTreeMap<usize, PoseFn>;
pub fn ambient_layer(view: &RigView, behaviors: &[Ambient]) -> Result<Motion, String> {
    let mut by_part: BTreeMap<usize, Vec<PoseFn>> = BTreeMap::new();
    for b in behaviors {
        let part = view.index(&b.part)?;
        let child = matches!(
            b.kind,
            AmbientKind::Twinkle | AmbientKind::Stream | AmbientKind::Bounce
        );
        let targets = if child {
            view.parts[part].children.clone()
        } else {
            vec![part]
        };
        let count = targets.len();
        for (index, target) in targets.into_iter().enumerate() {
            let function = ambient(b.clone(), index, count);
            let spin = b.kind == AmbientKind::Spin;
            let gain = view.parts[part].strength;
            by_part
                .entry(target)
                .or_default()
                .push(Arc::new(move |seconds| {
                    let pose = function(seconds);
                    if spin {
                        if gain > 0. { pose } else { Pose::default() }
                    } else {
                        pose.scale(gain, true)
                    }
                }));
        }
    }
    Ok(by_part
        .into_iter()
        .map(|(part, fns)| {
            let combined: PoseFn = Arc::new(move |seconds| {
                fns.iter()
                    .fold(Pose::default(), |p, f| p.combine(f(seconds)))
            });
            (part, combined)
        })
        .collect())
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct PoseKey {
    pub offset: f64,
    pub pose: Pose,
}
pub fn sample_keys(function: &dyn Fn(f64) -> Pose, duration: f64, looping: bool) -> Vec<PoseKey> {
    let n = (duration * 30.).ceil().max(2.) as usize;
    let first = function(0.);
    let mut keys = Vec::with_capacity(n + 1);
    keys.push(PoseKey {
        offset: 0.,
        pose: first,
    });
    let (mut turned, mut raw) = (first.r, first.r);
    for k in 1..=n {
        for step in 1..=8 {
            let value = if looping && k == n && step == 8 {
                first.r
            } else {
                function((k as f64 - 1. + step as f64 / 8.) / n as f64 * duration).r
            };
            let delta = value - raw;
            turned += delta - 360. * round(delta / 360.);
            raw = value;
        }
        let mut pose = if looping && k == n {
            first
        } else {
            function(k as f64 / n as f64 * duration)
        };
        let wraps = round((turned - pose.r) / 360.);
        turned = pose.r + 360. * wraps;
        pose.r = turned;
        keys.push(PoseKey {
            offset: k as f64 / n as f64,
            pose,
        });
    }
    keys
}
pub fn loop_keys(function: &PoseFn) -> Vec<PoseKey> {
    sample_keys(function.as_ref(), LOOP_WINDOW, true)
}
