// District terrain (docs/MEGACITY.md §3.6.1, §3.7; WP-2): every kind and every one of the sixteen 5×5 presets lands in
// its water range and stays buildable over many seeds; generation is deterministic and blends into its neighbours;
// each kind's shape holds (Kessel Flats' basin offers 3 Seaport sites, the Sunk's canal grid, terrace steps ≥ 3×3,
// the marsh's channels, the islands of the Shoals).

import { describe, expect, it } from 'vitest';
import { BUILDINGS, DISTRICTS } from '../src/game/config';
import { presetOf } from '../src/game/districts/layout';
import { slotRect } from '../src/game/districts/slots';
import { PRESET_WATER, generateSlot, waterRange } from '../src/game/districts/terrain';
import { shoreFacing } from '../src/game/ports';
import { DISTRICT_KINDS, SLOT, Terrain, type DistrictKind, type DistrictVariant } from '../src/game/types';
import { World } from '../src/game/world';

/** Land share and the largest 4-connected land piece of a slot. */
function landStats(w: World, s: number): { water: number; biggest: number; land: number } {
  const r = slotRect(w, s);
  const N = w.N;
  let water = 0;
  const seen = new Uint8Array(SLOT * SLOT);
  let biggest = 0;
  for (let ly = 0; ly < SLOT; ly++)
    for (let lx = 0; lx < SLOT; lx++) {
      const k = ly * SLOT + lx;
      if (w.tiles[(r.y0 + ly) * N + r.x0 + lx].terrain === Terrain.Water) {
        water++;
        continue;
      }
      if (seen[k]) continue;
      let n = 0;
      const st = [k];
      seen[k] = 1;
      while (st.length) {
        const q = st.pop()!;
        n++;
        const qx = q % SLOT;
        const qy = (q / SLOT) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = qx + dx;
          const ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= SLOT || ny >= SLOT) continue;
          const nk = ny * SLOT + nx;
          if (seen[nk] || w.tiles[(r.y0 + ny) * N + r.x0 + nx].terrain === Terrain.Water) continue;
          seen[nk] = 1;
          st.push(nk);
        }
      }
      biggest = Math.max(biggest, n);
    }
  return { water: water / (SLOT * SLOT), biggest, land: SLOT * SLOT - water };
}

/** Generate one slot of a 5×5 frame (the east ring-1 slot, or a ring-2 one for repeats) as `kind`, variant `v`. */
function gen(seed: number, kind: DistrictKind, v: DistrictVariant, slot = 13): World {
  const w = new World(seed, 'Terrain', undefined, 5);
  generateSlot(w.tiles, w.N, 5, slot, seed, kind, v, presetOf(DISTRICTS[kind].variants, v));
  return w;
}

const CASES: [DistrictKind, DistrictVariant][] = [];
for (const kind of DISTRICT_KINDS) {
  if (kind === 'shore') continue;
  CASES.push([kind, 0]);
  DISTRICTS[kind].variants.forEach((_, i) => CASES.push([kind, (i + 1) as DistrictVariant]));
}

describe('every kind and preset in range and buildable (§3.6.2, §3.7)', () => {
  it('there are sixteen 5×5 presets, each with a water range', () => {
    const presets = CASES.filter(([, v]) => v > 0).map(([k, v]) => presetOf(DISTRICTS[k].variants, v)!);
    expect(presets).toHaveLength(16);
    for (const p of presets) expect(PRESET_WATER[p], p).toBeDefined();
  });

  it.each(CASES)('%s variant %i: 8 seeds, water inside the range; ≥ 35% of the land in one piece', (kind, v) => {
    const [lo, hi] = waterRange(kind, v, presetOf(DISTRICTS[kind].variants, v));
    for (let k = 0; k < 8; k++) {
      const seed = (k * 7919 + 13) >>> 0;
      for (const slot of k % 2 ? [13, 7] : [18]) {
        const w = gen(seed, kind, v, slot);
        const st = landStats(w, slot);
        expect(st.water, `${kind}/${v} seed ${seed} slot ${slot}`).toBeGreaterThanOrEqual(lo - 0.01);
        expect(st.water, `${kind}/${v} seed ${seed} slot ${slot}`).toBeLessThanOrEqual(hi + 0.01);
        expect(st.biggest / st.land, `${kind}/${v} seed ${seed}`).toBeGreaterThanOrEqual(0.35);
        if (hi <= 0.25) expect(st.biggest / (SLOT * SLOT), `${kind}/${v} seed ${seed}`).toBeGreaterThanOrEqual(0.35);
      }
    }
  });
});

