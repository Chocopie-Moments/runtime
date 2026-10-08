//! Development C boundary. All active handles share one rendering thread. See include/choco.h.
use crate::{render::Renderer, scene::Document};
use choco_core::player::Player;
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice, str,
};

pub struct ChocoPlayer {
    renderer: Renderer,
    player: Player,
}
/// Decoded immutable asset. Players copy their retained runtime state on creation.
pub struct ChocoAsset {
    document: Document,
    metadata: Vec<u8>,
}

/// # Safety
/// Input/error buffers must be valid for their lengths. Destroy the returned handle once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_asset_create(
    bytes: *const u8,
    length: usize,
    error: *mut u8,
    capacity: usize,
) -> *mut ChocoAsset {
    let result = guarded(|| {
        if bytes.is_null() || length > 1_048_576 {
            return Err("Invalid asset buffer".into());
        }
        let asset = crate::codec::decode_asset(unsafe { slice::from_raw_parts(bytes, length) })?;
        let metadata = asset.metadata()?;
        Ok(Box::into_raw(Box::new(ChocoAsset {
            document: asset.document,
            metadata,
        })))
    });
    match result {
        Ok(asset) => asset,
        Err(message) => {
            unsafe {
                report(&message, error, capacity);
            }
            ptr::null_mut()
        }
    }
}
/// # Safety
/// Asset must be live. Output must be valid for capacity bytes. Returns the required byte count;
/// copies the complete UTF-8 JSON only when capacity is sufficient. No NUL terminator.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_asset_metadata(
    asset: *const ChocoAsset,
    output: *mut u8,
    capacity: usize,
) -> usize {
    let Some(asset) = (unsafe { asset.as_ref() }) else {
        return 0;
    };
    if !output.is_null() && capacity >= asset.metadata.len() {
        unsafe {
            ptr::copy_nonoverlapping(asset.metadata.as_ptr(), output, asset.metadata.len());
        }
    }
    asset.metadata.len()
}
/// # Safety
/// Destroy exactly once, on the owning thread. Existing players remain valid.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_asset_destroy(asset: *mut ChocoAsset) {
    if !asset.is_null() {
        unsafe {
            drop(Box::from_raw(asset));
        }
    }
}
/// # Safety
/// Asset/error buffers must be live. The returned player follows choco_player_create ownership.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_from_asset(
    asset: *const ChocoAsset,
    width: u32,
    height: u32,
    reduced_motion: bool,
    error: *mut u8,
    capacity: usize,
) -> *mut ChocoPlayer {
    let result = guarded(|| {
        let asset = unsafe { asset.as_ref() }.ok_or("Missing asset")?;
        create_player(&asset.document, width, height, reduced_motion)
    });
    match result {
        Ok(player) => player,
        Err(message) => {
            unsafe {
                report(&message, error, capacity);
            }
            ptr::null_mut()
        }
    }
}
fn create_player(
    document: &Document,
    width: u32,
    height: u32,
    reduced_motion: bool,
) -> Result<*mut ChocoPlayer, String> {
    let mut player = Player::new(document.score.clone(), &document.rig, reduced_motion)?;
    player.trigger("enter")?;
    let renderer = Renderer::new(document, &player, width, height)?;
    Ok(Box::into_raw(Box::new(ChocoPlayer { renderer, player })))
}
#[repr(C)]
pub struct ChocoFrame {
    pub pixels: *const u8,
    pub changed: bool,
    pub needs_frame: bool,
    pub time: f64,
}

fn guarded<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(operation))
        .unwrap_or_else(|_| Err("Native player panicked".into()))
}

unsafe fn report(error: &str, output: *mut u8, capacity: usize) {
    if !output.is_null() && capacity > 0 {
        let count = error.len().min(capacity - 1);
        unsafe {
            ptr::copy_nonoverlapping(error.as_ptr(), output, count);
            *output.add(count) = 0;
        }
    }
}

