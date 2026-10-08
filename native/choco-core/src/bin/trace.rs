use choco_core::{
    behaviors,
    ease::Ease,
    follow, motion,
    pose::{LOOP_WINDOW, Pose},
    program::{Ambient, Beat, Rig, Score},
    rig::RigView,
    score::CompiledScore,
    sequence::CompiledSequence,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{self, Read},
};

#[derive(Deserialize)]
struct Case {
    rig: Rig,
    score: Score,
    times: Vec<f64>,
    #[serde(default)]
    ambient: Vec<Ambient>,
    #[serde(default)]
    beats: Vec<Beat>,
}
fn sequence_trace(sequence: Option<&CompiledSequence>, view: &RigView, times: &[f64]) -> Value {
    let Some(s) = sequence else {
        return Value::Null;
    };
    let poses = |layer: &motion::Motion| {
        layer
            .iter()
            .map(|(part, f)| {
                (
                    view.parts[*part].id.clone(),
                    times.iter().map(|t| f(*t)).collect::<Vec<_>>(),
                )
            })
            .collect::<BTreeMap<_, _>>()
    };
    json!({"duration": s.duration, "moved": s.moved, "hold": s.hold, "spins": s.spins.iter().map(|p| &view.parts[*p].id).collect::<Vec<_>>(), "parts": poses(&s.parts), "follow": poses(&s.follow),
        "held": times.iter().map(|t| s.hold_at(*t).into_iter().map(|(p, pose)| (view.parts[p].id.clone(), pose)).collect::<BTreeMap<_, _>>()).collect::<Vec<_>>(),
        "visibility": s.visibility.iter().map(|(p, steps)| (view.parts[*p].id.clone(), [0., 0.3, 1.].iter().map(|baseline| times.iter().map(|t| choco_core::visibility::at(steps, *baseline, *t)).collect::<Vec<_>>()).collect::<Vec<_>>())).collect::<BTreeMap<_, _>>(),
        "particles": s.particles.iter().map(|p| json!({"shape":p.shape,"color":p.color,"size":p.size,"delay":p.delay,"duration":p.duration,"keys":p.keyframes(),"poses":times.iter().map(|t|p.at(t.clamp(0.,1.))).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "flows": s.flows.iter().map(|f| json!({"part":view.parts[f.part].id,"delay":f.delay,"duration":f.duration,"poses":times.iter().map(|t|f.at(t.clamp(0.,1.))).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "draws": s.draws.iter().map(|d|json!({"part":view.parts[d.part].id,"delay":d.delay,"duration":d.duration,"on":d.on})).collect::<Vec<_>>()
    })
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().take(2_097_153).read_to_string(&mut input)?;
    if input.len() > 2_097_152 {
        return Err("Trace input exceeds limit".into());
    }
    let cases: Vec<Case> = serde_json::from_str(&input)?;
    let mut result = Vec::<Value>::new();
    for case in cases {
        let view = RigView::new(&case.score, &case.rig)?;
        let ambient =
            motion::ambient_layer(&view, case.score.ambient.as_deref().unwrap_or_default())?;
        let follows = follow::solve(
            &view,
            case.score.follow.as_deref().unwrap_or_default(),
            &ambient,
            LOOP_WINDOW,
            true,
        )?;
        let poses = |layer: &motion::Motion| {
            layer
                .iter()
                .map(|(part, f)| {
                    (
                        view.parts[*part].id.clone(),
                        case.times.iter().map(|t| f(*t)).collect::<Vec<_>>(),
                    )
                })
                .collect::<BTreeMap<_, _>>()
        };
        let compiled = CompiledScore::new(case.score.clone(), &case.rig)?;
        let from = compiled
            .view
            .parts
            .iter()
            .enumerate()
            .map(|(i, _)| {
                (
                    i,
                    Pose {
                        x: 13.,
                        y: -7.,
                        r: 19.,
                        sx: 1.2,
                        sy: 0.8,
                        o: 1.,
                    },
                )
            })
            .collect();
        let mut states = BTreeMap::new();
        for name in case
            .score
            .states
            .as_ref()
            .map(|s| s.keys().collect::<Vec<_>>())
            .unwrap_or_default()
        {
            states.insert(
                name,
                [
                    sequence_trace(
                        compiled.state(name, &BTreeMap::new())?.enter.as_ref(),
                        &view,
                        &case.times,
                    ),
                    sequence_trace(
                        compiled.state(name, &from)?.enter.as_ref(),
                        &view,
                        &case.times,
                    ),
                ],
            );
        }
        result.push(json!({"sequences": compiled.triggers.iter().map(|(name, s)| (name, sequence_trace(s.as_deref(), &view, &case.times))).collect::<BTreeMap<_, _>>(), "states": states,"ambient": poses(&ambient), "follow": poses(&follows),
            "behaviors": case.ambient.iter().map(|b| { let function = behaviors::ambient(b.clone(), 2, 4); case.times.iter().map(|t| function(*t)).collect::<Vec<_>>() }).collect::<Vec<_>>(),
            "effects": case.beats.iter().map(|b| case.times.iter().map(|t| behaviors::effect(b, t.clamp(0., 1.))).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "entrances": case.beats.iter().map(|b| behaviors::entrance(b).0).collect::<Vec<_>>(),
            "eases": ([Ease::Snap, Ease::Sine, Ease::Linear, Ease::In, Ease::Out, Ease::InOut, Ease::Back, Ease::Spring, Ease::Soft].iter().map(|e| case.times.iter().map(|t| e.at(t.clamp(0., 1.))).collect::<Vec<_>>()).collect::<Vec<_>>()),
            "rest": Pose::default()
        }));
    }
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