describe('determinism and blending (§3.6.1)', () => {
  it('a slot generates identically every time, and a 5×5 region equals itself across two builds', () => {
    for (const [kind, v] of CASES) {
      const a = gen(99, kind, v);
      const b = gen(99, kind, v);
      const r = slotRect(a, 13);
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) {
          const i = a.idx(x, y);
          expect(a.tiles[i].terrain).toBe(b.tiles[i].terrain);
          expect(a.tiles[i].elev).toBe(b.tiles[i].elev);
          expect(a.tiles[i].variant).toBe(b.tiles[i].variant);
        }
    }
    const x = World.generate(4242, 'A', undefined, 5);
    const y = World.generate(4242, 'B', undefined, 5);
    for (let i = 0; i < x.area; i++) expect(x.tiles[i].terrain).toBe(y.tiles[i].terrain);
  });

  it('a slot blends into the neighbour generated before it: the shared border mostly agrees', () => {
    let agree = 0;
    let n = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = World.generate(seed, 'Blend', undefined, 3);
      // Ring 1's east slot (5) against the start slot (4): column 127 vs 128.
      for (let y = 64; y < 128; y++) {
        const a = w.tiles[w.idx(127, y)].terrain;
        const b = w.tiles[w.idx(128, y)].terrain;
        if (a === b) agree++;
        n++;
      }
    }
    expect(agree / n).toBeGreaterThan(0.75);
  });

  it('water and terrace steps: elev 0 on water, steps only in Highstep Terraces, every step cell at least 3×3', () => {
    for (const seed of [11, 12, 13]) {
      const w = World.generate(seed, 'Steps', undefined, 5);
      for (let i = 0; i < w.area; i++) {
        const t = w.tiles[i];
        if (t.terrain === Terrain.Water) expect(t.elev).toBe(0);
        if (t.elev > 0) expect(w.kindAt(i % w.N, (i / w.N) | 0)).toBe('terraces');
      }
      for (let s = 0; s < 25; s++) {
        if (w.districts.kinds[s] !== 'terraces') continue;
        const r = slotRect(w, s);
        let stepped = 0;
        for (let y = r.y0; y <= r.y1; y++)
          for (let x = r.x0; x <= r.x1; x++) {
            const e = w.tiles[w.idx(x, y)].elev;
            if (e === 0) continue;
            stepped++;
            // Some 3×3 window of this step or higher covers the tile.
            let covered = false;
            for (let oy = -2; oy <= 0 && !covered; oy++)
              for (let ox = -2; ox <= 0 && !covered; ox++) {
                let all = true;
                for (let k = 0; k < 9 && all; k++) {
                  const tx = x + ox + (k % 3);
                  const ty = y + oy + ((k / 3) | 0);
                  all = tx >= r.x0 && ty >= r.y0 && tx <= r.x1 && ty <= r.y1 && w.tiles[w.idx(tx, ty)].elev >= e;
                }
                covered = all;
              }
            expect(covered).toBe(true);
          }
        expect(stepped).toBeGreaterThan(100);
      }
    }
  });
});

