//! Renderer-independent keyframes and interruption bridges. Times are seconds on the player clock.
use crate::{
    behaviors::round,
    ease::bezier,
    motion::{PoseFn, PoseKey, sample_keys},
    pose::{IDENTITY, Matrix, Point, Pose, multiply},
};

const TOLERANCES: [f64; 6] = [0.15, 0.15, 0.15, 0.002, 0.002, 0.005];
fn channels(p: Pose) -> [f64; 6] {
    [p.x, p.y, p.r, p.sx, p.sy, p.o]
}
fn thin(keys: Vec<PoseKey>) -> Vec<PoseKey> {
    if keys.len() <= 2 {
        return keys;
    }
    let mut keep = vec![false; keys.len()];
    keep[0] = true;
    keep[keys.len() - 1] = true;
    let mut spans = vec![(0, keys.len() - 1)];
    while let Some((from, to)) = spans.pop() {
        if to - from < 2 {
            continue;
        }
        let (a, c) = (&keys[from], &keys[to]);
        let (mut worst, mut chosen) = (1., None);
        for (index, b) in keys.iter().enumerate().take(to).skip(from + 1) {
            let u = if c.offset == a.offset {
                0.
            } else {
                (b.offset - a.offset) / (c.offset - a.offset)
            };
            let expected = channels(a.pose.mix(c.pose, u));
            let miss = channels(b.pose)
                .iter()
                .zip(expected)
                .zip(TOLERANCES)
                .map(|((value, target), tolerance)| (value - target).abs() / tolerance)
                .fold(0., f64::max);
            // Symmetric cycles have equally good split points. Solver/libm roundoff must not
            // select a different phase on each platform. Prefer the earliest near-tie; the
            // first error above 1 still always splits, so the channel error bounds stay intact.
            if miss > worst && (chosen.is_none() || miss - worst > worst * 1e-9) {
                worst = miss;
                chosen = Some(index);
            }
        }
        if let Some(index) = chosen {
            keep[index] = true;
            spans.push((from, index));
            spans.push((index, to));
        }
    }
    keys.into_iter()
        .enumerate()
        .filter_map(|(index, key)| keep[index].then_some(key))
        .collect()
}
fn interpolate(keys: &[PoseKey], progress: f64) -> Pose {
    let index = keys
        .partition_point(|key| key.offset < progress)
        .min(keys.len() - 1);
    if index == 0 {
        return keys[0].pose;
    }
    let (a, b) = (&keys[index - 1], &keys[index]);
    a.pose.mix(
        b.pose,
        ((progress - a.offset) / (b.offset - a.offset)).clamp(0., 1.),
    )
}
#[derive(Clone)]
pub struct Track {
    pub keys: Vec<PoseKey>,
    pub function: PoseFn,
    pub start: f64,
    pub delay: f64,
    pub duration: f64,
    pub speed: f64,
    pub looping: bool,
    pub turns: bool,
    pub opacity: bool,
    changing: bool,
}
impl Track {
    pub fn new(
        function: PoseFn,
        start: f64,
        duration: f64,
        speed: f64,
        looping: bool,
        delay: f64,
        spin: bool,
    ) -> Self {
        let keys = sample_keys(function.as_ref(), duration, looping);
        let turns = if looping {
            let low = keys.iter().map(|k| k.pose.r).fold(f64::INFINITY, f64::min);
            let high = keys
                .iter()
                .map(|k| k.pose.r)
                .fold(f64::NEG_INFINITY, f64::max);
            high - low >= 180.
        } else {
            spin
        };
        let opacity = (0..=24).any(|k| (function(k as f64 / 24. * duration).o - 1.).abs() > 0.001);
        // The browser clamps each opacity key before interpolation.
        let keys: Vec<_> = thin(keys)
            .into_iter()
            .map(|mut key| {
                key.pose.o = key.pose.o.clamp(0., 1.);
                key
            })
            .collect();
        let changing = keys.windows(2).any(|pair| pair[0].pose != pair[1].pose);
        Self {
            keys,
            changing,
            function,
            start,
            delay,
            duration,
            speed,
            looping,
            turns,
            opacity,
        }
    }
    pub fn needs_frame(&self, now: f64) -> bool {
        self.changing
            && (self.looping
                || (now - self.start).max(0.) * self.speed < self.delay + self.duration)
    }
    pub fn progress(&self, now: f64) -> f64 {
        let elapsed = (now - self.start).max(0.) * self.speed - self.delay;
        if self.looping {
            if elapsed < 0. {
                0.
            } else {
                (elapsed % self.duration) / self.duration
            }
        } else {
            (elapsed / self.duration).clamp(0., 1.)
        }
    }
    pub fn pose(&self, now: f64) -> Pose {
        interpolate(&self.keys, self.progress(now))
    }
    pub fn turn_speed(&self, now: f64) -> f64 {
        let elapsed = (now - self.start).max(0.) * self.speed - self.delay;
        if !self.turns || elapsed < 0. || (!self.looping && elapsed >= self.duration) {
            return 0.;
        }
        let t = self.progress(now) * self.duration;
        let step = 1. / 120.;
        let turned = (self.function)(t + step).r - (self.function)(t).r;
        (turned - 360. * round(turned / 360.)) / step * self.speed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thinning_does_not_amplify_roundoff_in_repeated_cycles() {
        let keys: Vec<_> = (0..=360)
            .map(|i| PoseKey {
                offset: i as f64 / 360.,
                pose: Pose {
                    r: (i as f64 / 30. * std::f64::consts::PI).sin() * 3.,
                    ..Pose::default()
                },
            })
            .collect();
        let mut noisy = keys.clone();
        for (i, key) in noisy.iter_mut().enumerate() {
            key.pose.r += ((i % 7) as f64 - 3.) * 1e-12;
        }
        let exact = thin(keys.clone());
        let perturbed = thin(noisy.clone());
        let offsets = |keys: &[PoseKey]| keys.iter().map(|key| key.offset).collect::<Vec<_>>();
        assert_eq!(offsets(&exact), offsets(&perturbed));
        for (original, reduced) in [(keys, exact), (noisy, perturbed)] {
            for key in original {
                assert!((key.pose.r - interpolate(&reduced, key.offset).r).abs() <= TOLERANCES[2]);
            }
        }
    }
}
pub fn inverse([a, b, c, d, e, f]: Matrix) -> Option<Matrix> {
    let det = a * d - b * c;
    if det.abs() < 1e-12 {
        return None;
    }
    Some([
        d / det,
        -b / det,
        -c / det,
        a / det,
        (c * f - d * e) / det,
        (b * e - a * f) / det,
    ])
}
pub fn from_matrix([a, b, c, d, e, f]: Matrix, [px, py]: Point) -> Pose {
    let sx = a.hypot(b);
    if sx < 1e-6 {
        return Pose::default();
    }
    Pose {
        x: e - px + a * px + c * py,
        y: f - py + b * px + d * py,
        r: b.atan2(a).to_degrees(),
        sx,
        sy: (a * d - b * c) / sx,
        o: 1.,
    }
}
pub fn offset(shown: Matrix, start: Pose, pivot: Point) -> Matrix {
    inverse(start.matrix(pivot)).map_or(IDENTITY, |m| multiply(m, shown))
}
pub fn phase_at(function: &PoseFn, angle: f64) -> f64 {
    let (mut best, mut closest) = (0., f64::INFINITY);
    let mut t = 0.;
    while t < 12. {
        let off = function(t).r - angle;
        let miss = (off - 360. * round(off / 360.)).abs();
        if miss < closest {
            best = t;
            closest = miss;
        }
        if miss < 0.75 {
            break;
        }
        t += 1. / 240.;
    }
    best
}
#[derive(Clone)]
pub enum Bridge {
    Pose {
        start: f64,
        duration: f64,
        keys: Vec<PoseKey>,
        turns: bool,
    },
    Skew {
        start: f64,
        matrix: Matrix,
        pivot: Point,
    },
}
impl Bridge {
    pub fn new(shown: Matrix, next: Pose, pivot: Point, speed: f64, start: f64) -> Option<Self> {
        let matrix = offset(shown, next, pivot);
        let columns = matrix[0].hypot(matrix[1]) * matrix[2].hypot(matrix[3]);
        if columns > 1e-9 && (matrix[0] * matrix[2] + matrix[1] * matrix[3]).abs() / columns > 0.01
        {
            return Some(Self::Skew {
                start,
                matrix,
                pivot,
            });
        }
        let pose = from_matrix(matrix, pivot);
        let turning = speed.abs() >= 45.;
        let way = speed.signum();
        let mut ahead = if turning {
            360. - (((pose.r * way) % 360. + 360.) % 360.)
        } else {
            0.
        };
        if turning && ahead < speed.abs() * 0.25 / 2. {
            ahead += 360.;
        }
        if ahead == 0. && pose.is_rest() {
            return None;
        }
        let reach = (pose.x.hypot(pose.y) / 400.)
            .max(pose.r.abs() / 540.)
            .max((pose.sx - 1.).abs().max((pose.sy - 1.).abs()) / 2.5);
        let duration = if ahead > 0. {
            (2. * ahead / speed.abs()).clamp(0.25, 1.5)
        } else {
            reach.clamp(0.18, 0.6)
        };
        let power = if ahead > 0. {
            (speed.abs() * duration / ahead).clamp(1., 8.)
        } else {
            2.
        };
        let n = (duration * 30.).ceil().max(2.) as usize;
        let keys = (0..=n)
            .map(|index| {
                let offset = index as f64 / n as f64;
                let e = 1. - (1. - offset).powf(power);
                let mut value = pose.mix(Pose::default(), e);
                if ahead > 0. {
                    value.r = pose.r + way * ahead * e;
                }
                PoseKey {
                    offset,
                    pose: value,
                }
            })
            .collect();
        Some(Self::Pose {
            start,
            duration,
            keys: thin(keys),
            turns: turning,
        })
    }
    pub fn matrix(&self, now: f64, pivot: Point) -> Matrix {
        match self {
            Self::Pose {
                start,
                duration,
                keys,
                ..
            } => {
                if now >= start + duration {
                    IDENTITY
                } else {
                    interpolate(keys, ((now - start) / duration).clamp(0., 1.)).matrix(pivot)
                }
            }
            Self::Skew {
                start,
                matrix,
                pivot: origin,
            } => {
                let u = bezier(((now - start) / 0.18).clamp(0., 1.), [0.33, 1., 0.68, 1.]);
                let [a, b, c, d, mut e, mut f] = *matrix;
                let (dx, dy) = (pivot[0] - origin[0], pivot[1] - origin[1]);
                e += (1. - a) * dx - c * dy;
                f += -b * dx + (1. - d) * dy;
                affine_to_identity([a, b, c, d, e, f], u)
            }
        }
    }
    pub fn turn_speed(&self, now: f64) -> f64 {
        match self {
            Self::Pose {
                start,
                duration,
                keys,
                turns: true,
            } if now < start + duration => {
                let u = ((now - start) / duration).clamp(0., 1.);
                let index = keys
                    .partition_point(|k| k.offset <= u)
                    .clamp(1, keys.len() - 1);
                let (a, b) = (&keys[index - 1], &keys[index]);
                let d = b.pose.r - a.pose.r;
                (d - 360. * round(d / 360.)) / ((b.offset - a.offset) * duration)
            }
            _ => 0.,
        }
    }
}

// WAAPI's QR decomposition, rather than coefficient interpolation, preserves rotation and skew.
// Browser-reference algorithm: chromium ui/gfx/transform_util.cc Decompose2DTransform.
fn affine_to_identity([a, b, c, d, e, f]: Matrix, u: f64) -> Matrix {
    let determinant = a * d - b * c;
    let sx = a.hypot(b) * if determinant < 0. && a < d { -1. } else { 1. };
    if sx == 0. || determinant == 0. {
        return if u < 0.5 {
            [a, b, c, d, e, f]
        } else {
            IDENTITY
        };
    }
    let sy = determinant / sx;
    let skew = (a * c + b * d) / (sx * sy);
    let remaining = 1. - u;
    let angle = (b / sx).atan2(a / sx) * remaining;
    let (sin, cos) = angle.sin_cos();
    let x = sx * remaining + u;
    let y = sy * remaining + u;
    let k = skew * remaining;
    [
        cos * x,
        sin * x,
        (cos * k - sin) * y,
        (sin * k + cos) * y,
        e * remaining,
        f * remaining,
    ]
}
