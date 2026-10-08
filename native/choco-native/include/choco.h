#ifndef CHOCO_DEVELOPMENT_H
#define CHOCO_DEVELOPMENT_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Unreleased development ABI: canonical .choco archive input (format 0, revision 2).
 * All simultaneously live handles must share one rendering thread, without reentry.
 * Creation from another thread returns an error; destroy on the owner thread.
 * Errors are copied into a caller-owned, NUL-terminated buffer (capacity includes NUL).
 * Failures return NULL/false or a frame with NULL pixels. No error string contains input document bytes.
 */
typedef struct ChocoPlayer ChocoPlayer;
typedef struct ChocoAsset ChocoAsset;
/* Decode once, share immutable asset data between independently owned players. */
ChocoAsset *choco_asset_create(const uint8_t *bytes, size_t length, uint8_t *error, size_t capacity);
/* Returns required UTF-8 JSON size; copies only if capacity is sufficient. No NUL terminator. */
size_t choco_asset_metadata(const ChocoAsset *asset, uint8_t *output, size_t capacity);
void choco_asset_destroy(ChocoAsset *asset);
ChocoPlayer *choco_player_from_asset(const ChocoAsset *asset, uint32_t width, uint32_t height,
    bool reduced_motion, uint8_t *error, size_t capacity);
/* Current state and visible named rig bounds in viewBox coordinates, in paint order.
 * Bounds are transformed selection rectangles, not exact path or clip hit regions.
 * Returns required UTF-8 JSON size; copies only if capacity is sufficient. 0 on error. */
size_t choco_player_info(const ChocoPlayer *player, uint8_t *output, size_t capacity,
    uint8_t *error, size_t error_capacity);
/* Named authored-paint hit in last synchronized frame, using canvas pixel coordinates.
 * Returns UTF-8 JSON {id,name} or null; size/copy behavior matches player_info. 0 on error.
 * One-pixel backend coverage honors holes/strokes/visibility and gates ancestor mask geometry;
 * it does not reproduce fractional alpha composition or blending. Generated effects are excluded. */
size_t choco_player_hit_test(const ChocoPlayer *player, double x, double y, uint8_t *output,
    size_t capacity, uint8_t *error, size_t error_capacity);
/* Finite motion completion; ambient loops are excluded and pausing preserves the result. */
bool choco_player_settled(const ChocoPlayer *player);
typedef struct ChocoFrame {
    const uint8_t *pixels;
    bool changed;
    bool needs_frame;
    double time;
} ChocoFrame;
ChocoPlayer *choco_player_create(const uint8_t *bytes, size_t length, uint32_t width,
    uint32_t height, bool reduced_motion, uint8_t *error, size_t capacity);
/* pixels holds width * height * 4 premultiplied RGBA bytes, borrowed until the next call.
 * NULL pixels reports failure. changed=false means reuse the previously presented image;
 * changed=true means a new raster is available (including the first frame and resizes).
 * delta is elapsed active playback time in seconds; pass zero for paused redraws. */
ChocoFrame choco_player_frame(ChocoPlayer *player, double delta, uint32_t width,
    uint32_t height, uint8_t *error, size_t capacity);
bool choco_player_state(ChocoPlayer *player, const uint8_t *name, size_t length,
    bool restart, uint8_t *error, size_t capacity);
/* needs_frame is false for paused/reduced/static/settled playback. Stop scheduling then;
 * any host input or resize must request a frame and reconsider its scheduling hint. */
bool choco_player_trigger(ChocoPlayer *player, uint32_t trigger, uint8_t *error, size_t capacity);
bool choco_player_seek(ChocoPlayer *player, double seconds, uint8_t *error, size_t capacity);
bool choco_player_pause(ChocoPlayer *player, bool paused, uint8_t *error, size_t capacity);
bool choco_player_reduced_motion(ChocoPlayer *player, bool reduced, uint8_t *error, size_t capacity);
bool choco_player_look(ChocoPlayer *player, bool active, double x, double y, uint8_t *error, size_t capacity);
bool choco_player_palette(ChocoPlayer *player, uint32_t accent, uint32_t secondary,
    uint32_t ink, uint32_t background, uint8_t *error, size_t capacity);
void choco_player_destroy(ChocoPlayer *player);
#ifdef __cplusplus
}
#endif
#endif
