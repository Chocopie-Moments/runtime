//! Named selection follows authored paints, not generated effects or rig rectangles.
//! Intersections use the prepared renderer's one-pixel coverage. Mask geometry is gated
//! separately because ThorVG's intersection API does not apply alpha compositing.
use crate::{
    scene::{Node, Paint, Part},
    tvg::{self, Raw},
};
use choco_core::player::Player;

pub struct NodeHit {
    pub parent: Option<usize>,
    pub source: bool,
    pub shape: Option<Raw>,
    pub mask: Option<usize>,
    pub children: Vec<usize>,
    part: Option<Part>,
    bindings: Vec<usize>,
    displayed: bool,
    opacity: f64,
    painted: bool,
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
impl NodeHit {
    pub fn new(
        node: &Node,
        player: &Player,
        parent: Option<usize>,
        source: bool,
    ) -> Result<Self, String> {
        Ok(Self {
            parent,
            source,
            shape: None,
            mask: None,
            children: Vec::new(),
            part: node.part.clone(),
            bindings: node
                .bindings
                .iter()
                .map(|id| player.compiled.view.index(id))
                .collect::<Result<_, _>>()?,
            displayed: node.displayed,
            opacity: node.opacity,
            painted: node.visible
                && node.shape.as_ref().is_some_and(|shape| {
                    painted(&shape.fill) || (shape.stroke_width > 0. && painted(&shape.stroke))
                }),
        })
    }
    fn opacity(&self, player: &Player) -> f64 {
        if !self.displayed {
            return 0.;
        }
        self.bindings
            .iter()
            .fold(tvg::byte(self.opacity) as f64 / 255., |opacity, &part| {
                opacity * tvg::byte(player.opacity(part)) as f64 / 255.
            })
    }
    fn shape_intersects(&self, x: i32, y: i32) -> bool {
        self.painted
            && self.shape.is_some_and(|paint| unsafe {
                tvg::tvg_paint_intersects_region(paint, x, y, 1, 1, true)
            })
    }
}
fn mask_intersects(nodes: &[NodeHit], index: usize, player: &Player, x: i32, y: i32) -> bool {
    let node = &nodes[index];
    node.opacity(player) > 0.
        && node
            .mask
            .is_none_or(|mask| mask_intersects(nodes, mask, player, x, y))
        && (node.shape_intersects(x, y)
            || node
                .children
                .iter()
                .any(|&child| mask_intersects(nodes, child, player, x, y)))
}
/// Paint-order traversal finds the topmost authored shape and its nearest named owner.
pub fn hit_test<'a>(nodes: &'a [NodeHit], player: &Player, x: i32, y: i32) -> Option<&'a Part> {
    for (index, node) in nodes.iter().enumerate().rev() {
        if !node.source || !node.shape_intersects(x, y) {
            continue;
        }
        let mut next = Some(index);
        let mut opacity = 1.;
        let mut owner = None;
        let mut owner_found = false;
        while let Some(index) = next {
            let ancestor = &nodes[index];
            opacity *= ancestor.opacity(player);
            if opacity < 0.5 / 255.
                || ancestor
                    .mask
                    .is_some_and(|mask| !mask_intersects(nodes, mask, player, x, y))
            {
                break;
            }
            if !owner_found && let Some(part) = &ancestor.part {
                owner_found = true;
                if !part.background {
                    owner = Some(part);
                }
            }
            next = ancestor.parent;
        }
        if next.is_none()
            && let Some(owner) = owner
        {
            return Some(owner);
        }
    }
    None
}