/// # Safety
/// Input and error buffers must be valid for their lengths. The returned handle must stay on this
/// thread and be destroyed exactly once. Only trusted, compiler-produced development input is supported.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_create(
    bytes: *const u8,
    length: usize,
    width: u32,
    height: u32,
    reduced_motion: bool,
    error: *mut u8,
    capacity: usize,
) -> *mut ChocoPlayer {
    let result = guarded(|| {
        if bytes.is_null() || length > 2_097_152 {
            return Err("Invalid document buffer".into());
        }
        let document = Document::read(unsafe { slice::from_raw_parts(bytes, length) })?;
        create_player(&document, width, height, reduced_motion)
    });
    match result {
        Ok(handle) => handle,
        Err(message) => {
            unsafe {
                report(&message, error, capacity);
            }
            ptr::null_mut()
        }
    }
}

/// # Safety
/// Handle must be live on its creating thread. Returned RGBA bytes remain valid until the next call
/// on that handle. Copy them before returning to a compositor that may read asynchronously.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_frame(
    handle: *mut ChocoPlayer,
    delta: f64,
    width: u32,
    height: u32,
    error: *mut u8,
    capacity: usize,
) -> ChocoFrame {
    let result = guarded(|| {
        let instance = unsafe { handle.as_mut() }.ok_or("Missing player")?;
        instance.renderer.resize(width, height)?;
        instance.player.advance(delta)?;
        let frame = instance.renderer.render(&instance.player)?;
        Ok(ChocoFrame {
            pixels: frame.pixels.as_ptr().cast(),
            changed: frame.changed,
            needs_frame: instance.player.needs_frame(),
            time: instance.player.time(),
        })
    });
    match result {
        Ok(pixels) => pixels,
        Err(message) => {
            unsafe {
                report(&message, error, capacity);
            }
            ChocoFrame {
                pixels: ptr::null(),
                changed: false,
                needs_frame: false,
                time: 0.,
            }
        }
    }
}

/// # Safety
/// Handle and buffers must be live on the creating thread. A zero-length name restores idle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_state(
    handle: *mut ChocoPlayer,
    name: *const u8,
    length: usize,
    restart: bool,
    error: *mut u8,
    capacity: usize,
) -> bool {
    let result = guarded(|| {
        let instance = unsafe { handle.as_mut() }.ok_or("Missing player")?;
        let state = if length == 0 {
            None
        } else {
            if name.is_null() || length > 256 {
                return Err("Invalid state buffer".into());
            }
            Some(
                str::from_utf8(unsafe { slice::from_raw_parts(name, length) })
                    .map_err(|_| "State is not UTF-8")?,
            )
        };
        instance.player.set_state(state, restart)
    });
    match result {
        Ok(()) => true,
        Err(message) => {
            unsafe {
                report(&message, error, capacity);
            }
            false
        }
    }
}

// Every mutating control shares panic/error handling and the same ownership contract.
unsafe fn control(
    handle: *mut ChocoPlayer,
    error: *mut u8,
    capacity: usize,
    operation: impl FnOnce(&mut ChocoPlayer) -> Result<(), String>,
) -> bool {
    let result = guarded(|| operation(unsafe { handle.as_mut() }.ok_or("Missing player")?));
    match result {
        Ok(()) => true,
        Err(message) => {
            unsafe {
                report(&message, error, capacity);
            }
            false
        }
    }
}

