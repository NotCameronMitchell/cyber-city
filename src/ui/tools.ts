// ─────────────────────────────────────────────────────────────────────────────
// Tool catalogue for the toolbar: categories, per-tool display metadata and
// the data-overlay list. Names, costs and colours come from game/config so
// balance changes flow through automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { chaptersDone, largestLobby, lockedReason } from '../game/actions';
import { BUILDINGS, BULLDOZE_COST, RIBBON, ROAD_KINDS, SKYBRIDGE, SKYWAY, UNLOCK_FALLBACK_POP, WEALTH, ZONES, isBuildingTool, isZoneTool } from '../game/config';
import { adjacentLocked } from '../game/districts/slots';
import type { Game } from '../game/game';
import { TIER_RANK, tier } from '../game/story/factions';
import type { World } from '../game/world';
import { ROAD_TOOL_KIND, ROAD_TOOLS, isRoadTool, type RoadTool } from '../game/roads';
import { TIER_LABEL } from '../game/wealth';
import type { FactionId } from '../game/story/types';
import type { BuildingType, DistrictKind, OverlayId, ToolId } from '../game/types';
import { credits } from './format';
import type { IconName } from './icons';

export type CategoryId = 'inspect' | 'bulldoze' | 'road' | 'zones' | 'power' | 'services' | 'sky' | 'deals' | 'data';

export interface Category {
  id: CategoryId;
  /** Full label (wide screens). */
  label: string;
  /** ≤ 5-char label for narrow phones. */
  short: string;
  icon: IconName;
  /** Desktop keyboard shortcut hint (handled by the input module). */
  key?: string;
  /** Single-tool categories select this tool directly. With `items` too, the category is a hybrid (Road, EXPANSION §7.2). */
  tool?: ToolId;
  /** Multi-item categories open a tray. */
  items?: ToolId[];
  accent: string;
  /** Story-gated group: only shown once the factions unlock (docs/STORY.md §8.9). */
  story?: boolean;
}

export const CATEGORIES: Category[] = [
  { id: 'inspect', label: 'Inspect', short: 'Info', icon: 'inspect', key: 'Esc', tool: 'inspect', accent: '#22e5ff' },
  { id: 'bulldoze', label: 'Bulldoze', short: 'Demo', icon: 'bulldoze', key: 'B', tool: 'bulldoze', accent: '#ff3b5c' },
  // Hybrid (EXPANSION §7.2): one tap lays a street; the tray holds the other road kinds.
  { id: 'road', label: 'Road', short: 'Road', icon: 'road', key: 'R', tool: 'road', items: ['road', 'alley', 'avenue', 'highway'], accent: '#c8d0f0' },
  { id: 'zones', label: 'Zones', short: 'Zone', icon: 'zones', key: 'Z X C', items: ['res', 'com', 'ind'], accent: '#ff2bd6' },
  // Relabels to "Infra" ("Power & Ports" on wide screens) once the Seaport unlocks (categoryChrome, §7.1).
  // Megacity (§7.1): the trays keep their 9 buttons and gain section chips (SECTIONS below); items = every chip's cards.
  { id: 'power', label: 'Power', short: 'Power', icon: 'power', items: ['solar', 'reactor', 'tidal', 'geothermal', 'seaport', 'airport', 'spaceport'], accent: '#4dff9a' },
  {
    id: 'services',
    label: 'Services',
    short: 'Civic',
    icon: 'services',
    items: ['precinct', 'floodwatch', 'clinic', 'medtower', 'plaza', 'canopypark', 'markethall', 'memorial', 'academy', 'datahub', 'datavault', 'maglev', 'metro', 'reclaim', 'pumphouse'],
    accent: '#3d7bff',
  },
  // Sky (§8.9): the megastructures, skybridges and the ribbon share the old Landmarks slot,
  // so the phone toolbar stays at 8–9 thumb-sized buttons.
  {
    id: 'sky',
    label: 'Sky',
    short: 'Sky',
    icon: 'sky',
    items: ['stack', 'spire', 'arcology', 'skybridge', 'rail', 'skyway', 'beacon', 'arena', 'halolookout', 'terminal'],
    accent: '#a9b8ff',
  },
  {
    id: 'deals',
    label: 'Deals',
    short: 'Deals',
    icon: 'deals',
    items: [
      'commons',
      'foundry',
      'glarewall',
      'tidemarket',
      'roost',
      'charterhall',
      'hexworks',
      'pearlatrium',
      'hullhouse',
      'kitemast',
      'lampchoir',
      'gantry',
      'glasssmile',
      'breadpier',
      'recordtower',
      'stillsquare',
    ],
    accent: '#ffb02e',
    story: true,
  },
  { id: 'data', label: 'Data', short: 'Data', icon: 'data', key: 'O', accent: '#22e5ff' },
];

