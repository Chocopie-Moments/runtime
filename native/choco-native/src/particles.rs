//! Retained burst geometry. The core supplies sampled motion; this module owns drawing lifetime.
use crate::tvg::{self, check};
use choco_core::{
    emitters::{Particle, ParticlePlayback},
    player::Player,
    sequence::CompiledSequence,
};
use std::{collections::BTreeMap, sync::Arc};

struct Sprite {
    paint: tvg::Paint,
    playback: ParticlePlayback,
    transform: Option<[f32; 9]>,
    opacity: Option<u8>,
}
struct Flight {
    sequence: Arc<CompiledSequence>,
    start: f64,
    state: bool,
    sprites: Vec<Sprite>,
}
pub(crate) struct Particles {
    layer: tvg::Paint,
    flights: Vec<Flight>,
    synchronized: bool,
}
impl Particles {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            layer: tvg::Paint::new(unsafe { tvg::tvg_scene_new() })?,
            flights: Vec::new(),
            synchronized: false,
        })
    }
    pub fn raw(&self) -> tvg::Raw {
        self.layer.raw()
    }
    pub fn retained_paints(&self) -> usize {
        1 + self.flights.iter().map(|f| f.sprites.len()).sum::<usize>()
    }
    pub fn set_palette(&self, palette: &BTreeMap<String, String>) -> Result<(), String> {
        for flight in &self.flights {
            for (sprite, spec) in flight.sprites.iter().zip(&flight.sequence.particles) {
                color(sprite.paint.raw(), &spec.color, palette)?;
            }
        }
        Ok(())
    }
    pub fn update(
        &mut self,
        player: &Player,
        palette: &BTreeMap<String, String>,
        dirty: &mut bool,
    ) -> Result<(), String> {
        let effects = || {
            player
                .effects
                .iter()
                .filter(|e| !e.sequence.particles.is_empty() && player.effect_time(e).is_some())
        };
        let same = self.synchronized
            && self.flights.len() == effects().count()
            && self.flights.iter().zip(effects()).all(|(f, e)| {
                Arc::ptr_eq(&f.sequence, &e.sequence) && f.start == e.start && f.state == e.state
            });
        if !same {
            // At most two live sequences, with at most 16 * 24 particles each. Build only
            // on input changes, never per frame. Owning refs survive removal from the scene.
            let next = effects()
                .map(|effect| {
                    let sprites = effect
                        .sequence
                        .particles
                        .iter()
                        .map(|spec| {
                            let paint = shape(spec)?;
                            color(paint.raw(), &spec.color, palette)?;
                            Ok(Sprite {
                                paint,
                                playback: ParticlePlayback::new(spec),
                                transform: None,
                                opacity: None,
                            })
                        })
                        .collect::<Result<Vec<_>, String>>()?;
                    Ok(Flight {
                        sequence: effect.sequence.clone(),
                        start: effect.start,
                        state: effect.state,
                        sprites,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            *dirty = true;
            self.synchronized = false;
            unsafe {
                check(tvg::tvg_scene_remove(self.raw(), std::ptr::null_mut()))?;
            }
            self.flights = next;
            for flight in &self.flights {
                for sprite in &flight.sprites {
                    unsafe {
                        check(tvg::tvg_scene_add(self.raw(), sprite.paint.raw()))?;
                    }
                }
            }
            self.synchronized = true;
        }
        for (flight, effect) in self.flights.iter_mut().zip(effects()) {
            let time = player.effect_time(effect).expect("filtered active effect");
            for sprite in &mut flight.sprites {
                let pose = sprite.playback.at(time);
                let matrix = pose.matrix([0., 0.]);
                if !pose.finite() || matrix.iter().any(|v| !v.is_finite() || v.abs() > 1e9) {
                    return Err("Particle geometry exceeds the renderer numeric budget".into());
                }
                let matrix = tvg::matrix(matrix);
                let opacity = tvg::byte(pose.o);
                if sprite.transform != Some(matrix.0) {
                    *dirty = true;
                    unsafe {
                        check(tvg::tvg_paint_set_transform(sprite.paint.raw(), &matrix))?;
                    }
                    sprite.transform = Some(matrix.0);
                }
                if sprite.opacity != Some(opacity) {
                    *dirty = true;
                    unsafe {
                        check(tvg::tvg_paint_set_opacity(sprite.paint.raw(), opacity))?;
                    }
                    sprite.opacity = Some(opacity);
                }
            }
        }
        Ok(())
    }
}

fn color(paint: tvg::Raw, value: &str, palette: &BTreeMap<String, String>) -> Result<(), String> {
    let hex = if value.starts_with('#') {
        value
    } else {
        palette.get(value).ok_or("Missing particle palette role")?
    };
    if !choco_core::validation::hex_color(hex) {
        return Err("Invalid particle color".into());
    }
    let channel = |offset| {
        u8::from_str_radix(&hex[offset..offset + 2], 16).map_err(|_| "Invalid particle color")
    };
    unsafe {
        check(tvg::tvg_shape_set_fill_color(
            paint,
            channel(1)?,
            channel(3)?,
            channel(5)?,
            255,
        ))
    }
}

fn shape(spec: &Particle) -> Result<tvg::Paint, String> {
    let paint = tvg::Paint::new(unsafe { tvg::tvg_shape_new() })?;
    let raw = paint.raw();
    let s = spec.size;
    if s == 0. {
        return Ok(paint);
    }
    unsafe {
        match spec.shape.as_str() {
            "circle" => check(tvg::tvg_shape_append_circle(
                raw,
                0.,
                0.,
                (s / 2.) as f32,
                (s / 2.) as f32,
                true,
            ))?,
            "rect" => check(tvg::tvg_shape_append_rect(
                raw,
                (-s / 2.) as f32,
                (-s / 3.) as f32,
                s as f32,
                (s * 2. / 3.) as f32,
                (s / 6.) as f32,
                (s / 6.) as f32,
                true,
            ))?,
            "star" => {
                let k = s * 0.15;
                let mut from = [0., -s];
                check(tvg::tvg_shape_move_to(raw, 0., -s as f32))?;
                for (control, to) in [
                    ([k, -k], [s, 0.]),
                    ([k, k], [0., s]),
                    ([-k, k], [-s, 0.]),
                    ([-k, -k], [0., -s]),
                ] {
                    let c1 = [
                        from[0] + (control[0] - from[0]) * 2. / 3.,
                        from[1] + (control[1] - from[1]) * 2. / 3.,
                    ];
                    let c2 = [
                        to[0] + (control[0] - to[0]) * 2. / 3.,
                        to[1] + (control[1] - to[1]) * 2. / 3.,
                    ];
                    check(tvg::tvg_shape_cubic_to(
                        raw,
                        c1[0] as f32,
                        c1[1] as f32,
                        c2[0] as f32,
                        c2[1] as f32,
                        to[0] as f32,
                        to[1] as f32,
                    ))?;
                    from = to;
                }
                check(tvg::tvg_shape_close(raw))?;
            }
            _ => return Err("Invalid particle shape".into()),
        }
    }
    Ok(paint)
}
