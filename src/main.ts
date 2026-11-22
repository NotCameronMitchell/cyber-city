// PLACEHOLDER — the integration step wires Game, Renderer, InputController, UI and AudioEngine here.
import { Game } from './game/game';
import { Camera } from './render/camera';

const game = new Game();
const camera = new Camera();
console.log('Cyber City boot', game.world.cityName, camera.zoom);
