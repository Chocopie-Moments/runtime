use serde::{Deserialize, Serialize};

pub type Matrix = [f64; 6];
pub type Point = [f64; 2];
pub const IDENTITY: Matrix = [1., 0., 0., 1., 0., 0.];
pub const LOOP_WINDOW: f64 = 12.;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pose {
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub sx: f64,
    pub sy: f64,
    pub o: f64,
}
impl Default for Pose {
    fn default() -> Self {
        Self {
            x: 0.,
            y: 0.,
            r: 0.,
            sx: 1.,
            sy: 1.,
            o: 1.,
        }
    }
}
impl Pose {
    pub fn combine(self, other: Self) -> Self {
        Self {
            x: self.x + other.x,
            y: self.y + other.y,
            r: self.r + other.r,
            sx: self.sx * other.sx,
            sy: self.sy * other.sy,
            o: self.o * other.o,
        }
    }
    pub fn mix(self, other: Self, t: f64) -> Self {
        Self {
            x: lerp(self.x, other.x, t),
            y: lerp(self.y, other.y, t),
            r: lerp(self.r, other.r, t),
            sx: lerp(self.sx, other.sx, t),
            sy: lerp(self.sy, other.sy, t),
            o: lerp(self.o, other.o, t),
        }
    }
    pub fn scale(self, gain: f64, opacity: bool) -> Self {
        Self {
            x: self.x * gain,
            y: self.y * gain,
            r: self.r * gain,
            sx: 1. + (self.sx - 1.) * gain,
            sy: 1. + (self.sy - 1.) * gain,
            o: if opacity {
                1. + (self.o - 1.) * gain
            } else {
                self.o
            },
        }
    }
    pub fn is_rest(self) -> bool {
        self.x.abs() < 0.01
            && self.y.abs() < 0.01
            && self.r.abs() < 0.01
            && (self.sx - 1.).abs() < 0.001
            && (self.sy - 1.).abs() < 0.001
            && (self.o - 1.).abs() < 0.001
    }
    pub fn matrix(self, pivot: Point) -> Matrix {
        let (sin, cos) = self.r.to_radians().sin_cos();
        multiply(
            multiply(
                [1., 0., 0., 1., self.x + pivot[0], self.y + pivot[1]],
                [cos, sin, -sin, cos, 0., 0.],
            ),
            [
                self.sx,
                0.,
                0.,
                self.sy,
                -pivot[0] * self.sx,
                -pivot[1] * self.sy,
            ],
        )
    }
    pub fn finite(self) -> bool {
        [self.x, self.y, self.r, self.sx, self.sy, self.o]
            .iter()
            .all(|v| v.is_finite())
    }
}
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
pub fn cycle(value: f64) -> f64 {
    ((value % 1.) + 1.) % 1.
}
pub fn multiply(m: Matrix, n: Matrix) -> Matrix {
    [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}
pub fn apply(m: Matrix, p: Point) -> Point {
    [
        m[0] * p[0] + m[2] * p[1] + m[4],
        m[1] * p[0] + m[3] * p[1] + m[5],
    ]
}