export function categoryOf(tool: ToolId): CategoryId {
  for (const c of CATEGORIES) {
    if (c.tool === tool) return c.id;
    if (c.items && c.items.includes(tool)) return c.id;
  }
  return 'inspect';
}

// ── Section chips (MEGACITY §7.1) ─────────────────────────────────────────

/** A tray's section chip: at most 4 per tray, at most 6 cards each. `legacy`: shown only after an ending. */
export interface TraySection {
  id: string;
  label: string;
  items: ToolId[];
  legacy?: boolean;
}

/** §7.1's chips, in order. Road, Zones and Data have none. */
export const SECTIONS: Partial<Record<CategoryId, TraySection[]>> = {
  power: [
    { id: 'power', label: 'Power', items: ['solar', 'reactor', 'tidal', 'geothermal'] },
    { id: 'ports', label: 'Ports', items: ['seaport', 'airport', 'spaceport'] },
  ],
  services: [
    { id: 'safety', label: 'Safety', items: ['precinct', 'floodwatch', 'clinic', 'medtower'] },
    { id: 'parks', label: 'Parks', items: ['plaza', 'canopypark', 'markethall', 'memorial'] },
    { id: 'learning', label: 'Learning', items: ['academy', 'datahub', 'datavault'] },
    { id: 'transit', label: 'Transit & works', items: ['maglev', 'metro', 'reclaim', 'pumphouse'] },
  ],
  sky: [
    { id: 'towers', label: 'Towers', items: ['stack', 'spire', 'arcology'] },
    { id: 'links', label: 'Links', items: ['skybridge', 'rail', 'skyway'] },
    { id: 'landmarks', label: 'Landmarks', items: ['beacon', 'arena', 'halolookout', 'terminal'] },
  ],
  deals: [
    { id: 'buildings', label: 'Buildings', items: ['commons', 'foundry', 'glarewall', 'tidemarket', 'roost'] },
    { id: 'landmarks', label: 'Landmarks', items: ['charterhall', 'hexworks', 'pearlatrium', 'hullhouse', 'kitemast', 'lampchoir'] },
    { id: 'legacy', label: 'Legacy', items: ['gantry', 'glasssmile', 'breadpier', 'recordtower', 'stillsquare'], legacy: true },
  ],
};

/** The section chip a tool's card sits in ('' for trays without chips). */
export function sectionOf(tool: ToolId): string {
  for (const list of Object.values(SECTIONS)) for (const sec of list ?? []) if (sec.items.includes(tool)) return sec.id;
  return '';
}

/**
 * How a tray card shows (§7.1 rumoured cards): 'open' when it can be placed; 'locked' greyed with its condition (the
 * classic population lock and its progress bar); 'rumoured' a locked landmark or district-bound type the player is one
 * step away from, greyed with its condition ("Needs Basalt Allied", "Needs the Shoals"); 'hidden' otherwise (and
 * always for hidden types and for the Legacy landmarks of other endings). Trays never fill with cards the player
 * can't reach.
 */
export type CardState = 'open' | 'locked' | 'rumoured' | 'hidden';

