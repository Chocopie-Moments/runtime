use crate::scene::{Document, Node, Paint};
use choco_core::{
    pose::{IDENTITY, Matrix, multiply},
    validation::identifier,
};
use std::collections::BTreeSet;
fn range(value: f64, min: f64, max: f64) -> Result<(), String> {
    if value.is_finite() && value >= min && value <= max {
        Ok(())
    } else {
        Err("Scene value exceeds its numeric range".into())
    }
}
fn coordinates(values: &[f64]) -> Result<(), String> {
    for value in values {
        range(*value, -1_000_000., 1_000_000.)?;
    }
    Ok(())
}
fn color(rgba: &[f64; 4], role: &Option<String>) -> Result<(), String> {
    for channel in rgba {
        range(*channel, 0., 1.)?;
    }
    if role
        .as_ref()
        .is_some_and(|role| !["accent", "secondary", "ink", "background"].contains(&role.as_str()))
    {
        return Err("Unknown palette role".into());
    }
    Ok(())
}
fn paint(value: &Paint, count: &mut usize) -> Result<(), String> {
    match value {
        Paint::None => Ok(()),
        Paint::Color { rgba, role } => color(rgba, role),
        Paint::Linear {
            transform,
            spread,
            stops,
            ..
        }
        | Paint::Radial {
            transform,
            spread,
            stops,
            ..
        } => {
            coordinates(transform)?;
            match value {
                Paint::Linear { values, .. } => coordinates(values)?,
                Paint::Radial { values, .. } => {
                    coordinates(values)?;
                    range(values[2], f64::from_bits(1), 1_000_000.)?;
                }
                _ => unreachable!(),
            }
            *count += stops.len();
            if stops.is_empty()
                || stops.len() > 256
                || *count > 8192
                || !["pad", "repeat", "reflect"].contains(&spread.as_str())
            {
                return Err("Invalid gradient or gradient budget exceeded".into());
            }
            let mut previous = 0.;
            for stop in stops {
                range(stop.offset, previous, 1.)?;
                previous = stop.offset;
                color(&stop.rgba, &stop.role)?;
            }
            Ok(())
        }
    }
}
struct Budget {
    nodes: usize,
    contours: usize,
    segments: usize,
    stops: usize,
    found: BTreeSet<String>,
    named: BTreeSet<String>,
}
impl Budget {
    fn node(
        &mut self,
        node: &Node,
        depth: usize,
        parent: Matrix,
        mask: bool,
        expected: &BTreeSet<String>,
    ) -> Result<(), String> {
        self.nodes += 1;
        if self.nodes > 10_000 || depth > 32 {
            return Err("Scene node/depth limit exceeded".into());
        }
        coordinates(&node.transform)?;
        range(node.opacity, 0., 1.)?;
        let world = multiply(parent, node.transform);
        for value in world {
            range(value, -1e9, 1e9)?;
        }
        if node.bindings.len() > 2 {
            return Err("Too many bindings on a scene node".into());
        }
        if !node.bindings.is_empty()
            && (parent[0] * parent[3] - parent[1] * parent[2]).abs() < 1e-12
        {
            return Err("An animated parent transform is singular".into());
        }
        for id in &node.bindings {
            if mask || !expected.contains(id) || !self.found.insert(id.clone()) {
                return Err(format!("Invalid scene motion binding: {id}"));
            }
        }
        if let Some(part) = &node.part
            && (mask
                || !identifier(&part.id, 80)
                || part.name.is_empty()
                || part.name.encode_utf16().count() > 100
                || !self.named.insert(part.id.clone())
                || !node.bindings.contains(&part.id))
        {
            return Err("Invalid named scene part".into());
        }
        if let Some(shape) = &node.shape {
            if !["nonzero", "evenodd"].contains(&shape.fill_rule.as_str())
                || !["butt", "round", "square"].contains(&shape.linecap.as_str())
                || !["miter", "round", "bevel"].contains(&shape.linejoin.as_str())
            {
                return Err("Unknown shape operation".into());
            }
            range(shape.stroke_width, 0., 1_000_000.)?;
            range(shape.miterlimit, 1., 1_000_000.)?;
            coordinates(&[shape.dashoffset])?;
            if shape.dasharray.len() > 256
                || (!shape.dasharray.is_empty() && !shape.dasharray.iter().any(|v| *v > 0.))
            {
                return Err("Invalid dash pattern".into());
            }
            for value in &shape.dasharray {
                range(*value, 0., 1_000_000.)?;
            }
            paint(&shape.fill, &mut self.stops)?;
            paint(&shape.stroke, &mut self.stops)?;
            self.contours += shape.contours.len();
            for contour in &shape.contours {
                coordinates(&contour.start)?;
                self.segments += contour.segments.len();
                for segment in &contour.segments {
                    coordinates(&segment.c1)?;
                    coordinates(&segment.c2)?;
                    coordinates(&segment.to)?;
                }
            }
            if self.contours > 200_000 || self.segments > 200_000 {
                return Err("Scene path budget exceeded".into());
            }
        }
        for child in &node.children {
            self.node(child, depth + 1, world, mask, expected)?;
        }
        if let Some(clip) = &node.clip {
            self.node(clip, depth + 1, world, true, expected)?;
        }
        Ok(())
    }
}
pub fn validate(document: &Document) -> Result<(), String> {
    crate::codec::palette(&document.palette)?;
    choco_core::validation::validate(&document.score, &document.rig)?;
    let [x, y, width, height] = document.scene.view_box;
    coordinates(&[x, y])?;
    range(width, f64::from_bits(1), 1_000_000.)?;
    range(height, f64::from_bits(1), 1_000_000.)?;
    if width != document.rig.width || height != document.rig.height {
        return Err("Scene and rig dimensions differ".into());
    }
    let expected: BTreeSet<String> = document
        .rig
        .parts
        .iter()
        .flat_map(|part| {
            std::iter::once(part.id.clone()).chain(
                (0..part.children.as_ref().map_or(0, Vec::len))
                    .map(|index| format!("{}__c{index}", part.id)),
            )
        })
        .collect();
    let mut budget = Budget {
        nodes: 0,
        contours: 0,
        segments: 0,
        stops: 0,
        found: BTreeSet::new(),
        named: BTreeSet::new(),
    };
    budget.node(&document.scene.root, 0, IDENTITY, false, &expected)?;
    if budget.found != expected
        || document
            .rig
            .parts
            .iter()
            .any(|part| !budget.named.contains(&part.id))
    {
        return Err("The scene does not bind every rig handle".into());
    }
    crate::flows::capacities(&document.score, &document.scene.root)?;
    Ok(())
}
