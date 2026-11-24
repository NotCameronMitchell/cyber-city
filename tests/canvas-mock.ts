// A strict Canvas 2D stand-in for Node tests of render code (WP-4 building art and port FX).
// Every drawing call validates its numbers (finite; radii and sizes not negative) and is
// counted; installCanvasMock() puts `document.createElement('canvas')` and `Path2D` on
// globalThis so the real sprite cache and painter run unchanged.

export interface MockStats {
  /** Drawing calls (fill, stroke, fillRect, drawImage...) since the last reset. */
  draws: number;
  /** Problems found (bad numbers, negative radii, NaN colours). Empty = clean. */
  errors: string[];
  /** Canvases created. */
  canvases: number;
}

export const mockStats: MockStats = { draws: 0, errors: [], canvases: 0 };

function check(name: string, args: ArrayLike<unknown>, nonNeg: number[] = []) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a === 'number' && !Number.isFinite(a)) mockStats.errors.push(`${name} arg ${i} = ${a}`);
  }
  for (const i of nonNeg) {
    const a = args[i];
    if (typeof a === 'number' && a < 0) mockStats.errors.push(`${name} arg ${i} negative (${a})`);
  }
}

class MockPath {
  moveTo(...a: number[]) {
    check('path.moveTo', a);
  }
  lineTo(...a: number[]) {
    check('path.lineTo', a);
  }
  closePath() {}
  rect(...a: number[]) {
    check('path.rect', a);
  }
  ellipse(...a: number[]) {
    check('path.ellipse', a, [2, 3]);
  }
  arc(...a: number[]) {
    check('path.arc', a, [2]);
  }
}

class MockGradient {
  addColorStop(o: number, c: string) {
    if (!(o >= 0 && o <= 1)) mockStats.errors.push(`addColorStop offset ${o}`);
    if (typeof c !== 'string' || c.includes('NaN')) mockStats.errors.push(`addColorStop colour ${c}`);
  }
}

class MockContext {
  canvas: MockCanvas;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  imageSmoothingEnabled = true;
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  private fill_: unknown = '#000';
  private stroke_: unknown = '#000';
  private m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private stack: { a: number; b: number; c: number; d: number; e: number; f: number }[] = [];
  constructor(c: MockCanvas) {
    this.canvas = c;
  }
  get fillStyle() {
    return this.fill_;
  }
  set fillStyle(v: unknown) {
    if (typeof v === 'string' && v.includes('NaN')) mockStats.errors.push(`fillStyle ${v}`);
    this.fill_ = v;
  }
  get strokeStyle() {
    return this.stroke_;
  }
  set strokeStyle(v: unknown) {
    if (typeof v === 'string' && v.includes('NaN')) mockStats.errors.push(`strokeStyle ${v}`);
    this.stroke_ = v;
  }
  save() {
    this.stack.push({ ...this.m });
  }
  restore() {
    const t = this.stack.pop();
    if (t) this.m = t;
  }
  setTransform(a: number | { a: number; b: number; c: number; d: number; e: number; f: number }, b = 0, c = 0, d = 1, e = 0, f = 0) {
    if (typeof a === 'object') this.m = { ...a };
    else {
      check('setTransform', [a, b, c, d, e, f]);
      this.m = { a, b, c, d, e, f };
    }
  }
  getTransform() {
    return { ...this.m };
  }
  resetTransform() {
    this.m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  translate(x: number, y: number) {
    check('translate', [x, y]);
    this.m.e += x * this.m.a;
    this.m.f += y * this.m.d;
  }
  scale(x: number, y: number) {
    check('scale', [x, y]);
    this.m.a *= x;
    this.m.d *= y;
  }
  rotate(r: number) {
    check('rotate', [r]);
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    check('transform', [a, b, c, d, e, f]);
  }
  beginPath() {}
  closePath() {}
  moveTo(...a: number[]) {
    check('moveTo', a);
  }
  lineTo(...a: number[]) {
    check('lineTo', a);
  }
  quadraticCurveTo(...a: number[]) {
    check('quadraticCurveTo', a);
  }
  bezierCurveTo(...a: number[]) {
    check('bezierCurveTo', a);
  }
  rect(...a: number[]) {
    check('rect', a);
  }
  arc(...a: number[]) {
    check('arc', a, [2]);
  }
  ellipse(...a: number[]) {
    check('ellipse', a, [2, 3]);
  }
  clip() {}
  fill(_p?: unknown) {
    mockStats.draws++;
  }
  stroke(_p?: unknown) {
    mockStats.draws++;
  }
  fillRect(...a: number[]) {
    check('fillRect', a);
    mockStats.draws++;
  }
  strokeRect(...a: number[]) {
    check('strokeRect', a);
    mockStats.draws++;
  }
  clearRect(...a: number[]) {
    check('clearRect', a);
  }
  fillText(_t: string, ...a: number[]) {
    check('fillText', a);
    mockStats.draws++;
  }
  measureText(t: string) {
    return { width: t.length * 6 };
  }
  drawImage(img: unknown, ...a: number[]) {
    if (!img) mockStats.errors.push('drawImage without an image');
    check('drawImage', a);
    mockStats.draws++;
  }
  createLinearGradient(...a: number[]) {
    check('createLinearGradient', a);
    return new MockGradient();
  }
  createRadialGradient(...a: number[]) {
    check('createRadialGradient', a, [2, 5]);
    return new MockGradient();
  }
  createPattern() {
    return null;
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
  }
  putImageData() {}
  setLineDash() {}
}

class MockCanvas {
  width = 300;
  height = 150;
  style: Record<string, string> = {};
  private ctx: MockContext | null = null;
  getContext(_kind: string) {
    return (this.ctx ??= new MockContext(this));
  }
  getBoundingClientRect() {
    return { width: this.width, height: this.height, left: 0, top: 0, right: this.width, bottom: this.height };
  }
}

/** Install the mock `document` (createElement('canvas') only) and `Path2D` on globalThis. */
export function installCanvasMock(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.document) {
    g.document = {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`mock document: no <${tag}>`);
        mockStats.canvases++;
        return new MockCanvas();
      },
    };
  }
  if (!g.Path2D) g.Path2D = MockPath;
}

/** A fresh mock 2D context (a main canvas of the given size). */
export function mockContext(w = 390, h = 844): CanvasRenderingContext2D {
  const c = new MockCanvas();
  c.width = w;
  c.height = h;
  return c.getContext('2d') as unknown as CanvasRenderingContext2D;
}

export function resetMockStats(): void {
  mockStats.draws = 0;
  mockStats.errors.length = 0;
}
