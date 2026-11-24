// ─────────────────────────────────────────────────────────────────────────────
// Tool catalogue for the toolbar: categories, per-tool display metadata and
// the data-overlay list. Names, costs and colours come from game/config so
// balance changes flow through automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, BULLDOZE_COST, RIBBON, ROAD_KINDS, SKYBRIDGE, SKYWAY, UNLOCK_FALLBACK_POP, WEALTH, ZONES, isBuildingTool, isZoneTool } from '../game/config';
import type { Game } from '../game/game';
import { ROAD_TOOL_KIND, ROAD_TOOLS, isRoadTool, type RoadTool } from '../game/roads';
import { TIER_LABEL } from '../game/wealth';
import type { FactionId } from '../game/story/types';
import type { OverlayId, ToolId } from '../game/types';
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
  { id: 'power', label: 'Power', short: 'Power', icon: 'power', items: ['solar', 'reactor', 'seaport', 'airport', 'spaceport'], accent: '#4dff9a' },
  {
    id: 'services',
    label: 'Services',
    short: 'Civic',
    icon: 'services',
    items: ['plaza', 'precinct', 'clinic', 'datahub', 'academy', 'maglev', 'memorial'],
    accent: '#3d7bff',
  },
  // Sky (§8.9): the megastructures, skybridges and the ribbon share the old Landmarks slot,
  // so the phone toolbar stays at 8–9 thumb-sized buttons.
  { id: 'sky', label: 'Sky', short: 'Sky', icon: 'sky', items: ['stack', 'skybridge', 'rail', 'skyway', 'spire', 'arcology'], accent: '#a9b8ff' },
  { id: 'deals', label: 'Deals', short: 'Deals', icon: 'deals', items: ['commons', 'foundry', 'glarewall', 'tidemarket', 'roost'], accent: '#ffb02e', story: true },
  { id: 'data', label: 'Data', short: 'Data', icon: 'data', key: 'O', accent: '#22e5ff' },
];

export function categoryOf(tool: ToolId): CategoryId {
  for (const c of CATEGORIES) {
    if (c.tool === tool) return c.id;
    if (c.items && c.items.includes(tool)) return c.id;
  }
  return 'inspect';
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
        meta: SKYWAY.meta,
      };
    case 'skybridge':
      return {
        id: tool,
        name: 'Skybridge',
        desc: 'Drag from one tall tower to another. Lit spans lift the blocks below.',
        icon: 'skybridge',
        color: '#8fe3ff',
        cost: SKYBRIDGE.base + SKYBRIDGE.perTile * SKYBRIDGE.minGap,
        perTile: false,
        unlockPop: UNLOCK_FALLBACK_POP.skybridge ?? 0,
        meta: 'Tower to tower',
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
        meta: 'Stations',
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