/// # Safety
/// Handle and error buffer must be live on the creating thread. Trigger is 0=enter, 1=hover, 2=click.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_trigger(
    handle: *mut ChocoPlayer,
    trigger: u32,
    error: *mut u8,
    capacity: usize,
) -> bool {
    unsafe {
        control(handle, error, capacity, |instance| {
            let name = ["enter", "hover", "click"]
                .get(trigger as usize)
                .ok_or("Unknown trigger")?;
            instance.player.trigger(name)
        })
    }
}
/// # Safety
/// Handle and error buffer must be live on the creating thread.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_seek(
    handle: *mut ChocoPlayer,
    seconds: f64,
    error: *mut u8,
    capacity: usize,
) -> bool {
    unsafe {
        control(handle, error, capacity, |instance| {
            instance.player.seek(seconds)
        })
    }
}
/// # Safety
/// Handle and error buffer must be live on the creating thread.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_pause(
    handle: *mut ChocoPlayer,
    paused: bool,
    error: *mut u8,
    capacity: usize,
) -> bool {
    unsafe {
        control(handle, error, capacity, |instance| {
            instance.player.set_paused(paused);
            Ok(())
        })
    }
}
/// # Safety
/// Handle and error buffer must be live on the creating thread.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_reduced_motion(
    handle: *mut ChocoPlayer,
    reduced: bool,
    error: *mut u8,
    capacity: usize,
) -> bool {
    unsafe {
        control(handle, error, capacity, |instance| {
            instance.player.set_reduced_motion(reduced);
            Ok(())
        })
    }
}
/// # Safety
/// Handle and error buffer must be live on the creating thread. Coordinates use the scene viewBox.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_look(
    handle: *mut ChocoPlayer,
    active: bool,
    x: f64,
    y: f64,
    error: *mut u8,
    capacity: usize,
) -> bool {
    unsafe {
        control(handle, error, capacity, |instance| {
            instance.player.look(active.then_some([x, y]))
        })
    }
}
/// # Safety
/// Handle and error buffer must be live on the creating thread. Colors are opaque 24-bit RGB.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_palette(
    handle: *mut ChocoPlayer,
    accent: u32,
    secondary: u32,
    ink: u32,
    background: u32,
    error: *mut u8,
    capacity: usize,
) -> bool {
    unsafe {
        control(handle, error, capacity, |instance| {
            let values = [
                ("accent", accent),
                ("secondary", secondary),
                ("ink", ink),
                ("background", background),
            ];
            if values.iter().any(|(_, color)| *color > 0xffffff) {
                return Err("Palette colors must be 24-bit RGB".into());
            }
            instance.renderer.set_palette(
                &values
                    .into_iter()
                    .map(|(name, value)| (name.into(), format!("#{value:06x}")))
                    .collect(),
            )
        })
    }
}

/// # Safety
/// Handle must be live on its creating thread and not used after this call. Null is permitted.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_destroy(handle: *mut ChocoPlayer) {
    if !handle.is_null() {
        drop(unsafe { Box::from_raw(handle) });
    }
}

/// # Safety
/// Player must be live on its rendering thread. Output and error must be valid for their capacities.
/// Queries never change the clock. The JSON includes state and visible named selection bounds.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_info(
    handle: *const ChocoPlayer,
    output: *mut u8,
    capacity: usize,
    error: *mut u8,
    error_capacity: usize,
) -> usize {
    let result = guarded(|| {
        let instance = unsafe { handle.as_ref() }.ok_or("Missing player")?;
        let parts = instance.renderer.selection(&instance.player)?;
        serde_json::to_vec(&serde_json::json!({"state": instance.player.state().unwrap_or("idle"), "parts": parts}))
            .map_err(|_| "Could not read player metadata".into())
    });
    match result {
        Ok(bytes) => {
            if !output.is_null() && capacity >= bytes.len() {
                unsafe {
                    ptr::copy_nonoverlapping(bytes.as_ptr(), output, bytes.len());
                }
            }
            bytes.len()
        }
        Err(message) => {
            unsafe {
                report(&message, error, error_capacity);
            }
            0
        }
    }
}

/// # Safety
/// A non-null player must be live on its rendering thread. Null is considered settled.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_settled(handle: *const ChocoPlayer) -> bool {
    unsafe { handle.as_ref() }.is_none_or(|instance| instance.player.is_settled())
}

/// # Safety
/// Player must be live on its rendering thread and have a synchronized frame. Buffers must be valid.
/// Coverage is one canvas pixel; masks are geometry gates, not recomposited alpha values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn choco_player_hit_test(
    handle: *const ChocoPlayer,
    x: f64,
    y: f64,
    output: *mut u8,
    capacity: usize,
    error: *mut u8,
    error_capacity: usize,
) -> usize {
    let result = guarded(|| {
        let instance = unsafe { handle.as_ref() }.ok_or("Missing player")?;
        let part = instance.renderer.hit_test(&instance.player, x, y);
        let result = part.map(|part| serde_json::json!({"id": part.id, "name": part.name}));
        serde_json::to_vec(&result).map_err(|_| "Could not read hit test result".into())
    });
    match result {
        Ok(bytes) => {
            if !output.is_null() && capacity >= bytes.len() {
                unsafe {
                    ptr::copy_nonoverlapping(bytes.as_ptr(), output, bytes.len());
                }
            }
            bytes.len()
        }
        Err(message) => {
            unsafe {
                report(&message, error, error_capacity);
            }
            0
        }
    }
}
