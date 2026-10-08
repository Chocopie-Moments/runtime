//! Development native drawing backend; release admission requires full player/device conformance.
mod draws;
pub mod ffi;
mod flows;
mod particles;
pub mod render;
pub mod scene;
mod tvg;

mod archive;
mod codec;
mod json;
mod scene_validation;

mod selection;

mod hits;
