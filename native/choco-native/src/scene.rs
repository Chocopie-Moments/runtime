use choco_core::{
    pose::{Matrix, Point},
    program::{Rig, Score},
};
use serde::Deserialize;
use std::collections::BTreeMap;
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Segment {
    pub c1: Point,
    pub c2: Point,
    pub to: Point,
    pub line: bool,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contour {
    pub start: Point,
    pub segments: Vec<Segment>,
    pub closed: bool,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stop {
    pub offset: f64,
    pub rgba: [f64; 4],
    #[serde(default, deserialize_with = "choco_core::program::optional")]
    pub role: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Paint {
    None,
    Color {
        rgba: [f64; 4],
        #[serde(default, deserialize_with = "choco_core::program::optional")]
        role: Option<String>,
    },
    Linear {
        transform: Matrix,
        spread: String,
        values: [f64; 4],
        stops: Vec<Stop>,
    },
    Radial {
        transform: Matrix,
        spread: String,
        values: [f64; 5],
        stops: Vec<Stop>,
    },
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shape {
    pub contours: Vec<Contour>,
    pub fill: Paint,
    pub stroke: Paint,
    pub fill_rule: String,
    pub stroke_width: f64,
    pub linecap: String,
    pub linejoin: String,
    pub miterlimit: f64,
    pub dasharray: Vec<f64>,
    pub dashoffset: f64,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Part {
    pub id: String,
    pub name: String,
    pub background: bool,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Node {
    #[serde(default)]
    pub bindings: Vec<String>,
    pub transform: Matrix,
    pub opacity: f64,
    pub displayed: bool,
    pub visible: bool,
    #[serde(default, deserialize_with = "choco_core::program::optional")]
    pub part: Option<Part>,
    #[serde(default, deserialize_with = "choco_core::program::optional")]
    pub shape: Option<Shape>,
    #[serde(default, deserialize_with = "choco_core::program::optional")]
    pub clip: Option<Box<Node>>,
    pub children: Vec<Node>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub view_box: [f64; 4],
    pub root: Node,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub scene: Scene,
    pub rig: Rig,
    pub score: Score,
    pub palette: BTreeMap<String, String>,
}
impl Document {
    pub fn read(bytes: &[u8]) -> Result<Self, String> {
        crate::codec::decode(bytes)
    }
    pub fn validate(&self) -> Result<(), String> {
        crate::scene_validation::validate(self)
    }
}
