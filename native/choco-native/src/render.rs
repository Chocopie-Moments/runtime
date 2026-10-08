use crate::{
    scene::{Document, Node, Paint, Shape, Stop},
    tvg::{self, Raw, check},
};
use choco_core::{
    player::Player,
    pose::{IDENTITY, Matrix, apply, multiply},
    program::BeatKind,
    tracks::inverse,
};
use std::collections::{BTreeMap, BTreeSet};
struct Binding {
    paint: Raw,
    part: usize,
    local: Matrix,
    transform: Option<[f32; 9]>,
    opacity: Option<u8>,
}
struct ShapePaint {
    paint: Raw,
    fill: Paint,
    stroke: Paint,
}
#[derive(Clone, Copy, PartialEq)]
enum Build {
    Scene,
    CloneRoot,
    CloneChild,
    Mask,
    CloneMask,
}
struct Builder<'a> {
    flows: crate::flows::Flows,
    flow_capacities: BTreeMap<usize, usize>,
    draws: crate::draws::Draws,
    draw_targets: BTreeSet<usize>,
    paints: Vec<tvg::Paint>,
    bindings: Vec<Binding>,
    hit_nodes: Vec<crate::hits::NodeHit>,
    shapes: Vec<ShapePaint>,
    player: &'a Player,
    palette: &'a BTreeMap<String, String>,
}
fn rgba(
    value: [f64; 4],
    role: &Option<String>,
    palette: &BTreeMap<String, String>,
) -> Result<[u8; 4], String> {
    let mut color = value.map(tvg::byte);
    if let Some(role) = role {
        let hex = palette
            .get(role)
            .ok_or_else(|| format!("Missing palette role: {role}"))?;
        if hex.len() != 7 || !hex.is_ascii() || !hex.starts_with('#') {
            return Err("Palette colors must be six-digit hex".into());
        }
        for i in 0..3 {
            color[i] = u8::from_str_radix(&hex[1 + i * 2..3 + i * 2], 16)
                .map_err(|_| "Invalid palette color")?;
        }
    }
    Ok(color)
}
fn enum_value(value: &str, values: &[&str]) -> Result<u32, String> {
    values
        .iter()
        .position(|v| *v == value)
        .map(|i| i as u32)
        .ok_or_else(|| format!("Unknown renderer operation: {value}"))
}
fn apply_paint(
    shape: Raw,
    paint: &Paint,
    stroke: bool,
    palette: &BTreeMap<String, String>,
) -> Result<(), String> {
    unsafe {
        if matches!(paint, Paint::None | Paint::Color { .. }) {
            let color = match paint {
                Paint::Color { rgba: value, role } => rgba(*value, role, palette)?,
                _ => [0; 4],
            };
            let [r, g, b, a] = color;
            return check(if stroke {
                tvg::tvg_shape_set_stroke_color(shape, r, g, b, a)
            } else {
                tvg::tvg_shape_set_fill_color(shape, r, g, b, a)
            });
        }
        let (raw, transform, spread, stops) = match paint {
            Paint::Linear {
                transform,
                spread,
                values,
                stops,
            } => {
                let raw = tvg::tvg_linear_gradient_new();
                if raw.is_null() {
                    return Err("Gradient allocation failed".into());
                }
                let gradient = tvg::Gradient(raw);
                let [x1, y1, x2, y2] = values.map(|v| v as f32);
                check(tvg::tvg_linear_gradient_set(raw, x1, y1, x2, y2))?;
                (gradient, transform, spread, stops)
            }
            Paint::Radial {
                transform,
                spread,
                values,
                stops,
            } => {
                let raw = tvg::tvg_radial_gradient_new();
                if raw.is_null() {
                    return Err("Gradient allocation failed".into());
                }
                let gradient = tvg::Gradient(raw);
                let [cx, cy, r, fx, fy] = values.map(|v| v as f32);
                check(tvg::tvg_radial_gradient_set(raw, cx, cy, r, fx, fy, 0.))?;
                (gradient, transform, spread, stops)
            }
            _ => unreachable!(),
        };
        let mut gradient = raw;
        let colors = stops
            .iter()
            .map(
                |Stop {
                     offset,
                     rgba: value,
                     role,
                 }| {
                    let [r, g, b, a] = rgba(*value, role, palette)?;
                    Ok(tvg::Stop {
                        offset: *offset as f32,
                        r,
                        g,
                        b,
                        a,
                    })
                },
            )
            .collect::<Result<Vec<_>, String>>()?;
        check(tvg::tvg_gradient_set_color_stops(
            gradient.0,
            colors.as_ptr(),
            colors.len() as u32,
        ))?;
        check(tvg::tvg_gradient_set_spread(
            gradient.0,
            enum_value(spread, &["pad", "reflect", "repeat"])?,
        ))?;
        check(tvg::tvg_gradient_set_transform(
            gradient.0,
            &tvg::matrix(*transform),
        ))?;
        check(if stroke {
            tvg::tvg_shape_set_stroke_gradient(shape, gradient.0)
        } else {
            tvg::tvg_shape_set_gradient(shape, gradient.0)
        })?;
        gradient.0 = std::ptr::null_mut();
    }
    Ok(())
}
impl Builder<'_> {
    fn own(&mut self, raw: Raw) -> Result<Raw, String> {
        self.paints.push(tvg::Paint::new(raw)?);
        Ok(raw)
    }
    fn shape(&mut self, spec: &Shape, visible: bool) -> Result<Raw, String> {
        unsafe {
            let raw = self.own(tvg::tvg_shape_new())?;
            for contour in &spec.contours {
                check(tvg::tvg_shape_move_to(
                    raw,
                    contour.start[0] as f32,
                    contour.start[1] as f32,
                ))?;
                for segment in &contour.segments {
                    check(if segment.line {
                        tvg::tvg_shape_line_to(raw, segment.to[0] as f32, segment.to[1] as f32)
                    } else {
                        tvg::tvg_shape_cubic_to(
                            raw,
                            segment.c1[0] as f32,
                            segment.c1[1] as f32,
                            segment.c2[0] as f32,
                            segment.c2[1] as f32,
                            segment.to[0] as f32,
                            segment.to[1] as f32,
                        )
                    })?;
                }
                if contour.closed {
                    check(tvg::tvg_shape_close(raw))?;
                }
            }
            apply_paint(raw, &spec.fill, false, self.palette)?;
            apply_paint(raw, &spec.stroke, true, self.palette)?;
            check(tvg::tvg_shape_set_fill_rule(
                raw,
                enum_value(&spec.fill_rule, &["nonzero", "evenodd"])?,
            ))?;
            check(tvg::tvg_shape_set_stroke_width(
                raw,
                spec.stroke_width as f32,
            ))?;
            check(tvg::tvg_shape_set_stroke_cap(
                raw,
                enum_value(&spec.linecap, &["butt", "round", "square"])?,
            ))?;
            check(tvg::tvg_shape_set_stroke_join(
                raw,
                enum_value(&spec.linejoin, &["miter", "round", "bevel"])?,
            ))?;
            check(tvg::tvg_shape_set_stroke_miterlimit(
                raw,
                spec.miterlimit as f32,
            ))?;
            if !spec.dasharray.is_empty() {
                let dashes = spec.dasharray.iter().map(|v| *v as f32).collect::<Vec<_>>();
                check(tvg::tvg_shape_set_stroke_dash(
                    raw,
                    dashes.as_ptr(),
                    dashes.len() as u32,
                    spec.dashoffset as f32,
                ))?;
            }
            check(tvg::tvg_paint_set_visible(raw, visible))?;
            self.shapes.push(ShapePaint {
                paint: raw,
                fill: spec.fill.clone(),
                stroke: spec.stroke.clone(),
            });
            Ok(raw)
        }
    }
    fn node(
        &mut self,
        node: &Node,
        parent: Matrix,
        mode: Build,
        ancestors: &[usize],
        parent_hit: Option<usize>,
    ) -> Result<Raw, String> {
        let hit = if matches!(mode, Build::Scene | Build::Mask) {
            let index = self.hit_nodes.len();
            self.hit_nodes.push(crate::hits::NodeHit::new(
                node,
                self.player,
                parent_hit,
                mode == Build::Scene,
            )?);
            if let Some(parent) = parent_hit {
                self.hit_nodes[parent].children.push(index);
            }
            Some(index)
        } else {
            None
        };
        let mut targets = ancestors.to_vec();
        if mode == Build::Scene {
            for id in &node.bindings {
                let part = self.player.compiled.view.index(id)?;
                if self.draw_targets.contains(&part) {
                    targets.push(part);
                }
            }
        }
        unsafe {
            let paint = self.own(tvg::tvg_scene_new())?;
            check(tvg::tvg_paint_set_transform(
                paint,
                &tvg::matrix(node.transform),
            ))?;
            let hidden = mode == Build::CloneChild
                && node.bindings.iter().any(|id| {
                    let part = &self.player.compiled.view.parts[self
                        .player
                        .compiled
                        .view
                        .index(id)
                        .expect("validated binding")];
                    part.hidden
                        || part
                            .carried
                            .iter()
                            .any(|index| self.player.compiled.view.parts[*index].hidden)
                });
            check(tvg::tvg_paint_set_opacity(
                paint,
                if hidden { 0 } else { tvg::byte(node.opacity) },
            ))?;
            check(tvg::tvg_paint_set_visible(paint, node.displayed))?;
            if let Some(shape) = &node.shape {
                let raw = self.shape(shape, node.visible)?;
                if let Some(hit) = hit {
                    self.hit_nodes[hit].shape = Some(raw);
                }
                if mode == Build::Scene {
                    self.draws.add(raw, shape, &targets)?;
                }
                check(tvg::tvg_scene_add(paint, raw))?;
            }
            let world = multiply(parent, node.transform);
            for child in &node.children {
                let child = self.node(
                    child,
                    world,
                    if mode == Build::CloneRoot {
                        Build::CloneChild
                    } else {
                        mode
                    },
                    &targets,
                    hit,
                )?;
                check(tvg::tvg_scene_add(paint, child))?;
            }
            if let Some(clip) = &node.clip {
                let mask = self.hit_nodes.len();
                let target = self.node(
                    clip,
                    parent,
                    if hit.is_some() {
                        Build::Mask
                    } else {
                        Build::CloneMask
                    },
                    &[],
                    None,
                )?;
                if let Some(hit) = hit {
                    self.hit_nodes[hit].mask = Some(mask);
                }
                check(tvg::tvg_paint_set_transform(
                    target,
                    &tvg::matrix(multiply(node.transform, clip.transform)),
                ))?;
                check(tvg::tvg_paint_set_mask_method(paint, target, 1))?;
            }
            let mut outer = paint;
            if mode == Build::Scene
                && node.bindings.iter().any(|id| {
                    self.flow_capacities.contains_key(
                        &self
                            .player
                            .compiled
                            .view
                            .index(id)
                            .expect("validated binding"),
                    )
                })
            {
                let container = self.own(tvg::tvg_scene_new())?;
                let anchor = self.own(tvg::tvg_scene_new())?;
                check(tvg::tvg_scene_add(container, paint))?;
                check(tvg::tvg_scene_add(container, anchor))?;
                let start = self.flows.slots.len();
                for id in &node.bindings {
                    let part = self.player.compiled.view.index(id)?;
                    let count = self.flow_capacities.get(&part).copied().unwrap_or(0);
                    for _ in 0..count {
                        let clone = self.node(node, parent, Build::CloneRoot, &[], None)?;
                        let holder = self.own(tvg::tvg_scene_new())?;
                        check(tvg::tvg_scene_add(holder, clone))?;
                        check(tvg::tvg_paint_set_opacity(holder, 0))?;
                        let local = inverse(parent).ok_or("A flow parent transform is singular")?;
                        let pivot = apply(local, self.player.compiled.view.parts[part].pivot);
                        self.flows
                            .slots
                            .push(crate::flows::Slot::new(holder, part, pivot));
                    }
                }
                self.flows
                    .anchors
                    .push((anchor, start..self.flows.slots.len()));
                outer = container;
            }
            if mode == Build::Scene {
                for id in &node.bindings {
                    let part = self.player.compiled.view.index(id)?;
                    let wrapper = self.own(tvg::tvg_scene_new())?;
                    check(tvg::tvg_scene_add(wrapper, outer))?;
                    self.bindings.push(Binding {
                        paint: wrapper,
                        part,
                        local: inverse(parent).ok_or("An animated parent transform is singular")?,
                        transform: None,
                        opacity: None,
                    });
                    outer = wrapper;
                }
            }
            Ok(outer)
        }
    }
}
/// Borrowed pixels and whether the host needs to present a new image.
pub struct Frame<'a> {
    pub pixels: &'a [u32],
    /// False means the previous pixels can be presented without another host copy.
    pub changed: bool,
}
/// Owns a retained scene and one pixel buffer. All methods run on the host's rendering thread.
pub struct Renderer {
    canvas: tvg::Canvas,
    paints: Vec<tvg::Paint>,
    bindings: Vec<Binding>,
    hit_nodes: Vec<crate::hits::NodeHit>,
    shapes: Vec<ShapePaint>,
    pixels: Vec<u32>,
    particles: crate::particles::Particles,
    flows: crate::flows::Flows,
    draws: crate::draws::Draws,
    palette: BTreeMap<String, String>,
    width: u32,
    height: u32,
    viewport: Raw,
    view_box: [f64; 4],
    selection: crate::selection::Selection,
    dirty: bool,
    _engine: tvg::Engine,
}
impl Renderer {
    pub fn new(
        document: &Document,
        player: &Player,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        document.validate()?;
        let score = &player.compiled.score;
        let sequences = [
            score.enter.as_ref(),
            score.hover.as_ref(),
            score.click.as_ref(),
        ]
        .into_iter()
        .flatten()
        .chain(
            score
                .states
                .iter()
                .flat_map(|states| states.values())
                .filter_map(|state| state.enter.as_ref()),
        );
        let mut draw_targets = BTreeSet::new();
        for beat in sequences.flat_map(|sequence| &sequence.beats) {
            if matches!(beat.kind, BeatKind::DrawOn | BeatKind::DrawOff) {
                draw_targets.insert(
                    player
                        .compiled
                        .view
                        .index(beat.part.as_deref().ok_or("Draw target is missing")?)?,
                );
            }
        }
        let flow_capacities = crate::flows::capacities(&document.score, &document.scene.root)?
            .into_iter()
            .map(|(id, count)| Ok((player.compiled.view.index(&id)?, count)))
            .collect::<Result<BTreeMap<_, _>, String>>()?;
        let engine = tvg::Engine::new()?;
        let canvas = tvg::Canvas::new()?;
        let mut builder = Builder {
            flows: crate::flows::Flows::new(),
            flow_capacities,
            draws: crate::draws::Draws::new(if draw_targets.is_empty() {
                0
            } else {
                player.compiled.view.parts.len()
            }),
            draw_targets,
            paints: Vec::new(),
            bindings: Vec::new(),
            hit_nodes: Vec::new(),
            shapes: Vec::new(),
            player,
            palette: &document.palette,
        };
        let root = builder.node(&document.scene.root, IDENTITY, Build::Scene, &[], None)?;
        let viewport = unsafe { builder.own(tvg::tvg_scene_new())? };
        let particles = crate::particles::Particles::new()?;
        unsafe {
            check(tvg::tvg_scene_add(viewport, root))?;
            check(tvg::tvg_scene_add(viewport, particles.raw()))?;
            check(tvg::tvg_canvas_add(canvas.raw(), viewport))?;
        }
        let mut value = Self {
            canvas,
            paints: builder.paints,
            bindings: builder.bindings,
            hit_nodes: builder.hit_nodes,
            shapes: builder.shapes,
            pixels: Vec::new(),
            particles,
            draws: builder.draws,
            flows: builder.flows,
            palette: document.palette.clone(),
            width: 0,
            height: 0,
            viewport,
            view_box: document.scene.view_box,
            selection: crate::selection::Selection::new(&document.scene.root, player)?,
            dirty: true,
            _engine: engine,
        };
        value.resize(width, height)?;
        Ok(value)
    }
    /// Coverage of the last synchronized frame, with separate authored mask geometry gates.
    /// One-pixel intersections do not reproduce blending or fractional alpha composition.
    pub fn hit_test(&self, player: &Player, x: f64, y: f64) -> Option<&crate::scene::Part> {
        if !x.is_finite()
            || !y.is_finite()
            || x < 0.
            || y < 0.
            || x >= self.width as f64
            || y >= self.height as f64
        {
            return None;
        }
        crate::hits::hit_test(&self.hit_nodes, player, x.floor() as i32, y.floor() as i32)
    }
    pub fn selection(&self, player: &Player) -> Result<Vec<crate::selection::PartBounds>, String> {
        self.selection.evaluate(player)
    }
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), String> {
        if width == 0
            || height == 0
            || width > 4096
            || height > 4096
            || u64::from(width) * u64::from(height) > 4_194_304
        {
            return Err("Render dimensions exceed the pixel budget".into());
        }
        if (width, height) == (self.width, self.height) {
            return Ok(());
        }
        let [x, y, w, h] = self.view_box;
        let scale = (width as f64 / w).min(height as f64 / h);
        let matrix = [
            scale,
            0.,
            0.,
            scale,
            (width as f64 - w * scale) / 2. - x * scale,
            (height as f64 - h * scale) / 2. - y * scale,
        ];
        if matrix
            .iter()
            .any(|value| !value.is_finite() || value.abs() > 1e9)
        {
            return Err("Viewport exceeds the renderer numeric budget".into());
        }
        // Validate before changing the buffer or touching the C renderer. A finite, positive
        // viewBox can still overflow during fitting, or exceed the backend's numeric range.
        self.dirty = true;
        self.pixels.resize(width as usize * height as usize, 0);
        unsafe {
            check(tvg::tvg_swcanvas_set_target(
                self.canvas.raw(),
                self.pixels.as_mut_ptr(),
                width,
                width,
                height,
                0,
            ))?;
            check(tvg::tvg_paint_set_transform(
                self.viewport,
                &tvg::matrix(matrix),
            ))?;
        }
        self.width = width;
        self.height = height;
        Ok(())
    }
    pub fn render(&mut self, player: &Player) -> Result<Frame<'_>, String> {
        self.particles
            .update(player, &self.palette, &mut self.dirty)?;
        self.draws.update(player, &mut self.dirty)?;
        self.flows.update(player, &mut self.dirty)?;
        for binding in &mut self.bindings {
            let matrix = player.matrix(binding.part, |part| {
                apply(binding.local, player.compiled.view.parts[part].pivot)
            });
            let opacity = player.opacity(binding.part);
            if matrix
                .iter()
                .any(|value| !value.is_finite() || value.abs() > 1e9)
                || !opacity.is_finite()
            {
                return Err("Animated geometry exceeds the renderer numeric budget".into());
            }
            // Compare the actual backend representation, without adding an approximation.
            let matrix = tvg::matrix(matrix);
            let opacity = tvg::byte(opacity);
            if binding.transform != Some(matrix.0) {
                self.dirty = true;
                unsafe {
                    check(tvg::tvg_paint_set_transform(binding.paint, &matrix))?;
                }
                binding.transform = Some(matrix.0);
            }
            if binding.opacity != Some(opacity) {
                self.dirty = true;
                unsafe {
                    check(tvg::tvg_paint_set_opacity(binding.paint, opacity))?;
                }
                binding.opacity = Some(opacity);
            }
        }
        if !self.dirty {
            return Ok(Frame {
                pixels: &self.pixels,
                changed: false,
            });
        }
        unsafe {
            check(tvg::tvg_canvas_update(self.canvas.raw()))?;
            check(tvg::tvg_canvas_draw(self.canvas.raw(), true))?;
            check(tvg::tvg_canvas_sync(self.canvas.raw()))?;
        }
        self.dirty = false;
        Ok(Frame {
            pixels: &self.pixels,
            changed: true,
        })
    }
    pub fn set_palette(&mut self, palette: &BTreeMap<String, String>) -> Result<(), String> {
        crate::codec::palette(palette)?;
        self.dirty = true;
        for shape in &self.shapes {
            apply_paint(shape.paint, &shape.fill, false, palette)?;
            apply_paint(shape.paint, &shape.stroke, true, palette)?;
        }
        self.particles.set_palette(palette)?;
        self.palette.clone_from(palette);
        Ok(())
    }
    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }
    pub fn retained_paints(&self) -> usize {
        self.paints.len() + self.particles.retained_paints()
    }
}
