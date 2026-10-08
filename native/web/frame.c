#include "../choco-native/include/choco.h"

/* Keep aggregate-return ABI details inside C; JavaScript receives a pixel address and three doubles (changed, needs frame, time). */
const uint8_t *choco_web_frame(ChocoPlayer *player, double delta, uint32_t width,
    uint32_t height, double *status, uint8_t *error, size_t capacity) {
    ChocoFrame frame = choco_player_frame(player, delta, width, height, error, capacity);
    status[0] = frame.changed;
    status[1] = frame.needs_frame;
    status[2] = frame.time;
    return frame.pixels;
}
