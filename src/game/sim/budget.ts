// ─────────────────────────────────────────────────────────────────────────────
// Budget: a live projection of this month's income and expenses (shown in the
// budget panel at any time) and the monthly settlement that moves the money.
//
// Story hooks (§10.6): per-tile tax yield × layers.taxMul[i]; tax lines ×
// mods.taxIncomeMul; upkeep by buildingStats() × mods.upkeepMul ×
// mods.upkeepMulType[type]; then world.ledger's lines are appended, grouped
// by label. `vertical` (Stratablocks) joins the landmark tax rule.
//
// Expansion (docs/EXPANSION.md §4.4, §5, §6.3): tax by wealth tier (and the
// affordable quarter), "Roads" upkeep per kind and terrain, "Skyways",
// per-type plurals, taxed `transport` jobs, and the income lines "Port
// trade", "Tourism" and "Launch contracts". stats.tierEffect.tax is the tax
// the tiers add against an all-$ city.
// ─────────────────────────────────────────────────────────────────────────────

import { blankStats, buildingStats } from '../buildingStats';
import { BUILDINGS, BUILDING_ORDER, ROAD_KINDS, SKYWAY, SPACEPORT, TOURISM, ZONES } from '../config';
import { ZoneType, type BudgetLine, type BudgetReport, type BuildingType } from '../types';
import type { World } from '../world';
import type { Census } from './census';
import type { SimGrid } from './grid';
import { portLive, type PortSystem } from './ports';
import { K, ZONED_CHUNK, drain, type Unit } from './slice';
import * as Tiers from './tiers';
import * as Tuning from './tuning';

const T = { ...Tuning };
const CAP_T = Tiers.CAP_T;
const CAP_AFF = Tiers.CAP_AFF;
const TAX_T = Tiers.TAX_T;
const RES = ZoneType.Residential;
/** Upkeep per tile by kind and terrain: index kind * 2 + (water ? 1 : 0). */
const UPKEEP_KW: readonly number[] = ROAD_KINDS.flatMap((d) => [d.upkeep, d.bridgeUpkeep]);

/** Upkeep per building type this projection (reused between ticks). */
const upkeepByType = new Map<BuildingType, number>();
const STATS = blankStats();

/**
 * Fill world.budget's income/expense figures with a projection for the current month (keeps
 * history). `ports` adds the port income lines (none without it).
 */
export function projectBudget(world: World, g: SimGrid, census: Census, out: BudgetReport, ports?: PortSystem): void {
  drain(projectUnit(world, g, census, out, ports, false));
}

/** The zoned tax base of entries k0..k1 into `base` and `flat`. */
function taxBase(world: World, g: SimGrid, base: number[], flat: number[], k0: number, k1: number): void {
  const lvField = world.fields.landValue;
  const taxMul = world.layers.taxMul;
  const tiles = world.tiles;
  const { wealth, alleyNear } = g;
  for (let k = k0; k < k1; k++) {
    const i = g.zoned[k];
    if (!g.developed(i)) continue;
    const z = g.zone[i];
    const l = g.level[i];
    const t = wealth[i];
    const yieldMul = (T.LV_TAX_BASE + T.LV_TAX_SLOPE * lvField[i]) * (tiles[i].powered ? 1 : T.UNPOWERED_TAX) * taxMul[i];
    const cap0 = CAP_T[z * 12 + l * 3];
    if (t === 0 && !(z === RES && alleyNear[i])) base[z] += cap0 * yieldMul;
    else {
      const cap = z === RES && t === 0 ? CAP_AFF[l] : CAP_T[z * 12 + l * 3 + t];
      base[z] += cap * yieldMul * TAX_T[z * 3 + t];
    }
    flat[z] += cap0 * yieldMul;
  }
}

/**
 * The projection as a resumable unit (MEGACITY §3.3 C2): the zoned tax base in chunks of ZONED_CHUNK, then the
 * buildings and the lines; world.budget changes only in the last step.
 */
