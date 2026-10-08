export interface Engine {
  HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(address: number): void;
  _choco_asset_create(bytes: number, length: number, error: number, capacity: number): number;
  _choco_asset_metadata(asset: number, output: number, capacity: number): number;
  _choco_asset_destroy(asset: number): void;
  _choco_player_from_asset(asset: number, width: number, height: number, reduced: boolean, error: number, capacity: number): number;
  _choco_player_info(player: number, output: number, capacity: number, error: number, errorCapacity: number): number;
  _choco_player_hit_test(player: number, x: number, y: number, output: number, capacity: number, error: number, errorCapacity: number): number;
  _choco_player_settled(player: number): boolean;
  _choco_player_destroy(player: number): void;
  _choco_web_frame(player: number, delta: number, width: number, height: number, status: number, error: number, capacity: number): number;
  _choco_player_state(player: number, name: number, length: number, restart: boolean, error: number, capacity: number): boolean;
  _choco_player_trigger(player: number, trigger: number, error: number, capacity: number): boolean;
  _choco_player_seek(player: number, seconds: number, error: number, capacity: number): boolean;
  _choco_player_pause(player: number, paused: boolean, error: number, capacity: number): boolean;
  _choco_player_reduced_motion(player: number, reduced: boolean, error: number, capacity: number): boolean;
  _choco_player_look(player: number, active: boolean, x: number, y: number, error: number, capacity: number): boolean;
  _choco_player_palette(player: number, accent: number, secondary: number, ink: number, background: number, error: number, capacity: number): boolean;
}
export default function initialize(options?: { locateFile?: (file: string) => string }): Promise<Engine>;
