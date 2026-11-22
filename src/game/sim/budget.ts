// ─────────────────────────────────────────────────────────────────────────────
// Budget: a live projection of this month's income and expenses (shown in the
// budget panel at any time) and the monthly settlement that moves the money.
// ─────────────────────────────────────────────────────────────────────────────

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

const upkeepCount = new Map<BuildingType, number>();

/** Fill world.budget's income/expense figures with a projection for the current month (keeps history). */
export function projectBudget(world: World, g: SimGrid, census: Census, out: BudgetReport): void {
  const lvField = world.fields.landValue;
  const tiles = world.tiles;
  const base = [0, 0, 0, 0];
  for (let k = 0; k < g.zonedCount; k++) {
    const i = g.zoned[k];
    if (!g.developed(i)) continue;
    const z = g.zone[i];
    const yieldMul = (T.LV_TAX_BASE + T.LV_TAX_SLOPE * lvField[i]) * (tiles[i].powered ? 1 : T.UNPOWERED_TAX);
    base[z] += CAPACITY[z][g.level[i]] * yieldMul;
  }
  upkeepCount.clear();
  for (const b of g.buildings) {
    const def = BUILDINGS[b.type];
    upkeepCount.set(b.type, (upkeepCount.get(b.type) ?? 0) + 1);
    // Landmark residents / office jobs pay tax like zones (at a flat land-value multiplier).
    const mul = (T.LV_TAX_BASE + T.LV_TAX_SLOPE * lvField[b.y * N + b.x]) * (b.powered ? 1 : T.UNPOWERED_TAX);
    if (def.residents) base[ZoneType.Residential] += def.residents * mul;
    if (def.category === 'landmarks' && def.jobs) base[ZoneType.Commercial] += def.jobs * mul;
  }

  const rate = world.taxRate;
  const fill = census.jobFill;
  const incomeLines: BudgetLine[] = [
    { label: `${ZONES.res.name} tax`, amount: Math.round(base[ZoneType.Residential] * rate * T.TAX_PER_RESIDENT) },
    { label: `${ZONES.com.name} tax`, amount: Math.round(base[ZoneType.Commercial] * fill * rate * T.TAX_PER_COM_JOB) },
    { label: `${ZONES.ind.name} tax`, amount: Math.round(base[ZoneType.Industrial] * fill * rate * T.TAX_PER_IND_JOB) },
  ];

  const roads = g.roadCount - g.bridgeCount;
  const expenseLines: BudgetLine[] = [
    { label: 'Roads & skyways', amount: Math.round(roads * ROAD_UPKEEP + g.bridgeCount * BRIDGE_UPKEEP) },
  ];
  let plants = 0;
  let landmarks = 0;
  for (const type of BUILDING_ORDER) {
    const n = upkeepCount.get(type) ?? 0;
    if (n === 0) continue;
    const def = BUILDINGS[type];
    const cost = n * def.upkeep;
    if (def.category === 'power') plants += cost;
    else if (def.category === 'landmarks') landmarks += cost;
    else expenseLines.push({ label: `${def.name}s`, amount: cost }); // one line per service type
  }
  if (plants > 0) expenseLines.splice(1, 0, { label: 'Power plants', amount: plants });
  if (landmarks > 0) expenseLines.push({ label: 'Landmarks', amount: landmarks });

  let income = 0;
  for (const l of incomeLines) income += l.amount;
  let expenses = 0;
  for (const l of expenseLines) expenses += l.amount;
  out.income = income;
  out.expenses = expenses;
  out.incomeLines = incomeLines;
  out.expenseLines = expenseLines;
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
