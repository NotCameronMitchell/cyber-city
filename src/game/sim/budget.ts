// ─────────────────────────────────────────────────────────────────────────────
// Budget: a live projection of this month's income and expenses (shown in the
// budget panel at any time) and the monthly settlement that moves the money.
//
// Story hooks (§10.6): per-tile tax yield × layers.taxMul[i]; tax lines ×
// mods.taxIncomeMul; upkeep by buildingStats() × mods.upkeepMul ×
// mods.upkeepMulType[type]; then world.ledger's lines are appended, grouped
// by label. `vertical` (Stratablocks) joins the landmark tax rule.
// ─────────────────────────────────────────────────────────────────────────────

import { blankStats, buildingStats } from '../buildingStats';
import { BRIDGE_UPKEEP, BUILDINGS, BUILDING_ORDER, ROAD_UPKEEP, ZONES } from '../config';
import { ZoneType, type BudgetLine, type BudgetReport, type BuildingType } from '../types';
import type { World } from '../world';
import type { Census } from './census';
import { N, type SimGrid } from './grid';
import * as Tuning from './tuning';

const T = { ...Tuning };

const CAPACITY: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  ZONES.res.capacity,
  ZONES.com.capacity,
  ZONES.ind.capacity,
];

/** Upkeep per building type this projection (reused between ticks). */
const upkeepByType = new Map<BuildingType, number>();
const STATS = blankStats();

/** Fill world.budget's income/expense figures with a projection for the current month (keeps history). */
export function projectBudget(world: World, g: SimGrid, census: Census, out: BudgetReport): void {
  const lvField = world.fields.landValue;
  const taxMul = world.layers.taxMul;
  const mods = world.mods;
  const tiles = world.tiles;
  const base = [0, 0, 0, 0];
  for (let k = 0; k < g.zonedCount; k++) {
    const i = g.zoned[k];
    if (!g.developed(i)) continue;
    const z = g.zone[i];
    const yieldMul = (T.LV_TAX_BASE + T.LV_TAX_SLOPE * lvField[i]) * (tiles[i].powered ? 1 : T.UNPOWERED_TAX) * taxMul[i];
    base[z] += CAPACITY[z][g.level[i]] * yieldMul;
  }
  upkeepByType.clear();
  const st = STATS;
  for (const b of g.buildings) {
    const def = BUILDINGS[b.type];
    buildingStats(b, st);
    upkeepByType.set(b.type, (upkeepByType.get(b.type) ?? 0) + st.upkeep);
    // Landmark (and Stratablock) residents / jobs pay tax like zones (at a flat land-value multiplier).
    // Service and faction jobs (a Tidemarket's stalls included) stay untaxed.
    const c = b.y * N + b.x;
    const mul = (T.LV_TAX_BASE + T.LV_TAX_SLOPE * lvField[c]) * (b.powered ? 1 : T.UNPOWERED_TAX) * taxMul[c];
    if (st.residents) base[ZoneType.Residential] += st.residents * mul;
    if (def.category === 'landmarks' || def.category === 'vertical') {
      if (st.jobsCom) base[ZoneType.Commercial] += st.jobsCom * mul;
      if (st.jobsInd) base[ZoneType.Industrial] += st.jobsInd * mul;
    }
  }

  const rate = world.taxRate;
  const fill = census.jobFill;
  const taxIncome = mods.taxIncomeMul;
  const incomeLines: BudgetLine[] = [
    { label: `${ZONES.res.name} tax`, amount: Math.round(base[ZoneType.Residential] * rate * T.TAX_PER_RESIDENT * taxIncome) },
    { label: `${ZONES.com.name} tax`, amount: Math.round(base[ZoneType.Commercial] * fill * rate * T.TAX_PER_COM_JOB * taxIncome) },
    { label: `${ZONES.ind.name} tax`, amount: Math.round(base[ZoneType.Industrial] * fill * rate * T.TAX_PER_IND_JOB * taxIncome) },
  ];

  const upkeepMul = mods.upkeepMul;
  const typeMul = mods.upkeepMulType;
  const roads = g.roadCount - g.bridgeCount;
  const expenseLines: BudgetLine[] = [
    { label: 'Roads & skyways', amount: Math.round((roads * ROAD_UPKEEP + g.bridgeCount * BRIDGE_UPKEEP) * upkeepMul) },
  ];
  let plants = 0;
  let landmarks = 0;
  for (const type of BUILDING_ORDER) {
    const raw = upkeepByType.get(type);
    if (raw === undefined) continue;
    const def = BUILDINGS[type];
    const cost = raw * upkeepMul * (typeMul[type] ?? 1);
    if (def.category === 'power') plants += cost;
    else if (def.category === 'landmarks') landmarks += cost;
    else if (cost > 0) expenseLines.push({ label: `${def.name}s`, amount: Math.round(cost) }); // one line per type
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