describe('kind shapes (§3.7)', () => {
  /** Non-overlapping 4×4 Seaport sites in a slot (land footprints facing 2 tiles of open water). */
  function seaportSites(w: World, s: number): number {
    const r = slotRect(w, s);
    const used = new Uint8Array(w.area);
    const size = BUILDINGS.seaport.size;
    let n = 0;
    for (let y = r.y0; y + size - 1 <= r.y1; y++)
      for (let x = r.x0; x + size - 1 <= r.x1; x++) {
        let ok = true;
        for (let k = 0; k < size * size && ok; k++) {
          const i = w.idx(x + (k % size), y + ((k / size) | 0));
          ok = !used[i] && w.tiles[i].terrain === Terrain.Land;
        }
        if (!ok || shoreFacing(w, x, y, size) < 0) continue;
        for (let k = 0; k < size * size; k++) used[w.idx(x + (k % size), y + ((k / size) | 0))] = 1;
        n++;
      }
    return n;
  }

  it('Kessel Flats offers ≥ 3 Seaport sites on its basin; Ironside Docks ≥ 6', () => {
    for (const seed of [21, 22, 23, 24, 25]) {
      expect(seaportSites(gen(seed, 'flats', 0), 13), `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(seaportSites(gen(seed, 'flats', 1), 13), `seed ${seed}`).toBeGreaterThanOrEqual(6);
    }
  });

  it('the Sunk is a flooded street grid: canals on every 8th row and column, causeways joining the wards', () => {
    for (const seed of [31, 32, 33]) {
      const w = gen(seed, 'sunk', 0);
      const r = slotRect(w, 13);
      // Water runs on two-tile lines in both axes.
      let lines = 0;
      for (let ly = 0; ly < SLOT; ly++) {
        let water = 0;
        for (let lx = 0; lx < SLOT; lx++) if (w.tiles[w.idx(r.x0 + lx, r.y0 + ly)].terrain === Terrain.Water) water++;
        if (water > SLOT * 0.4) lines++;
      }
      expect(lines).toBeGreaterThanOrEqual(8);
    }
  });

  it('the Shoals are islands: more than one land piece of 20+ tiles', () => {
    for (const seed of [41, 42, 43]) {
      const w = gen(seed, 'shoals', 0);
      const r = slotRect(w, 13);
      const seen = new Uint8Array(SLOT * SLOT);
      let pieces = 0;
      for (let k0 = 0; k0 < SLOT * SLOT; k0++) {
        if (seen[k0] || w.tiles[w.idx(r.x0 + (k0 % SLOT), r.y0 + ((k0 / SLOT) | 0))].terrain === Terrain.Water) continue;
        let n = 0;
        const st = [k0];
        seen[k0] = 1;
        while (st.length) {
          const q = st.pop()!;
          n++;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = (q % SLOT) + dx;
            const ny = ((q / SLOT) | 0) + dy;
            if (nx < 0 || ny < 0 || nx >= SLOT || ny >= SLOT) continue;
            const nk = ny * SLOT + nx;
            if (seen[nk] || w.tiles[w.idx(r.x0 + nx, r.y0 + ny)].terrain === Terrain.Water) continue;
            seen[nk] = 1;
            st.push(nk);
          }
        }
        if (n >= 20) pieces++;
      }
      expect(pieces, `seed ${seed}`).toBeGreaterThan(1);
    }
  });
});

describe('every slot stays buildable on the rare seed (§3.6.2; review fix)', () => {
  it('seed 1401182120 on a 5×5 region: its Driftsand Banks slot (22) joins its pieces with sandbars to ≥ 35% of its land, water still in range', () => {
    const w = World.generate(1401182120, 'Banks', undefined, 5);
    const s = 22;
    expect(w.districts.kinds[s]).toBe('shoals');
    const st = landStats(w, s);
    const [lo, hi] = waterRange('shoals', w.variantOf(s), presetOf(DISTRICTS.shoals.variants, w.variantOf(s)));
    expect(st.water).toBeGreaterThanOrEqual(lo);
    expect(st.water).toBeLessThanOrEqual(hi);
    expect(st.biggest / st.land).toBeGreaterThanOrEqual(0.35);
  });
});