/** District-bound types: their card waits for the district (owned or a candidate). */
const DISTRICT_BOUND: Partial<Record<BuildingType, DistrictKind[]>> = {
  pumphouse: ['shoals', 'sunk', 'reedmere'],
  tidal: ['shoals', 'sunk', 'reedmere'],
  geothermal: ['terraces'],
  beacon: ['shoals'],
  hullhouse: ['sunk'],
};

export function cardState(world: World, tool: ToolId): CardState {
  if (!isBuildingTool(tool)) return lockedReason(world, tool) ? 'locked' : 'open';
  const def = BUILDINGS[tool];
  if (def.hidden) return 'hidden';
  if (def.gate?.ending) return world.story.ending === def.gate.ending ? (lockedReason(world, tool) ? 'locked' : 'open') : 'hidden';
  if (!lockedReason(world, tool)) return 'open';
  const bound = DISTRICT_BOUND[tool] ?? (def.gate?.district ? [def.gate.district] : null);
  const landmark = def.category === 'landmarks';
  if (!bound && !landmark) return 'locked';
  return oneStepAway(world, tool, bound) ? 'rumoured' : 'hidden';
}

/** "One step away" (§7.1): each missing part of the gate is near (Friendly for Allied, half the population, the district owned or next door). */
function oneStepAway(world: World, tool: BuildingType, bound: DistrictKind[] | null): boolean {
  const def = BUILDINGS[tool];
  const g = def.gate;
  if (bound) {
    const d = world.districts;
    const cands = new Set(adjacentLocked(world));
    const near = d.kinds.some((k, s) => bound.includes(k) && (world.slotOwned[s] === 1 || cands.has(s)));
    if (!near) return false;
  }
  const half = (pop: number) => world.maxPopulation >= pop * 0.5;
  if (g) {
    if (g.faction || g.fallbackPop !== undefined || g.unlock !== undefined) {
      const fac = g.faction ? TIER_RANK[tier(world, g.faction)] >= TIER_RANK[g.tier === 'allied' ? 'friendly' : 'neutral'] : false;
      const pop = g.fallbackPop !== undefined ? half(g.fallbackPop) : false;
      if (!fac && !pop && g.unlock === undefined) return false;
    }
    if (g.districts !== undefined && world.districts.owned.length < g.districts - 1) return false;
    if (g.chapter !== undefined && chaptersDone(world) < g.chapter - 1) return false;
    if (g.lobby !== undefined && largestLobby(world) < Math.max(3, g.lobby - 2)) return false;
  } else if (def.unlockPop > 0 && !half(def.unlockPop)) return false;
  return true;
}

/** A locked card's condition line: "Needs Basalt Allied", "Needs the Shoals", "Reach 300k pop". */
export function cardCondition(world: World, tool: ToolId): string {
  const r = lockedReason(world, tool);
  if (!r) return '';
  return r.replace(/^Locked: reach ([\d,]+) residents$/, 'Reach $1 pop').replace(/^Locked: (\w+) (Allied|Friendly)$/, 'Needs $1 $2').replace(/^Locked: /, '');
}

/** The chips of a tray that hold at least one visible card, with those cards (§7.1). */
export function traySections(world: World, cat: CategoryId): { section: TraySection; cards: ToolId[] }[] {
  const list = SECTIONS[cat];
  if (!list) return [];
  const out: { section: TraySection; cards: ToolId[] }[] = [];
  for (const section of list) {
    if (section.legacy && !world.story.ending) continue;
    const cards = section.items.filter((t) => cardState(world, t) !== 'hidden');
    if (cards.length) out.push({ section, cards });
  }
  return out;
}

/** A tool + tray category (Road): tapping it lays a street at once and opens the tray (§7.2). */
export function isHybrid(c: Category): boolean {
  return !!c.tool && !!c.items;
}

/** Population at which the Power tray becomes "Infra" (the first port, the Seaport, §7.1). */
export const INFRA_POP = BUILDINGS.seaport.unlockPop;

