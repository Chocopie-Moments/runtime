use crate::{
    follow,
    motion::{self, Motion},
    pose::{LOOP_WINDOW, Pose},
    program::{Rig, Score},
    rig::RigView,
    sequence::{self, CompiledSequence},
    visibility,
};
use std::{collections::BTreeMap, sync::Arc};

pub struct CompiledState {
    pub enter: Option<CompiledSequence>,
    pub ambient: Motion,
}
pub struct CompiledScore {
    pub view: RigView,
    pub score: Score,
    pub ambient: Motion,
    pub ambient_follow: Motion,
    pub triggers: BTreeMap<String, Option<Arc<CompiledSequence>>>,
    state_only: Vec<usize>,
}
impl CompiledScore {
    pub fn new(score: Score, rig: &Rig) -> Result<Self, String> {
        crate::validation::validate(&score, rig)?;
        let view = RigView::new(&score, rig)?;
        let ambient = motion::ambient_layer(&view, score.ambient.as_deref().unwrap_or_default())?;
        let follows = score.follow.as_deref().unwrap_or_default();
        let ambient_follow = follow::solve(&view, follows, &ambient, LOOP_WINDOW, true)?;
        let mut triggers = BTreeMap::new();
        for (name, sequence) in [
            ("enter", score.enter.as_ref()),
            ("hover", score.hover.as_ref()),
            ("click", score.click.as_ref()),
        ] {
            triggers.insert(
                name.into(),
                sequence::compile(&view, sequence, false, follows, &[], &BTreeMap::new())?
                    .map(Arc::new),
            );
        }
        let enter = triggers.get("enter").and_then(|s| s.as_deref());
        let state_only = view
            .parts
            .iter()
            .enumerate()
            .filter_map(|(index, part)| {
                let resting = enter
                    .and_then(|s| s.visibility.get(&index))
                    .map_or(if part.hidden { 0. } else { 1. }, |steps| {
                        visibility::at(steps, if part.hidden { 0. } else { 1. }, f64::INFINITY)
                    });
                (part.hidden && resting == 0.).then_some(index)
            })
            .collect();
        Ok(Self {
            view,
            score,
            ambient,
            ambient_follow,
            triggers,
            state_only,
        })
    }
    pub fn state(&self, name: &str, from: &BTreeMap<usize, Pose>) -> Result<CompiledState, String> {
        let state = self
            .score
            .states
            .as_ref()
            .and_then(|s| s.get(name))
            .ok_or_else(|| format!("Unknown state: {name}"))?;
        Ok(CompiledState {
            enter: sequence::compile(
                &self.view,
                state.enter.as_ref(),
                true,
                self.score.follow.as_deref().unwrap_or_default(),
                &self.state_only,
                from,
            )?,
            ambient: motion::ambient_layer(
                &self.view,
                state.ambient.as_deref().unwrap_or_default(),
            )?,
        })
    }
}
