// STUB — replaced by the input implementation (see docs/CONTRACTS.md §Input).
import type { Game } from '../game/game';
import type { Camera } from '../render/camera';

export class InputController {
  constructor(public canvas: HTMLCanvasElement, public game: Game, public camera: Camera) {}
  update(dt: number): void {
    void dt;
  }
  destroy(): void {}
}
