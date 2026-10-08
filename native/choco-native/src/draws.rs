//! Retained stroke reveal. Lengths are measured once; frame updates only change dash offsets.
use crate::{
    scene::{Contour, Shape},
    tvg::{self, Raw, check},
};
use choco_core::{player::Player, pose::Point};

#[derive(Clone, Copy, PartialEq)]
enum DashState {
    Authored,
    Hidden,
    Full,
    Partial(f32),
}

struct Stroke {
    paint: Raw,
    parts: Vec<usize>,
    length: f32,
    dashes: Vec<f32>,
    offset: f32,
    shown: DashState,
}

pub(crate) struct Draws {
    strokes: Vec<Stroke>,
    offsets: Vec<Option<(usize, f64)>>,
    remaining: usize,
}
impl Draws {
    pub fn new(parts: usize) -> Self {
        Self {
            strokes: Vec::new(),
            offsets: vec![None; parts],
            remaining: 2_000_000,
        }
    }
    pub fn add(&mut self, paint: Raw, shape: &Shape, parts: &[usize]) -> Result<(), String> {
        if parts.is_empty() || matches!(shape.stroke, crate::scene::Paint::None) {
            return Ok(());
        }
        let length = length(&shape.contours, &mut self.remaining)? as f32;
        // Empty paths retain their authored cap behavior; there is no distance to reveal.
        if length <= 0. {
            return Ok(());
        }
        self.strokes.push(Stroke {
            paint,
            parts: parts.to_vec(),
            length,
            dashes: shape.dasharray.iter().map(|v| *v as f32).collect(),
            offset: shape.dashoffset as f32,
            shown: DashState::Authored,
        });
        Ok(())
    }
    pub fn update(&mut self, player: &Player, dirty: &mut bool) -> Result<(), String> {
        if self.strokes.is_empty() {
            return Ok(());
        }
        self.offsets.fill(None);
        for (order, (part, offset)) in player.draw_offsets().enumerate() {
            self.offsets[part] = Some((order, offset));
        }
        for stroke in &mut self.strokes {
            let next = stroke
                .parts
                .iter()
                .filter_map(|part| self.offsets[*part])
                .max_by_key(|(order, _)| *order)
                .map_or(DashState::Authored, |(_, offset)| {
                    if offset == 1. {
                        DashState::Hidden
                    } else if offset == 0. {
                        DashState::Full
                    } else {
                        DashState::Partial(((1. + offset) * f64::from(stroke.length)) as f32)
                    }
                });
            if next == stroke.shown {
                continue;
            }
            *dirty = true;
            // A gap longer than the whole path prevents a rounding sliver at the far end
            // from becoming a visible round cap. The visible prefix remains (1-offset)*length.
            let reveal = [stroke.length * 2.; 2];
            let (dashes, offset) = match next {
                DashState::Hidden => (reveal.as_slice(), stroke.length * 2.),
                DashState::Full => (reveal.as_slice(), 0.),
                DashState::Partial(offset) => (reveal.as_slice(), offset),
                DashState::Authored => (stroke.dashes.as_slice(), stroke.offset),
            };
            unsafe {
                check(tvg::tvg_shape_set_stroke_dash(
                    stroke.paint,
                    if dashes.is_empty() {
                        std::ptr::null()
                    } else {
                        dashes.as_ptr()
                    },
                    dashes.len() as u32,
                    offset,
                ))?;
            }
            stroke.shown = next;
        }
        Ok(())
    }
}

fn distance(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn midpoint(a: Point, b: Point) -> Point {
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
}
fn cubic(points: [Point; 4], depth: u8, remaining: &mut usize) -> Result<f64, String> {
    *remaining = remaining
        .checked_sub(1)
        .ok_or("Stroke measurement exceeds the subdivision budget")?;
    let [a, b, c, d] = points;
    let chord = distance(a, d);
    let polygon = distance(a, b) + distance(b, c) + distance(c, d);
    // Chord and control polygon bound the true length. Subdivision narrows that bound,
    // including cusps and loops; the depth/work caps bound hostile input at load time.
    if polygon - chord <= (polygon * 1e-6).max(1e-6) {
        return Ok((polygon + chord) * 0.5);
    }
    if depth == 20 {
        return Err("Stroke measurement did not converge".into());
    }
    let (ab, bc, cd) = (midpoint(a, b), midpoint(b, c), midpoint(c, d));
    let (abc, bcd) = (midpoint(ab, bc), midpoint(bc, cd));
    let center = midpoint(abc, bcd);
    Ok(cubic([a, ab, abc, center], depth + 1, remaining)?
        + cubic([center, bcd, cd, d], depth + 1, remaining)?)
}
fn length(contours: &[Contour], remaining: &mut usize) -> Result<f64, String> {
    let mut total = 0.;
    for contour in contours {
        let mut from = contour.start;
        for segment in &contour.segments {
            total += if segment.line {
                distance(from, segment.to)
            } else {
                cubic([from, segment.c1, segment.c2, segment.to], 0, remaining)?
            };
            from = segment.to;
        }
        if contour.closed {
            total += distance(from, contour.start);
        }
    }
    if !total.is_finite() || total > 1e9 {
        return Err("Stroke length exceeds the renderer numeric budget".into());
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cubic_lengths_cover_straight_curved_and_reversing_paths() {
        for (points, expected) in [
            ([[0., 0.], [1., 0.], [2., 0.], [3., 0.]], 3.),
            ([[0., 0.], [0., 1.], [1., 1.], [1., 0.]], 2.),
            ([[0., 0.], [1., 0.], [-1., 0.], [0., 0.]], 2. / 3_f64.sqrt()),
        ] {
            assert!((cubic(points, 0, &mut 10000).unwrap() - expected).abs() < 1e-5);
        }
        assert!(cubic([[0., 0.], [0., 1.], [1., 1.], [1., 0.]], 0, &mut 1).is_err());
    }
}
