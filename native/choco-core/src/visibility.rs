use crate::{
    ease::Ease,
    pose::lerp,
    program::{Beat, BeatKind as B},
};
use serde::Serialize;
#[derive(Debug, Clone, Serialize)]
pub struct Step {
    pub at: f64,
    pub dur: f64,
    pub from: Option<f64>,
    pub to: f64,
    pub entrance: bool,
}
pub fn steps(beats: &[Beat]) -> Vec<Step> {
    beats
        .iter()
        .filter_map(|b| {
            let (from, to, dur, entrance) = if b.kind.entrance() {
                if matches!(b.kind, B::Pop | B::Drop | B::Rise | B::SlideIn | B::FadeIn) {
                    (Some(0.), 1., b.duration() * 0.5, true)
                } else {
                    (None, 1., 0., true)
                }
            } else if b.kind == B::Show {
                (None, 1., b.duration(), false)
            } else if matches!(b.kind, B::Hide | B::FadeOut) {
                (None, 0., b.duration(), false)
            } else if b.kind == B::To {
                (None, b.pose.as_ref()?.opacity?, b.duration(), false)
            } else {
                return None;
            };
            Some(Step {
                at: b.start(),
                dur,
                from,
                to,
                entrance,
            })
        })
        .collect()
}
pub fn at(steps: &[Step], baseline: f64, seconds: f64) -> f64 {
    let mut value = if steps
        .first()
        .is_some_and(|s| s.entrance && s.from == Some(0.))
    {
        0.
    } else {
        baseline
    };
    for step in steps {
        if seconds < step.at {
            return value;
        }
        let from = step.from.unwrap_or(value);
        if step.dur > 0. && seconds < step.at + step.dur {
            return lerp(
                from,
                step.to,
                Ease::Out.at(((seconds - step.at) / step.dur).clamp(0., 1.)),
            );
        }
        value = step.to;
    }
    value
}
pub fn hide() -> Step {
    Step {
        at: 0.,
        dur: 0.2,
        from: None,
        to: 0.,
        entrance: false,
    }
}
