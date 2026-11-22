// STUB — replaced by the effects implementation (see docs/CONTRACTS.md §Effects).
import type { Game } from '../game/game';
import type { ArtEnv } from './buildings';

export interface TileBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Effects {
  constructor(public game: Game) {}
  update(dt: number): void {
    void dt;
  }
  drawGround(ctx: CanvasRenderingContext2D, bounds: TileBounds, env: ArtEnv): void {
    void ctx; void bounds; void env;
  }
  drawSky(ctx: CanvasRenderingContext2D, bounds: TileBounds, env: ArtEnv): void {
    void ctx; void bounds; void env;
  }
  drawScreen(ctx: CanvasRenderingContext2D, width: number, height: number, env: ArtEnv): void {
    void ctx; void width; void height; void env;
  }
}