/** Toolbar label, short label and icon of a category for a city that has reached `maxPop` (the Infra relabel). */
export function categoryChrome(c: Category, maxPop: number): { label: string; short: string; icon: IconName } {
  if (c.id === 'power' && maxPop >= INFRA_POP) return { label: 'Power & Ports', short: 'Infra', icon: 'infra' };
  return { label: c.label, short: c.short, icon: c.icon };
}

/**
 * The Road button (EXPANSION §7.2), as a pure rule so it is testable:
 *  1. no road tool active → select `last` (the session's last road tool; Street if it is locked),
 *     and open the tray too when two or more road kinds are unlocked;
 *  2. a road tool active, tray closed → open the tray;
 *  3. a road tool active, tray open → close the tray (the tool stays).
 */
export function roadButton(active: ToolId, trayOpen: boolean, last: RoadTool, unlocked: (t: RoadTool) => boolean): { tool: ToolId | null; tray: 'open' | 'close' | 'keep' } {
  if (isRoadTool(active)) return { tool: null, tray: trayOpen ? 'close' : 'open' };
  const tool: RoadTool = unlocked(last) ? last : 'road';
  let open = 0;
  for (const t of ROAD_TOOLS) if (unlocked(t)) open++;
  return { tool, tray: open >= 2 ? 'open' : 'keep' };
}

/** KeyR: Street, then (pressed again while a road tool is active) the next unlocked road tool in tray order. Null = back to Inspect. */
export function nextRoadTool(active: ToolId, unlocked: (t: RoadTool) => boolean): ToolId {
  if (!isRoadTool(active)) return 'road';
  const order = ROAD_TOOLS.filter((t) => t === 'road' || unlocked(t));
  // Only Street open: R toggles back to Inspect as it always has.
  if (order.length <= 1) return 'inspect';
  const i = order.indexOf(active);
  return order[(i + 1) % order.length];
}

export interface ToolMeta {
  id: ToolId;
  name: string;
  /** One-line description for cards. */
  desc: string;
  icon: IconName;
  color: string;
  /** Short badge (R / C / I) for zones. */
  badge?: string;
  /** Base cost (per tile for road / zones / bulldoze). */
  cost: number;
  perTile: boolean;
  /** Footprint size for buildings. */
  size?: number;
  unlockPop: number;
  /** Faction whose sigil badges the card (Deals group). */
  faction?: FactionId;
  /** Tray card meta line on phones (≤ 22 chars), the one rule a card must carry (§7.2). */
  meta?: string;
}

const BUILDING_ICON: Record<string, IconName> = {
  solar: 'solar',
  reactor: 'reactor',
  plaza: 'plaza',
  precinct: 'precinct',
  clinic: 'clinic',
  datahub: 'datahub',
  maglev: 'maglev',
  spire: 'spire',
  arcology: 'arcology',
  stack: 'stack',
  foundry: 'foundry',
  glarewall: 'glarewall',
  tidemarket: 'tidemarket',
  roost: 'roost',
  commons: 'commons',
  memorial: 'memorial',
  academy: 'academy',
  seaport: 'seaport',
  airport: 'airport',
  spaceport: 'spaceport',
  // Megacity (§6.3, §9.2).
  floodwatch: 'floodwatch',
  pumphouse: 'pumphouse',
  canopypark: 'canopypark',
  medtower: 'medtower',
  reclaim: 'reclaim',
  metro: 'metro',
  markethall: 'markethall',
  tidal: 'tidal',
  geothermal: 'geothermal',
  datavault: 'datavault',
  charterhall: 'charterhall',
  hexworks: 'hexworks',
  pearlatrium: 'pearlatrium',
  hullhouse: 'hullhouse',
  kitemast: 'kitemast',
  lampchoir: 'lampchoir',
  beacon: 'beacon',
  arena: 'arena',
  halolookout: 'halolookout',
  terminal: 'terminal',
  gantry: 'gantry',
  glasssmile: 'glasssmile',
  breadpier: 'breadpier',
  recordtower: 'recordtower',
  stillsquare: 'stillsquare',
};

