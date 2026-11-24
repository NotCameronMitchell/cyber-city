// ─────────────────────────────────────────────────────────────────────────────
// Per-building numbers, stage- and crown-aware (docs/STORY.md §4.2, §11).
// Census, budget, power, fields and the inspect panel should read these
// instead of BUILDINGS[b.type] so Stratablocks count only their complete
// stages. For every other type the result equals the BUILDINGS entry.
// Owner: WP-B.
//
// Expansion (docs/EXPANSION.md §2.8, §5.3): jobs split by `def.jobsInd`
// (default: all Fab for power plants, none otherwise), and a non-stack
// building with buildDays > 0 (the Spaceport under construction) has no
// residents, jobs, trips, power, upkeep, effect or pollution yet.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, CROWNS, STACK_INTERNAL, STACK_STAGES } from './config';
import { BUILDING_TRIPS } from './sim/tuning';
import type { BuildingStats } from './story/types';
import type { Building } from './types';

export type { BuildingStats } from './story/types';

/** Complete (finished) stage of a building: buildDays > 0 ? stage − 1 : stage. Non-stacks return 0. */
export function completeStage(b: Pick<Building, 'type' | 'stage' | 'buildDays'>): 0 | 1 | 2 | 3 {
  if (b.type !== 'stack') return 0;
  const stage = b.stage ?? 1;
  const s = (b.buildDays ?? 0) > 0 ? stage - 1 : stage;
  return (s < 0 ? 0 : s > 3 ? 3 : s) as 0 | 1 | 2 | 3;
}

/** A zeroed stats object (scratch for `buildingStats(b, out)` in hot loops). */
export function blankStats(): BuildingStats {
  return {
    residents: 0,
    jobsCom: 0,
    jobsInd: 0,
    powerUse: 0,
    powerSupply: 0,
    upkeep: 0,
    effect: null,
    radius: 0,
    pollution: 0,
    trips: 0,
    tall: false,
    station: false,
  };
}

/**
 * Stats for one building. Pass `out` to reuse an object in hot loops (no
 * allocation); otherwise a new object is returned.
 *
 * Stratablock rules (§4.2): only complete stages count; capacity, trips and
 * upkeep count only while the block is powered (power use always counts, or
 * the grid could never power it); trips drop by STACK_INTERNAL of the matched
 * residents/jobs; the crown adds its jobs, residents and pollution at stage 3.
 */
export function buildingStats(b: Building, out: BuildingStats = blankStats()): BuildingStats {
  const def = BUILDINGS[b.type];
  if (b.type !== 'stack') {
    out.tall = !!def?.tall;
    out.station = !!def?.station;
    if ((b.buildDays ?? 0) > 0) {
      // Under construction (Spaceport, §5.3): nothing counts until it is finished.
      out.residents = 0;
      out.jobsCom = 0;
      out.jobsInd = 0;
      out.powerUse = 0;
      out.powerSupply = 0;
      out.upkeep = 0;
      out.effect = null;
      out.radius = 0;
      out.pollution = 0;
      out.trips = 0;
      return out;
    }
    const jobs = def?.jobs ?? 0;
    const residents = def?.residents ?? 0;
    const ind = Math.max(0, Math.min(jobs, def?.jobsInd ?? (def?.category === 'power' ? jobs : 0)));
    out.residents = residents;
    out.jobsCom = jobs - ind;
    out.jobsInd = ind;
    out.powerUse = def?.powerUse ?? 0;
    out.powerSupply = def?.powerSupply ?? 0;
    out.upkeep = def?.upkeep ?? 0;
    out.effect = def?.effect ?? null;
    out.radius = def?.radius ?? 0;
    out.pollution = def?.pollution ?? 0;
    out.trips = (jobs + residents) * BUILDING_TRIPS;
    return out;
  }

  const s = completeStage(b);
  let residents = 0;
  let jobsCom = 0;
  let jobsInd = 0;
  let power = 0;
  let upkeep = 0;
  let radius = 0;
  for (let k = 0; k < s; k++) {
    const st = STACK_STAGES[k];
    residents += st.res;
    jobsCom += st.jobsCom;
    jobsInd += st.jobsInd;
    power += st.power;
    upkeep += st.upkeep;
    if (st.prestigeRadius) radius = st.prestigeRadius;
  }
  let pollution = 0;
  if (s >= 3 && b.crown) {
    const c = CROWNS[b.crown];
    if (c) {
      residents += c.residents ?? 0;
      jobsInd += c.jobsInd ?? 0;
      pollution += c.pollution ?? 0;
    }
  }
  const on = b.powered && b.offline <= 0;
  out.powerUse = power;
  out.powerSupply = 0;
  out.effect = radius > 0 ? 'prestige' : null;
  out.radius = radius;
  out.pollution = pollution;
  out.tall = s >= 2;
  out.station = true;
  if (on) {
    const jobs = jobsCom + jobsInd;
    out.residents = residents;
    out.jobsCom = jobsCom;
    out.jobsInd = jobsInd;
    out.upkeep = upkeep;
    out.trips = Math.max(0, residents + jobs - 2 * STACK_INTERNAL * Math.min(residents, jobs)) * BUILDING_TRIPS;
  } else {
    out.residents = 0;
    out.jobsCom = 0;
    out.jobsInd = 0;
    out.upkeep = 0;
    out.trips = 0;
  }
  return out;
}
