// STUB — replaced by the UI implementation (see docs/CONTRACTS.md §UI).
import type { Game } from '../game/game';
import type { Camera } from '../render/camera';

export class UI {
  constructor(public root: HTMLElement, public game: Game, public camera: Camera) {}
  update(dt: number): void {
    void dt;
  }
}
