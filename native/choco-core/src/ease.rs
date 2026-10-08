use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Ease {
    Snap,
    Sine,
    Linear,
    In,
    Out,
    InOut,
    Back,
    Spring,
    #[default]
    Soft,
}
impl Ease {
    pub fn at(self, t: f64) -> f64 {
        match self {
            Self::Snap => bezier(t, [0.35, 0., 0.1, 1.]),
            Self::Sine => 0.5 - 0.5 * (PI * t).cos(),
            Self::Linear => t,
            Self::In => t * t * t,
            Self::Out => 1. - (1. - t).powi(3),
            Self::InOut => {
                if t < 0.5 {
                    4. * t * t * t
                } else {
                    1. - (-2. * t + 2.).powi(3) / 2.
                }
            }
            Self::Back => 1. + 2.70158 * (t - 1.).powi(3) + 1.70158 * (t - 1.).powi(2),
            Self::Spring => spring(t, 0.38),
            Self::Soft => spring(t, 0.62),
        }
    }
}
pub fn bezier(x: f64, points: [f64; 4]) -> f64 {
    if x <= 0. || x >= 1. {
        return x.clamp(0., 1.);
    }
    let curve = |t: f64, a: f64, b: f64| {
        3. * (1. - t) * (1. - t) * t * a + 3. * (1. - t) * t * t * b + t * t * t
    };
    let (mut low, mut high) = (0., 1.);
    for _ in 0..24 {
        let mid = (low + high) / 2.;
        if curve(mid, points[0], points[2]) < x {
            low = mid;
        } else {
            high = mid;
        }
    }
    curve((low + high) / 2., points[1], points[3])
}
fn spring(t: f64, zeta: f64) -> f64 {
    if t >= 1. {
        return 1.;
    }
    let omega = 4.6 / zeta;
    let damped = omega * (1. - zeta * zeta).sqrt();
    let ratio = zeta / (1. - zeta * zeta).sqrt();
    1. - (-zeta * omega * t).exp() * ((damped * t).cos() + ratio * (damped * t).sin())
}
