//! The small direct-drawing ABI used from pinned ThorVG 1.2.0. No file loader API is exposed.
use std::{ffi::c_void, ptr::NonNull};
pub type Raw = *mut c_void;
#[repr(C)]
pub struct Matrix(pub [f32; 9]);
#[repr(C)]
pub struct Stop {
    pub offset: f32,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}
unsafe extern "C" {
    pub fn tvg_engine_init(threads: u32) -> u32;
    pub fn tvg_engine_term() -> u32;
    pub fn tvg_swcanvas_create(option: u32) -> Raw;
    pub fn tvg_swcanvas_set_target(
        canvas: Raw,
        pixels: *mut u32,
        stride: u32,
        w: u32,
        h: u32,
        colorspace: u32,
    ) -> u32;
    pub fn tvg_canvas_destroy(canvas: Raw) -> u32;
    pub fn tvg_canvas_add(canvas: Raw, paint: Raw) -> u32;
    pub fn tvg_canvas_update(canvas: Raw) -> u32;
    pub fn tvg_canvas_draw(canvas: Raw, clear: bool) -> u32;
    pub fn tvg_canvas_sync(canvas: Raw) -> u32;
    pub fn tvg_scene_new() -> Raw;
    pub fn tvg_scene_add(scene: Raw, paint: Raw) -> u32;
    pub fn tvg_scene_remove(scene: Raw, paint: Raw) -> u32;
    pub fn tvg_shape_new() -> Raw;
    pub fn tvg_shape_append_rect(
        paint: Raw,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        rx: f32,
        ry: f32,
        cw: bool,
    ) -> u32;
    pub fn tvg_shape_append_circle(paint: Raw, cx: f32, cy: f32, rx: f32, ry: f32, cw: bool)
    -> u32;
    pub fn tvg_shape_move_to(paint: Raw, x: f32, y: f32) -> u32;
    pub fn tvg_shape_line_to(paint: Raw, x: f32, y: f32) -> u32;
    pub fn tvg_shape_cubic_to(
        paint: Raw,
        cx1: f32,
        cy1: f32,
        cx2: f32,
        cy2: f32,
        x: f32,
        y: f32,
    ) -> u32;
    pub fn tvg_shape_close(paint: Raw) -> u32;
    pub fn tvg_shape_set_fill_color(paint: Raw, r: u8, g: u8, b: u8, a: u8) -> u32;
    pub fn tvg_shape_set_stroke_color(paint: Raw, r: u8, g: u8, b: u8, a: u8) -> u32;
    pub fn tvg_shape_set_fill_rule(paint: Raw, rule: u32) -> u32;
    pub fn tvg_shape_set_stroke_width(paint: Raw, width: f32) -> u32;
    pub fn tvg_shape_set_stroke_cap(paint: Raw, cap: u32) -> u32;
    pub fn tvg_shape_set_stroke_join(paint: Raw, join: u32) -> u32;
    pub fn tvg_shape_set_stroke_miterlimit(paint: Raw, limit: f32) -> u32;
    pub fn tvg_shape_set_stroke_dash(
        paint: Raw,
        dashes: *const f32,
        count: u32,
        offset: f32,
    ) -> u32;
    pub fn tvg_paint_intersects_region(
        paint: Raw,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        visible_only: bool,
    ) -> bool;
    pub fn tvg_paint_ref(paint: Raw) -> u16;
    pub fn tvg_paint_unref(paint: Raw, free: bool) -> u16;
    pub fn tvg_paint_set_transform(paint: Raw, matrix: *const Matrix) -> u32;
    pub fn tvg_paint_set_opacity(paint: Raw, opacity: u8) -> u32;
    pub fn tvg_paint_set_visible(paint: Raw, visible: bool) -> u32;
    pub fn tvg_paint_set_mask_method(paint: Raw, mask: Raw, method: u32) -> u32;
    pub fn tvg_linear_gradient_new() -> Raw;
    pub fn tvg_radial_gradient_new() -> Raw;
    pub fn tvg_linear_gradient_set(gradient: Raw, x1: f32, y1: f32, x2: f32, y2: f32) -> u32;
    pub fn tvg_radial_gradient_set(
        gradient: Raw,
        cx: f32,
        cy: f32,
        r: f32,
        fx: f32,
        fy: f32,
        fr: f32,
    ) -> u32;
    pub fn tvg_gradient_set_color_stops(gradient: Raw, stops: *const Stop, count: u32) -> u32;
    pub fn tvg_gradient_set_spread(gradient: Raw, spread: u32) -> u32;
    pub fn tvg_gradient_set_transform(gradient: Raw, matrix: *const Matrix) -> u32;
    pub fn tvg_gradient_del(gradient: Raw) -> u32;
    pub fn tvg_shape_set_gradient(paint: Raw, gradient: Raw) -> u32;
    pub fn tvg_shape_set_stroke_gradient(paint: Raw, gradient: Raw) -> u32;
}
pub fn check(result: u32) -> Result<(), String> {
    if result == 0 {
        Ok(())
    } else {
        Err(format!("Vector renderer error {result}"))
    }
}
pub fn matrix(m: choco_core::pose::Matrix) -> Matrix {
    Matrix([
        m[0] as f32,
        m[2] as f32,
        m[4] as f32,
        m[1] as f32,
        m[3] as f32,
        m[5] as f32,
        0.,
        0.,
        1.,
    ])
}
pub fn byte(v: f64) -> u8 {
    (v.clamp(0., 1.) * 255.).round() as u8
}
pub struct Engine;
// ThorVG's global pool teardown clears only the calling thread's TLS pointer.
// Concurrently live canvases share one rendering thread. Frames need no global lock.
struct EngineLifetime {
    owner: Option<std::thread::ThreadId>,
    users: usize,
    failed: bool,
}
static ENGINE_LIFETIME: std::sync::Mutex<EngineLifetime> = std::sync::Mutex::new(EngineLifetime {
    owner: None,
    users: 0,
    failed: false,
});
impl Engine {
    pub fn new() -> Result<Self, String> {
        let mut lifetime = ENGINE_LIFETIME
            .lock()
            .map_err(|_| "Renderer initialization lock poisoned")?;
        let thread = std::thread::current().id();
        if lifetime.failed {
            return Err("Renderer lifecycle failed; restart the host process".into());
        }
        if lifetime.owner.is_some_and(|owner| owner != thread) {
            return Err("All active Choco renderers must use the same rendering thread".into());
        }
        if lifetime.users == 0 {
            let result = unsafe { tvg_engine_init(0) };
            if result != 0 {
                lifetime.failed = true;
                check(result)?;
            }
        }
        lifetime.owner = Some(thread);
        lifetime.users += 1;
        Ok(Self)
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        let mut lifetime = ENGINE_LIFETIME
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        lifetime.users -= 1;
        if lifetime.users == 0 {
            if unsafe { tvg_engine_term() } == 0 {
                lifetime.owner = None;
            } else {
                lifetime.failed = true;
            }
        }
    }
}
pub struct Paint(NonNull<c_void>);
impl Paint {
    pub fn new(raw: Raw) -> Result<Self, String> {
        let raw = NonNull::new(raw).ok_or("Paint allocation failed")?;
        unsafe {
            tvg_paint_ref(raw.as_ptr());
        }
        Ok(Self(raw))
    }
    pub fn raw(&self) -> Raw {
        self.0.as_ptr()
    }
}
impl Drop for Paint {
    fn drop(&mut self) {
        unsafe {
            tvg_paint_unref(self.raw(), true);
        }
    }
}
pub struct Canvas(NonNull<c_void>);
impl Canvas {
    pub fn new() -> Result<Self, String> {
        let raw = unsafe { tvg_swcanvas_create(1) };
        Ok(Self(NonNull::new(raw).ok_or("Canvas allocation failed")?))
    }
    pub fn raw(&self) -> Raw {
        self.0.as_ptr()
    }
}
impl Drop for Canvas {
    fn drop(&mut self) {
        unsafe {
            tvg_canvas_destroy(self.raw());
        }
    }
}
pub struct Gradient(pub Raw);
impl Drop for Gradient {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                tvg_gradient_del(self.0);
            }
        }
    }
}
