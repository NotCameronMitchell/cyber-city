// STUB — replaced by the building-art implementation (see docs/CONTRACTS.md §Building art).
import type { Building, BuildingType, Tile } from '../game/types';

export interface ArtEnv {
  /** Seconds, for animation. */
  time: number;
  /** 0 day .. 1 night (= 1 - game.daylight). */
  night: number;
  /** Camera zoom, for level-of-detail. */
  zoom: number;
  quality: 'low' | 'high';
  /** Draw as translucent placement ghost. */
  ghost?: boolean;
}

export function drawZoneBuilding(ctx: CanvasRenderingContext2D, wx: number, wy: number, tile: Tile, tx: number, ty: number, env: ArtEnv): void {
  void ctx; void wx; void wy; void tile; void tx; void ty; void env;
}
export function drawServiceBuilding(ctx: CanvasRenderingContext2D, wx: number, wy: number, b: Building, env: ArtEnv): void {
  void ctx; void wx; void wy; void b; void env;
}
export function drawBuildingGhost(ctx: CanvasRenderingContext2D, wx: number, wy: number, type: BuildingType, ok: boolean, env: ArtEnv): void {
  void ctx; void wx; void wy; void type; void ok; void env;
}
export function zoneBuildingHeight(tile: Tile): number {
  return tile.level * 30;
}
export function serviceBuildingHeight(type: BuildingType): number {
  void type;
  return 40;
}
