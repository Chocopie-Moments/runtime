//! Host selection rectangles use the same wrapper transforms as drawing. Effects have no handles.
use crate::scene::{Node, Paint};
use choco_core::{
    player::Player,
    pose::{IDENTITY, Matrix, apply, multiply},
    tracks::inverse,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct PartBounds {
    id: String,
    name: String,
    bounds: [f64; 4],
    transform: Matrix,
}
pub struct Selection {
    transform: Matrix,
    opacity: f64,
    displayed: bool,
    painted: bool,
    bindings: Vec<usize>,
    part: Option<(usize, String)>,
    children: Vec<Selection>,
}
fn painted(paint: &Paint) -> bool {
    match paint {
        Paint::None => false,
        Paint::Color { rgba, .. } => rgba[3] > 0.,
        Paint::Linear { stops, .. } | Paint::Radial { stops, .. } => {
            stops.iter().any(|stop| stop.rgba[3] > 0.)
        }
    }
}
impl Selection {
    pub fn new(node: &Node, player: &Player) -> Result<Self, String> {
        Ok(Self {
            transform: node.transform,
            opacity: node.opacity,
            displayed: node.displayed,
            painted: node.visible
                && node.shape.as_ref().is_some_and(|shape| {
                    painted(&shape.fill) || (shape.stroke_width > 0. && painted(&shape.stroke))
                }),
            bindings: node
                .bindings
                .iter()
                .map(|id| player.compiled.view.index(id))
                .collect::<Result<_, _>>()?,
            part: node
                .part
                .as_ref()
                .filter(|part| !part.background)
                .map(|part| -> Result<_, String> {
                    Ok((player.compiled.view.index(&part.id)?, part.name.clone()))
                })
                .transpose()?,
            children: node
                .children
                .iter()
                .map(|child| Self::new(child, player))
                .collect::<Result<_, _>>()?,
        })
    }
    pub fn evaluate(&self, player: &Player) -> Result<Vec<PartBounds>, String> {
        let mut result = Vec::new();
        self.visit(player, IDENTITY, IDENTITY, 1., &mut result)?;
        Ok(result)
    }
    fn visit(
        &self,
        player: &Player,
        static_parent: Matrix,
        current_parent: Matrix,
        parent_opacity: f64,
        result: &mut Vec<PartBounds>,
    ) -> Result<bool, String> {
        if !self.displayed {
            return Ok(false);
        }
        let mut opacity = parent_opacity * self.opacity;
        let mut animation = IDENTITY;
        if !self.bindings.is_empty() {
            let local = inverse(static_parent).ok_or("An animated parent transform is singular")?;
            for &part in &self.bindings {
                animation = multiply(
                    player.matrix(part, |index| {
                        apply(local, player.compiled.view.parts[index].pivot)
                    }),
                    animation,
                );
                opacity *= player.opacity(part);
            }
        }
        if opacity < 0.5 / 255. {
            return Ok(false);
        }
        let resting = multiply(static_parent, self.transform);
        let current = multiply(multiply(current_parent, animation), self.transform);
        let position = result.len();
        let mut visible = self.painted;
        for child in &self.children {
            visible |= child.visit(player, resting, current, opacity, result)?;
        }
        if visible
            && let Some((part, name)) = &self.part
            && let Some(resting_inverse) = inverse(resting)
        {
            let delta = multiply(current, resting_inverse);
            let [x, y, w, h] = player.compiled.view.parts[*part].bounds;
            let corners =
                [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(|point| apply(delta, point));
            let left = corners.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
            let top = corners.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
            let right = corners
                .iter()
                .map(|p| p[0])
                .fold(f64::NEG_INFINITY, f64::max);
            let bottom = corners
                .iter()
                .map(|p| p[1])
                .fold(f64::NEG_INFINITY, f64::max);
            let bounds = [left, top, right - left, bottom - top];
            if bounds.iter().any(|v| !v.is_finite() || v.abs() > 1e12) {
                return Err("Selection bounds exceed the numeric budget".into());
            }
            result.insert(
                position,
                PartBounds {
                    id: player.compiled.view.parts[*part].id.clone(),
                    name: name.clone(),
                    bounds,
                    transform: delta,
                },
            );
        }
        Ok(visible)
    }
}