const ROAD_ICON: Record<RoadTool, IconName> = { road: 'road', avenue: 'avenue', highway: 'highway', alley: 'alley' };
const ZONE_META: Record<'res' | 'com' | 'ind', string> = { res: 'Housing', com: 'Shops · jobs', ind: 'Jobs · smog' };

export function toolMeta(tool: ToolId): ToolMeta {
  if (isZoneTool(tool)) {
    const z = ZONES[tool];
    return { id: tool, name: z.name, desc: z.desc, icon: tool, color: z.color, badge: z.short, cost: z.cost, perTile: true, unlockPop: 0, meta: ZONE_META[tool] };
  }
  if (isBuildingTool(tool)) {
    const b = BUILDINGS[tool];
    const m: ToolMeta = {
      id: tool,
      name: b.name,
      desc: b.desc,
      icon: BUILDING_ICON[tool] ?? 'services',
      color: b.color,
      cost: b.cost,
      perTile: false,
      size: b.size,
      unlockPop: b.gate?.fallbackPop ?? (b.gate?.unlock ? UNLOCK_FALLBACK_POP[b.gate.unlock] ?? 0 : b.unlockPop),
      faction: b.gate?.faction,
    };
    if (b.meta) m.meta = b.meta;
    return m;
  }
  if (isRoadTool(tool)) {
    // Street, Back Alley, Avenue, Highway: one row of ROAD_KINDS each (§2.8). 'road' is the Street.
    const k = ROAD_KINDS[ROAD_TOOL_KIND[tool]];
    const desc = k.bridgeCost !== null ? `${k.desc} Bridges ${credits(k.bridgeCost)}.` : k.desc;
    return { id: tool, name: k.name, desc, icon: ROAD_ICON[tool], color: k.color, cost: k.cost, perTile: true, unlockPop: k.unlockPop, meta: k.meta };
  }
  switch (tool) {
    case 'skyway':
      return {
        id: tool,
        name: 'Skyway',
        desc: SKYWAY.desc,
        icon: 'skyway',
        color: SKYWAY.color,
        cost: SKYWAY.perTile,
        perTile: true,
        unlockPop: SKYWAY.unlockPop,
        // §5.2, §7.1: one job each for the three links.
        meta: 'Cars · drag',
      };
    case 'skybridge':
      return {
        id: tool,
        name: 'Skybridge',
        desc: 'A walkway for people. Tap a tall tower, then a glowing partner. Skyways carry cars.',
        icon: 'skybridge',
        color: '#8fe3ff',
        // The v2 price of the shortest bridge (§5.3 rule 8: 1,200 + 250 per gap tile); the live price is Game.toolCost.
        cost: SKYBRIDGE.base + SKYBRIDGE.v2.perTile * SKYBRIDGE.v2.minGap,
        perTile: false,
        unlockPop: UNLOCK_FALLBACK_POP.skybridge ?? 0,
        meta: 'Walkway · tap 2 towers',
      };
    case 'rail':
      return {
        id: tool,
        name: 'Ribbon Rail',
        desc: 'Elevated track. Join two powered stations (Maglev or Stratablock).',
        icon: 'rail',
        color: '#5ef2c8',
        cost: RIBBON.perTile,
        perTile: true,
        unlockPop: UNLOCK_FALLBACK_POP.rail ?? 0,
        meta: 'Trains · drag',
      };
    case 'bulldoze':
      return {
        id: tool,
        name: 'Bulldoze',
        desc: 'Clear roads, zones and structures.',
        icon: 'bulldoze',
        color: '#ff3b5c',
        cost: BULLDOZE_COST,
        perTile: true,
        unlockPop: 0,
      };
    case 'inspect':
    default:
      return { id: 'inspect', name: 'Inspect', desc: 'Tap anything to see how it is doing.', icon: 'inspect', color: '#22e5ff', cost: 0, perTile: false, unlockPop: 0 };
  }
}

