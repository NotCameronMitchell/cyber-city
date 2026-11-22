// STUB — replaced by the renderer implementation (see docs/CONTRACTS.md §Renderer).
import type { Game } from '../game/game';
import type { Camera } from './camera';

export class Renderer {
  readonly stats = { fps: 0, drawMs: 0 };
  constructor(public canvas: HTMLCanvasElement, public game: Game, public camera: Camera) {}
  resize(): void {}
  render(dt: number, time: number): void {
    void dt; void time;
  }
}