export function* projectUnit(world: World, g: SimGrid, census: Census, out: BudgetReport, ports: PortSystem | undefined, banded: boolean): Unit {
  const lvField = world.fields.landValue;
  const taxMul = world.layers.taxMul;
  const mods = world.mods;
  const base = [0, 0, 0, 0];
  /** The same tax base with every tile at $ and no affordable quarters (stats.tierEffect.tax). */
  const flat = [0, 0, 0, 0];
  const zc = g.zonedCount;
  const step = banded ? ZONED_CHUNK : zc + 1;
  for (let k0 = 0; k0 < zc; k0 += step) {
    yield K.Budget;
    taxBase(world, g, base, flat, k0, Math.min(zc, k0 + step));
  }
  yield K.Budget;
  upkeepByType.clear();
  const st = STATS;
  for (const b of g.buildings) {
    const def = BUILDINGS[b.type];
    buildingStats(b, st);
    upkeepByType.set(b.type, (upkeepByType.get(b.type) ?? 0) + st.upkeep);
    // Landmark (and Stratablock) residents / jobs pay tax like zones (at a flat land-value multiplier).
    // Service and faction jobs (a Tidemarket's stalls included) stay untaxed.
    const c = b.y * world.N + b.x;
    const mul = (T.LV_TAX_BASE + T.LV_TAX_SLOPE * lvField[c]) * (b.powered ? 1 : T.UNPOWERED_TAX) * taxMul[c];
    if (st.residents) base[ZoneType.Residential] += st.residents * mul;
    if (def.category === 'landmarks' || def.category === 'vertical' || def.category === 'transport') {
      if (st.jobsCom) base[ZoneType.Commercial] += st.jobsCom * mul;
      if (st.jobsInd) base[ZoneType.Industrial] += st.jobsInd * mul;
    }
  }

  const rate = world.taxRate;
  const fill = census.jobFill;
  const taxIncome = mods.taxIncomeMul;
  const resTax = rate * T.TAX_PER_RESIDENT * taxIncome;
  const comTax = fill * rate * T.TAX_PER_COM_JOB * taxIncome;
  const indTax = fill * rate * T.TAX_PER_IND_JOB * taxIncome;
  const incomeLines: BudgetLine[] = [
    { label: `${ZONES.res.name} tax`, amount: Math.round(base[ZoneType.Residential] * rate * T.TAX_PER_RESIDENT * taxIncome) },
    { label: `${ZONES.com.name} tax`, amount: Math.round(base[ZoneType.Commercial] * fill * rate * T.TAX_PER_COM_JOB * taxIncome) },
    { label: `${ZONES.ind.name} tax`, amount: Math.round(base[ZoneType.Industrial] * fill * rate * T.TAX_PER_IND_JOB * taxIncome) },
  ];
  // Tiers against an all-$ city (zones only; landmark and transport jobs have no tier).
  world.stats.tierEffect.tax = Math.round(
    (base[1] - flat[1]) * resTax + (base[2] - flat[2]) * comTax + (base[3] - flat[3]) * indTax,
  );
  if (ports) {
    const trade = ports.tradeTotal;
    if (trade > 0) incomeLines.push({ label: 'Port trade', amount: Math.round(trade) });
    const tourism = Math.round(ports.visitors * TOURISM.spend);
    if (tourism > 0) incomeLines.push({ label: 'Tourism', amount: tourism });
    let launch = 0;
    for (const b of g.buildings) if (b.type === 'spaceport' && portLive(b)) launch += SPACEPORT.income;
    if (launch > 0) incomeLines.push({ label: 'Launch contracts', amount: launch });
  }

  const upkeepMul = mods.upkeepMul;
  const typeMul = mods.upkeepMulType;
  // Roads: every ground kind at its own upkeep (bridges at the bridge rate). A street-only
  // city reads exactly the old roads × ROAD_UPKEEP + bridges × BRIDGE_UPKEEP.
  const kc = g.kindCount;
  let roadUpkeep = 0;
  for (let k = 0; k < kc.length; k++) if (kc[k] > 0) roadUpkeep += kc[k] * UPKEEP_KW[k];
  const expenseLines: BudgetLine[] = [{ label: 'Roads', amount: Math.round(roadUpkeep * upkeepMul) }];
  if (g.skyCount > 0) expenseLines.push({ label: 'Skyways', amount: Math.round(g.skyCount * SKYWAY.upkeep * upkeepMul) });
  let plants = 0;
  let landmarks = 0;
  for (const type of BUILDING_ORDER) {
    const raw = upkeepByType.get(type);
    if (raw === undefined) continue;
    const def = BUILDINGS[type];
    const cost = raw * upkeepMul * (typeMul[type] ?? 1);
    if (def.category === 'power') plants += cost;
    else if (def.category === 'landmarks') landmarks += cost;
    else if (cost > 0) expenseLines.push({ label: def.plural ?? `${def.name}s`, amount: Math.round(cost) }); // one line per type
  }
  if (plants > 0) expenseLines.splice(1, 0, { label: 'Power plants', amount: Math.round(plants) });
  if (landmarks > 0) expenseLines.push({ label: 'Landmarks', amount: Math.round(landmarks) });

  // Story lines (deals, Off-ledger, Skybridges, Ribbon Rail…), written monthly by the director.
  const incFrom = incomeLines.length;
  const expFrom = expenseLines.length;
  appendLedger(world.ledger.income, incomeLines, incFrom, expenseLines, expFrom);
  appendLedger(world.ledger.expense, expenseLines, expFrom, incomeLines, incFrom);

  let income = 0;
  for (const l of incomeLines) income += l.amount;
  let expenses = 0;
  for (const l of expenseLines) expenses += l.amount;
  out.income = income;
  out.expenses = expenses;
  out.incomeLines = incomeLines;
  out.expenseLines = expenseLines;
}

/**
 * Append story ledger lines to `into`, summing lines that share a label (only
 * among story lines, i.e. from index `from`). A negative amount belongs to the
 * other side, so it lands in `other` as a positive line. Non-finite and zero
 * amounts are skipped.
 */
function appendLedger(
  src: readonly BudgetLine[],
  into: BudgetLine[],
  from: number,
  other: BudgetLine[],
  otherFrom: number,
): void {
  for (const l of src) {
    const v = Math.round(l.amount);
    if (!Number.isFinite(v) || v === 0) continue;
    if (v > 0) addLine(into, from, l.label, v);
    else addLine(other, otherFrom, l.label, -v);
  }
}

function addLine(list: BudgetLine[], from: number, label: string, amount: number): void {
  for (let k = from; k < list.length; k++) {
    if (list[k].label === label) {
      list[k] = { label, amount: list[k].amount + amount };
      return;
    }
  }
  list.push({ label, amount });
}

/** Settle the month: move money and record the net in the 12-month history. Returns the net. */
export function settleMonth(world: World): number {
  const b = world.budget;
  const net = b.income - b.expenses;
  world.funds += net;
  b.history.push(net);
  if (b.history.length > 12) b.history.splice(0, b.history.length - 12);
  return net;
}
