use crate::{
    ease::Ease,
    pose::{Point, Pose, lerp},
    program::Beat,
    rig::RigView,
};
use serde::Serialize;
#[derive(Debug, Clone, Serialize)]
pub struct Particle {
    pub shape: String,
    pub color: String,
    pub size: f64,
    pub delay: f64,
    pub duration: f64,
    center: Point,
    angle: f64,
    distance: f64,
    spin: f64,
    gravity: f64,
}
#[derive(Debug, Serialize)]
pub struct ParticlePose {
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub s: f64,
    pub o: f64,
}
/// Prepared presentation track; delay and interpolation semantics belong to the shared core.
pub struct ParticlePlayback {
    keys: [Pose; 25],
    delay: f64,
    duration: f64,
}
impl ParticlePlayback {
    pub fn new(particle: &Particle) -> Self {
        Self {
            keys: particle.keyframes(),
            delay: particle.delay,
            duration: particle.duration,
        }
    }
    pub fn at(&self, seconds: f64) -> Pose {
        let u = if self.duration <= 0. {
            1.
        } else {
            ((seconds - self.delay) / self.duration).clamp(0., 1.)
        };
        let position = u * 24.;
        let index = (position.floor() as usize).min(23);
        self.keys[index].mix(self.keys[index + 1], position - index as f64)
    }
}
impl Particle {
    /// The browser's 25 CSS keyframes, including its decimal serialization. Prepare once
    /// per flight; evaluating the analytic curve every frame would change playback.
    pub fn keyframes(&self) -> [Pose; 25] {
        std::array::from_fn(|index| {
            let p = self.at(index as f64 / 24.);
            let scale = fixed(p.s.max(0.001), 3);
            Pose {
                x: fixed(p.x, 1),
                y: fixed(p.y, 1),
                r: fixed(p.r, 1),
                sx: scale,
                sy: scale,
                o: if index == 0 { 0. } else { p.o },
            }
        })
    }
    pub fn at(&self, u: f64) -> ParticlePose {
        let e = 1. - (1. - u).powf(2.2);
        ParticlePose {
            x: self.center[0] + self.angle.cos() * self.distance * e,
            y: self.center[1] + self.angle.sin() * self.distance * e + self.gravity * u * u * 0.5,
            r: self.spin * u,
            s: if u < 0.15 { u / 0.15 } else { 1. - 0.4 * u },
            o: if u < 0.7 { 1. } else { 1. - (u - 0.7) / 0.3 },
        }
    }
}
// Number.toFixed rounds the exact binary value, with ties away from zero. Multiplying
// by 10^digits in f64 first can introduce a false tie (for example 2.55.toFixed(1)).
// Emitter coordinates are bounded by validation; one through four digits are used.
fn fixed(value: f64, digits: u32) -> f64 {
    let bits = value.abs().to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let mantissa = (bits & ((1_u64 << 52) - 1)) | if exponent == 0 { 0 } else { 1_u64 << 52 };
    let scaled = u128::from(mantissa) * 5_u128.pow(digits);
    let shift = exponent.max(1) - 1023 - 52 + digits as i32;
    let rounded = if shift >= 0 {
        scaled << shift
    } else if -shift >= 128 {
        0
    } else {
        (scaled >> -shift) + u128::from(scaled & ((1_u128 << -shift) - 1) >= 1_u128 << (-shift - 1))
    };
    (rounded as f64 / 10_f64.powi(digits as i32)).copysign(value)
}

