use crate::{
    ease::Ease,
    pose::{LOOP_WINDOW, Pose, cycle, lerp},
    program::{Ambient, AmbientKind as A, Beat, BeatKind as B},
};
use std::f64::consts::{PI, TAU};

// JavaScript Math.round resolves negative half ties toward +infinity; f64::round does not.
pub fn round(value: f64) -> f64 {
    (value + 0.5).floor()
}
pub fn whole_turns(value: f64) -> f64 {
    let n = round(value);
    if n != 0. {
        n
    } else if value != 0. {
        value.signum()
    } else {
        1.
    }
}
pub fn snap_period(value: f64) -> f64 {
    LOOP_WINDOW / round(LOOP_WINDOW / value.clamp(0.4, LOOP_WINDOW)).max(1.)
}

/// Prepare immutable behavior data once; evaluating the returned motion allocates nothing.
pub fn ambient(b: Ambient, index: usize, count: usize) -> impl Fn(f64) -> Pose {
    let period = snap_period(b.period.unwrap_or(3.));
    let keys = if b.kind == A::Keys {
        prepare_keys(&b, period)
    } else {
        Vec::new()
    };
    move |seconds| {
        let phase = seconds / period + b.phase.unwrap_or(0.);
        let wave = TAU * phase;
        let progress = cycle(phase);
        let mut p = Pose::default();
        match b.kind {
            A::Keys => return keyed(&keys, period, progress),
            A::Float => {
                p.x = b.x.unwrap_or(0.) * wave.cos();
                p.y = b.y.unwrap_or(6.) * wave.sin();
            }
            A::Bob => {
                p.y = b.y.unwrap_or(5.) * wave.sin();
                p.r = b.deg.unwrap_or(2.) * (wave - 0.9).sin();
            }
            A::Sway => p.r = b.deg.unwrap_or(3.) * wave.sin(),
            A::Drift => {
                p.x = b.x.unwrap_or(4.) * wave.sin();
                p.y = b.y.unwrap_or(0.) * (wave + 1.3).sin();
            }
            A::Breathe => {
                let a = b.amount.unwrap_or(0.025);
                p.sx = 1. - a * 0.5 * wave.sin();
                p.sy = 1. + a * wave.sin();
            }
            A::Pulse => {
                let s = 0.5 - 0.5 * wave.cos();
                let a = b.amount.unwrap_or(0.06);
                p.sx = 1. + a * s;
                p.sy = p.sx;
                p.o = 1. - b.fade.unwrap_or(0.) * s;
            }
            A::Spin => {
                p.r = if b.reverse.unwrap_or(false) {
                    -360.
                } else {
                    360.
                } * progress
            }
            A::Orbit => {
                p.x = b.x.unwrap_or(6.) * wave.cos();
                p.y = b.y.unwrap_or(4.) * wave.sin();
            }
            A::Flicker => {
                p.o = 1.
                    - b.amount.unwrap_or(0.35)
                        * (0.5
                            + 0.25 * wave.sin()
                            + 0.15 * (3. * wave + 1.).sin()
                            + 0.1 * (7. * wave + 2.).sin())
            }
            A::Blink => {
                let u = progress * period;
                let closed = if u < 0.07 {
                    u / 0.07
                } else if u < 0.16 {
                    1. - (u - 0.07) / 0.09
                } else {
                    0.
                };
                p.sy = 1. - 0.9 * closed.clamp(0., 1.);
            }
            A::Twinkle => {
                let s = 0.5 + 0.5 * (wave + TAU * b.stagger.unwrap_or(0.37) * index as f64).sin();
                p.sx = lerp(b.min.unwrap_or(0.55), 1.08, s);
                p.sy = p.sx;
                p.o = lerp(b.dim.unwrap_or(0.35), 1., s);
            }
            A::Stream => {
                let u =
                    cycle(progress + b.stagger.unwrap_or(1. / count.max(1) as f64) * index as f64);
                p.x = b.dx.unwrap_or(-30.) * (u - 0.5);
                p.y = b.dy.unwrap_or(0.) * (u - 0.5);
                p.o = lerp(1. - b.fade.unwrap_or(0.9), 1., (PI * u).sin());
            }
            A::Bounce => {
                p.y = -b.y.unwrap_or(8.)
                    * (PI * cycle(progress + b.stagger.unwrap_or(0.15) * index as f64))
                        .sin()
                        .abs()
            }
        }
        p
    }
}
fn prepare_keys(b: &Ambient, period: f64) -> Vec<(f64, Pose, Ease)> {
    let fit = period / b.period.unwrap_or(period).clamp(0.4, LOOP_WINDOW);
    let mut keys: Vec<_> = b
        .keys
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|k| {
            (
                (k.t * fit).clamp(0., period),
                k.pose.pose(),
                k.ease.unwrap_or(Ease::Sine),
            )
        })
        .collect();
    keys.sort_by(|a, b| a.0.total_cmp(&b.0));
    if keys.is_empty() {
        return keys;
    }
    if keys[0].0 > 0. {
        keys.insert(0, (0., keys.last().unwrap().1, Ease::Sine));
    }
    keys.push((period, keys[0].1, Ease::Sine));
    keys
}
fn keyed(keys: &[(f64, Pose, Ease)], period: f64, progress: f64) -> Pose {
    if keys.is_empty() {
        return Pose::default();
    }
    let u = progress * period;
    let j = keys.iter().position(|k| k.0 >= u).unwrap_or(1).max(1);
    let (a, c) = (keys[j - 1], keys[j]);
    a.1.mix(
        c.1,
        c.2.at(if c.0 == a.0 {
            1.
        } else {
            (u - a.0) / (c.0 - a.0)
        }),
    )
}
pub fn effect(b: &Beat, u: f64) -> Pose {
    let mut p = Pose::default();
    match b.kind {
        B::Wave => {
            p.r = b.deg.unwrap_or(14.) * (u * TAU * b.times.unwrap_or(2.)).sin() * (PI * u).sin()
        }
        B::Wiggle => p.r = b.deg.unwrap_or(6.) * (u * TAU * b.times.unwrap_or(3.)).sin() * (1. - u),
        B::Shake => p.x = b.px.unwrap_or(8.) * (u * TAU * b.times.unwrap_or(3.)).sin() * (1. - u),
        B::Nod => {
            p.r = b.deg.unwrap_or(8.)
                * (PI * u).sin()
                * if u < 0.5 {
                    1.
                } else {
                    1. - 0.3 * (PI * (u - 0.5) * 2.).sin()
                }
        }
        B::Hop => {
            let a = b.squash.unwrap_or(0.12);
            if u < 0.18 {
                let k = (PI * u / 0.18).sin();
                p.sx = 1. + a * 0.6 * k;
                p.sy = 1. - a * k;
            } else if u < 0.7 {
                let air = (PI * (u - 0.18) / 0.52).sin();
                p.y = -b.height.unwrap_or(24.) * air;
                p.sx = 1. - a * 0.4 * air;
                p.sy = 1. + a * 0.5 * air;
            } else {
                let k = (u - 0.7) / 0.3;
                let land = (-5. * k).exp() * (9. * k).cos() * (1. - k);
                p.sx = 1. + a * 0.6 * land;
                p.sy = 1. - a * land;
            }
        }
        B::Squash => {
            let land = (-5. * u).exp() * (10. * u).cos() * (PI * u).sin();
            let a = b.amount.unwrap_or(0.14);
            p.sx = 1. + a * 0.7 * land;
            p.sy = 1. - a * land;
        }
        B::Pulse => {
            p.sx = 1. + b.amount.unwrap_or(0.12) * (PI * u).sin();
            p.sy = p.sx;
        }
        B::Spin => {
            p.r = 360. * whole_turns(b.turns.unwrap_or(1.)) * b.ease.unwrap_or(Ease::InOut).at(u)
        }
        B::Lift => {
            p.y = -b.y.unwrap_or(12.) * (PI * u).sin();
            p.r = b.deg.unwrap_or(0.) * (PI * u).sin();
        }
        _ => {}
    }
    p
}
pub fn entrance(b: &Beat) -> (Pose, Ease) {
    let mut p = Pose::default();
    let easing = match b.kind {
        B::Pop => {
            p.sx = 0.001;
            p.sy = 0.001;
            p.o = 0.;
            Ease::Spring
        }
        B::Drop => {
            p.y = -b.height.unwrap_or(60.);
            p.o = 0.;
            Ease::Spring
        }
        B::Rise => {
            p.y = b.height.unwrap_or(30.);
            p.o = 0.;
            Ease::Spring
        }
        B::SlideIn => {
            let from = b.from.unwrap_or([-60., 0.]);
            p.x = from[0];
            p.y = from[1];
            p.o = 0.;
            Ease::Soft
        }
        B::FadeIn => {
            p.o = 0.;
            Ease::Out
        }
        B::Grow => {
            p.sx = 0.001;
            p.sy = 0.001;
            Ease::Spring
        }
        B::Unfold => {
            p.sy = 0.001;
            Ease::Soft
        }
        _ => Ease::Soft,
    };
    (p, easing)
}
