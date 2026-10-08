use crate::{
    pose::Point,
    program::{Rig, Score},
};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Part {
    pub id: String,
    pub bounds: [f64; 4],
    pub pivot: Point,
    pub parent: Option<usize>,
    pub chain: Vec<usize>,
    pub carried: Vec<usize>,
    pub children: Vec<usize>,
    pub strength: f64,
    pub hidden: bool,
}
#[derive(Debug, Clone)]
pub struct RigView {
    pub parts: Vec<Part>,
    pub width: f64,
    pub height: f64,
    ids: BTreeMap<String, usize>,
}
impl RigView {
    pub fn new(score: &Score, rig: &Rig) -> Result<Self, String> {
        let mut ids = BTreeMap::new();
        let mut records = Vec::new();
        for p in &rig.parts {
            records.push((p.id.clone(), p.r#box, p.parent.clone(), None));
        }
        for p in &rig.parts {
            for (index, bounds) in p.children.as_deref().unwrap_or_default().iter().enumerate() {
                records.push((
                    format!("{}__c{index}", p.id),
                    *bounds,
                    Some(p.id.clone()),
                    Some(p.id.clone()),
                ));
            }
        }
        for (index, (id, _, _, _)) in records.iter().enumerate() {
            if ids.insert(id.clone(), index).is_some() {
                return Err(format!("Duplicate rig handle: {id}"));
            }
        }
        let mut parents = Vec::new();
        let mut drawn = Vec::new();
        for (id, _, parent, _) in &records {
            let lookup = |name: Option<&String>| {
                name.map(|name| {
                    ids.get(name)
                        .copied()
                        .ok_or_else(|| format!("Missing carrier: {name}"))
                })
                .transpose()
            };
            drawn.push(lookup(parent.as_ref())?);
            parents.push(lookup(
                score
                    .attach
                    .as_ref()
                    .and_then(|a| a.get(id))
                    .or(parent.as_ref()),
            )?);
        }
        let attached_chains = chains(&parents)?;
        let drawn_chains = chains(&drawn)?;
        let parts = records
            .iter()
            .enumerate()
            .map(|(index, (id, bounds, _, child_of))| {
                let gain = score
                    .part_gain
                    .as_ref()
                    .and_then(|g| {
                        g.get(id)
                            .or_else(|| child_of.as_ref().and_then(|p| g.get(p)))
                    })
                    .copied()
                    .unwrap_or(1.);
                let pivot = score
                    .pivots
                    .as_ref()
                    .and_then(|p| p.get(id))
                    .copied()
                    .unwrap_or([bounds[0] + bounds[2] / 2., bounds[1] + bounds[3] / 2.]);
                let attached = score.attach.as_ref().is_some_and(|a| a.contains_key(id));
                Part {
                    id: id.clone(),
                    bounds: *bounds,
                    pivot,
                    parent: parents[index],
                    chain: attached_chains[index].clone(),
                    carried: if attached {
                        attached_chains[index]
                            .iter()
                            .copied()
                            .filter(|p| !drawn_chains[index].contains(p))
                            .collect()
                    } else {
                        Vec::new()
                    },
                    children: records
                        .iter()
                        .enumerate()
                        .filter_map(|(i, (_, _, _, p))| (p.as_ref() == Some(id)).then_some(i))
                        .collect(),
                    strength: score.liveliness.unwrap_or(1.) * gain,
                    hidden: score
                        .hidden
                        .as_ref()
                        .is_some_and(|hidden| hidden.contains(id)),
                }
            })
            .collect();
        Ok(Self {
            parts,
            ids,
            width: rig.width,
            height: rig.height,
        })
    }
    pub fn index(&self, id: &str) -> Result<usize, String> {
        self.ids
            .get(id)
            .copied()
            .ok_or_else(|| format!("Unknown part: {id}"))
    }
    pub fn center(&self, part: usize) -> Point {
        let b = self.parts[part].bounds;
        [b[0] + b[2] / 2., b[1] + b[3] / 2.]
    }
}
fn chains(parents: &[Option<usize>]) -> Result<Vec<Vec<usize>>, String> {
    let mut result = Vec::with_capacity(parents.len());
    for index in 0..parents.len() {
        let mut chain = Vec::new();
        let mut next = parents[index];
        while let Some(parent) = next {
            if parent == index || chain.contains(&parent) {
                return Err("Cyclic carrier graph".into());
            }
            chain.push(parent);
            next = parents[parent];
        }
        chain.reverse();
        result.push(chain);
    }
    Ok(result)
}