#[cfg(test)]
mod tests {
    use super::fixed;
    #[test]
    fn flow_uses_serialized_keys_and_interpolates_between_them() {
        let flow = super::Flow {
            part: 0,
            delay: 0.2,
            duration: 2.,
            points: vec![[0., 0.], [37., 19.]],
            turn: 23.4567,
            end_scale: 0.54321,
        };
        let playback = super::FlowPlayback::new(&flow);
        assert_eq!(playback.at(0.).o, 0.);
        assert_eq!(playback.at(3.).o, 0.);
        let a = playback.at(0.2 + 2. * 7. / 30.);
        let b = playback.at(0.2 + 2. * 8. / 30.);
        let actual = playback.at(0.2 + 2. * 7.5 / 30.);
        let expected = a.mix(b, 0.5);
        for (a, b) in [
            (actual.x, expected.x),
            (actual.r, expected.r),
            (actual.sx, expected.sx),
        ] {
            assert!((a - b).abs() < 1e-12);
        }
        assert!((actual.x - flow.at(0.25).x).abs() > 0.0001);
    }
    #[test]
    fn css_decimal_rounding_uses_the_exact_binary_value() {
        for (value, digits, expected) in [
            (2.55, 1, 2.5),
            (2.35, 1, 2.4),
            (-2.25, 1, -2.3),
            (0.0625, 3, 0.063),
            (1.005, 3, 1.005),
            (f64::from_bits(1), 3, 0.),
        ] {
            assert_eq!(fixed(value, digits), expected);
        }
    }
}
pub fn burst(view: &RigView, b: &Beat) -> Result<Vec<Particle>, String> {
    let mut seed = b.seed.unwrap_or(7);
    if seed == 0 {
        seed = 1;
    }
    let mut random = || {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        seed as f64 / 4294967296.
    };
    let center = if let Some(from) = b.from {
        from
    } else if let Some(part) = &b.part {
        view.center(view.index(part)?)
    } else {
        [view.width / 2., view.height / 2.]
    };
    let shapes = b
        .shapes
        .clone()
        .unwrap_or_else(|| vec!["circle".into(), "rect".into(), "star".into()]);
    let colors = b
        .colors
        .clone()
        .unwrap_or_else(|| vec!["accent".into(), "secondary".into()]);
    Ok((0..b.count.unwrap_or(10).min(24))
        .map(|index| {
            let size = b.size.unwrap_or(6.) * (0.7 + 0.6 * random());
            let angle = b.angle.unwrap_or(-90.).to_radians()
                + (random() - 0.5) * b.spread.unwrap_or(360.).to_radians();
            let distance = b.distance.unwrap_or(80.) * (0.55 + 0.6 * random());
            let spin = (random() - 0.5) * 540.;
            Particle {
                shape: shapes
                    .get(index % shapes.len().max(1))
                    .cloned()
                    .unwrap_or_else(|| "circle".into()),
                color: colors
                    .get(index % colors.len().max(1))
                    .cloned()
                    .unwrap_or_else(|| "accent".into()),
                size,
                delay: b.start() + index as f64 * b.stagger.unwrap_or(0.),
                duration: b.duration(),
                center,
                angle,
                distance,
                spin,
                gravity: b.gravity.unwrap_or(160.),
            }
        })
        .collect())
}
#[derive(Debug, Clone, Serialize)]
pub struct Flow {
    pub part: usize,
    pub delay: f64,
    pub duration: f64,
    points: Vec<Point>,
    turn: f64,
    end_scale: f64,
}
/// The browser's 31 serialized keyframes, prepared once per flight.
pub struct FlowPlayback {
    keys: [Pose; 31],
    delay: f64,
    duration: f64,
}
impl FlowPlayback {
    pub fn new(flow: &Flow) -> Self {
        Self {
            keys: std::array::from_fn(|index| {
                let p = flow.at(index as f64 / 30.);
                Pose {
                    x: fixed(p.x, 2),
                    y: fixed(p.y, 2),
                    r: fixed(p.r, 3),
                    sx: fixed(p.sx, 4),
                    sy: fixed(p.sy, 4),
                    o: if index == 0 { 0. } else { p.o },
                }
            }),
            delay: flow.delay,
            duration: flow.duration,
        }
    }
    pub fn at(&self, seconds: f64) -> Pose {
        let u = if self.duration <= 0. {
            if seconds < self.delay { 0. } else { 1. }
        } else {
            ((seconds - self.delay) / self.duration).clamp(0., 1.)
        };
        let position = u * 30.;
        let index = (position.floor() as usize).min(29);
        self.keys[index].mix(self.keys[index + 1], position - index as f64)
    }
}
impl Flow {
    pub fn at(&self, u: f64) -> Pose {
        let n = self.points.len() - 1;
        if n == 0 {
            return Pose {
                o: 0.,
                ..Pose::default()
            };
        }
        let e = Ease::InOut.at(u) * n as f64;
        let j = (e.floor() as usize).min(n - 1);
        let k = e - j as f64;
        let (a, b) = (self.points[j], self.points[j + 1]);
        let scale = lerp(1., self.end_scale, u);
        Pose {
            x: lerp(a[0], b[0], k),
            y: lerp(a[1], b[1], k),
            r: self.turn * u,
            sx: scale,
            sy: scale,
            o: if u < 0.1 {
                u / 0.1
            } else if u > 0.85 {
                (1. - u) / 0.15
            } else {
                1.
            },
        }
    }
}
pub fn flows(b: &Beat, part: usize) -> Vec<Flow> {
    let mut points = vec![[0., 0.]];
    points.extend_from_slice(b.points.as_deref().unwrap_or_default());
    (0..b.count.unwrap_or(3).clamp(1, 12))
        .map(|index| Flow {
            part,
            delay: b.start() + index as f64 * b.stagger.unwrap_or(0.18),
            duration: b.duration(),
            points: points.clone(),
            turn: b.turn.unwrap_or(0.),
            end_scale: b.end_scale.unwrap_or(0.6),
        })
        .collect()
}
#[derive(Debug, Clone, Serialize)]
pub struct Draw {
    pub part: usize,
    pub delay: f64,
    pub duration: f64,
    pub on: bool,
}