/**
 * Live price of a tool with every modifier. Game.toolCost covers buildings,
 * zones, skybridges and rail; roads and bulldozing fall back to the catalogue
 * price × buildCostMul, the way planAction charges them.
 */
export function livePrice(game: Game, tool: ToolId): number {
  if (tool === 'inspect') return 0;
  const p = game.toolCost(tool);
  if (p > 0) return p;
  return Math.round(toolMeta(tool).cost * game.world.mods.buildCostMul);
}

/** "15 CR/tile", "1,500 CR", "from 5 CR". */
export function costLabel(meta: ToolMeta): string {
  if (meta.id === 'inspect') return 'Free';
  if (meta.id === 'bulldoze' || meta.id === 'skybridge') return `from ${credits(meta.cost)}`;
  return meta.perTile ? `${credits(meta.cost)}/tile` : credits(meta.cost);
}

export type LegendKind = 'heat' | 'power' | 'services' | 'turf' | 'tiers';

export interface OverlayMeta {
  id: OverlayId;
  name: string;
  icon: IconName;
  desc: string;
  legend: LegendKind | null;
  low?: string;
  high?: string;
}

/** Data tray order (EXPANSION §7.3): Off, Wealth, Land Value, Traffic, Noise, Power, Crime, Pollution, Services, Turf. */
export const OVERLAYS: OverlayMeta[] = [
  { id: 'none', name: 'Off', icon: 'eyeOff', desc: 'Plain city view.', legend: null },
  { id: 'wealth', name: 'Wealth', icon: 'tiers', desc: 'Which blocks are $, $$ or $$$.', legend: 'tiers' },
  { id: 'landValue', name: 'Land Value', icon: 'gem', desc: 'Where towers want to rise.', legend: 'heat', low: 'Cheap', high: 'Prime' },
  { id: 'traffic', name: 'Traffic', icon: 'car', desc: 'Congestion on the streets.', legend: 'heat', low: 'Clear', high: 'Jammed' },
  { id: 'noise', name: 'Noise', icon: 'noise', desc: 'Highways, runways and launch pads.', legend: 'heat', low: 'Quiet', high: 'Roaring' },
  { id: 'power', name: 'Power', icon: 'plug', desc: 'Which blocks are on the grid.', legend: 'power' },
  { id: 'crime', name: 'Crime', icon: 'siren', desc: 'Street-crew activity.', legend: 'heat', low: 'Calm', high: 'Rough' },
  { id: 'pollution', name: 'Pollution', icon: 'smog', desc: 'Smog from fabs and plants.', legend: 'heat', low: 'Clean', high: 'Toxic' },
  { id: 'services', name: 'Services', icon: 'rings', desc: 'Coverage of civic buildings.', legend: 'services' },
  { id: 'turf', name: 'Turf', icon: 'turf', desc: 'Whose streets are whose.', legend: 'turf' },
];

export function overlayMeta(id: OverlayId): OverlayMeta {
  return OVERLAYS.find((o) => o.id === id) ?? OVERLAYS[0];
}

/** Service coverage colours (match the renderer's services overlay). */
export const SERVICE_SWATCHES: { label: string; color: string }[] = [
  { label: 'Security', color: '#3d7bff' },
  { label: 'Health', color: '#ff3b5c' },
  { label: 'Net', color: '#22e5ff' },
  { label: 'Park', color: '#4dff9a' },
  { label: 'Transit', color: '#ffe14d' },
  { label: 'Prestige', color: '#ff2bd6' },
  // X1 (EXPANSION §6.1): EFFECT_RGB.education in render/overlay.ts.
  { label: 'Schools', color: '#ffd0a0' },
];

/** Wealth view swatches (WEALTH.colors) and the pips the lens draws (render/overlay.ts, EXPANSION §4.5). */
export const TIER_SWATCHES: { label: string; color: string }[] = WEALTH.colors.map((color, i) => ({ label: TIER_LABEL[i], color }));
export const TIER_PIP_UP = '#4dff9a';
export const TIER_PIP_DOWN = 'rgb(255, 120, 120)';
