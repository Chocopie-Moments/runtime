use crate::{
    ease::Ease,
    pose::{Point, Pose},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/** Optional means absent; explicit null is accepted only by nullable contract fields. */
pub fn optional<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    de: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(de).map(Some)
}
fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    de: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(de)
}

pub fn integer_u32<'de, D: serde::Deserializer<'de>>(de: D) -> Result<u32, D::Error> {
    let value = f64::deserialize(de)?;
    if value.is_finite() && value.fract() == 0. && value >= 0. && value <= u32::MAX as f64 {
        Ok(value as u32)
    } else {
        Err(serde::de::Error::custom(
            "Expected a nonnegative 32-bit integer",
        ))
    }
}
pub fn integer_usize<'de, D: serde::Deserializer<'de>>(de: D) -> Result<usize, D::Error> {
    integer_u32(de).map(|value| value as usize)
}
fn count<'de, D: serde::Deserializer<'de>>(de: D) -> Result<Option<usize>, D::Error> {
    integer_usize(de).map(Some)
}
fn seed<'de, D: serde::Deserializer<'de>>(de: D) -> Result<Option<u32>, D::Error> {
    integer_u32(de).map(Some)
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PoseInput {
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}
impl PoseInput {
    pub fn pose(&self) -> Pose {
        Pose {
            x: self.x.unwrap_or(0.),
            y: self.y.unwrap_or(0.),
            r: self.rotate.unwrap_or(0.),
            sx: self.scale.unwrap_or(1.) * self.scale_x.unwrap_or(1.),
            sy: self.scale.unwrap_or(1.) * self.scale_y.unwrap_or(1.),
            o: self.opacity.unwrap_or(1.),
        }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(from = "KeyData")]
pub struct Key {
    pub t: f64,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ease: Option<Ease>,
    #[serde(flatten)]
    pub pose: PoseInput,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyData {
    t: f64,
    #[serde(default, deserialize_with = "optional")]
    ease: Option<Ease>,
    #[serde(default, deserialize_with = "optional")]
    x: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    y: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    rotate: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    scale: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    scale_x: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    scale_y: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    opacity: Option<f64>,
}
impl From<KeyData> for Key {
    fn from(k: KeyData) -> Self {
        Self {
            t: k.t,
            ease: k.ease,
            pose: PoseInput {
                x: k.x,
                y: k.y,
                rotate: k.rotate,
                scale: k.scale,
                scale_x: k.scale_x,
                scale_y: k.scale_y,
                opacity: k.opacity,
            },
        }
    }
}
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AmbientKind {
    Keys,
    Float,
    Bob,
    Sway,
    Drift,
    Breathe,
    Pulse,
    Spin,
    Orbit,
    Flicker,
    Blink,
    Twinkle,
    Stream,
    Bounce,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Ambient {
    #[serde(rename = "do")]
    pub kind: AmbientKind,
    pub part: String,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deg: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fade: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dim: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dx: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dy: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stagger: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reverse: Option<bool>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keys: Option<Vec<Key>>,
}
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BeatKind {
    Pop,
    Drop,
    Rise,
    SlideIn,
    FadeIn,
    Grow,
    Unfold,
    To,
    Travel,
    Show,
    Hide,
    FadeOut,
    Wave,
    Wiggle,
    Shake,
    Nod,
    Hop,
    Squash,
    Pulse,
    Spin,
    Lift,
    Burst,
    Flow,
    DrawOn,
    DrawOff,
}
impl BeatKind {
    pub fn entrance(self) -> bool {
        matches!(
            self,
            Self::Pop
                | Self::Drop
                | Self::Rise
                | Self::SlideIn
                | Self::FadeIn
                | Self::Grow
                | Self::Unfold
        )
    }
    pub fn effect(self) -> bool {
        matches!(
            self,
            Self::Wave
                | Self::Wiggle
                | Self::Shake
                | Self::Nod
                | Self::Hop
                | Self::Squash
                | Self::Pulse
                | Self::Spin
                | Self::Lift
        )
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Beat {
    #[serde(rename = "do")]
    pub kind: BeatKind,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dur: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ease: Option<Ease>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deg: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub times: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub px: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub squash: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turns: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<Point>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Point>>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pose: Option<PoseInput>,
    #[serde(default, deserialize_with = "count")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors: Option<Vec<String>>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shapes: Option<Vec<String>>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spread: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gravity: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stagger: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_scale: Option<f64>,
    #[serde(default, deserialize_with = "seed")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<u32>,
}
impl Beat {
    pub fn start(&self) -> f64 {
        self.at.unwrap_or(0.)
    }
    pub fn duration(&self) -> f64 {
        self.dur.unwrap_or(0.6)
    }
}
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Sequence {
    pub beats: Vec<Beat>,
}
#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum FollowMode {
    #[default]
    Pendulum,
    Lean,
    Stretch,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Follow {
    pub part: String,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<FollowMode>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub damping: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drag: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain_x: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain_y: Option<f64>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppState {
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enter: Option<Sequence>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ambient: Option<Vec<Ambient>>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Look {
    pub parts: Vec<String>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<f64>,
}
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Score {
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pivots: Option<BTreeMap<String, Point>>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attach: Option<BTreeMap<String, String>>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<Vec<String>>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ambient: Option<Vec<Ambient>>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow: Option<Vec<Follow>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enter: Option<Sequence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover: Option<Sequence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub click: Option<Sequence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub look: Option<Look>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub states: Option<BTreeMap<String, AppState>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_state: Option<String>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_gain: Option<BTreeMap<String, f64>>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub liveliness: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RigPart {
    pub id: String,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(deserialize_with = "nullable")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub r#box: [f64; 4],
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<bool>,
    #[serde(default, deserialize_with = "optional")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<[f64; 4]>>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rig {
    pub width: f64,
    pub height: f64,
    pub parts: Vec<RigPart>,
}
