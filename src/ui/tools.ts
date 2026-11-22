// ─────────────────────────────────────────────────────────────────────────────
// Tool catalogue for the toolbar: categories, per-tool display metadata and
// the data-overlay list. Names, costs and colours come from game/config so
// balance changes flow through automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { BRIDGE_COST, BUILDINGS, BULLDOZE_COST, RIBBON, ROAD_COST, SKYBRIDGE, UNLOCK_FALLBACK_POP, ZONES, isBuildingTool, isZoneTool } from '../game/config';
import type { Game } from '../game/game';
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
  /** Single-tool categories select this tool directly. */
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
  { id: 'road', label: 'Road', short: 'Road', icon: 'road', key: 'R', tool: 'road', accent: '#c8d0f0' },
  { id: 'zones', label: 'Zones', short: 'Zone', icon: 'zones', key: 'Z X C', items: ['res', 'com', 'ind'], accent: '#ff2bd6' },
  { id: 'power', label: 'Power', short: 'Power', icon: 'power', items: ['solar', 'reactor'], accent: '#4dff9a' },
  {
    id: 'services',
    label: 'Services',
    short: 'Civic',
    icon: 'services',
    items: ['plaza', 'precinct', 'clinic', 'datahub', 'maglev', 'memorial'],
    accent: '#3d7bff',
  },
  // Sky (§8.9): the megastructures, skybridges and the ribbon share the old Landmarks slot,
  // so the phone toolbar stays at 8–9 thumb-sized buttons.
  { id: 'sky', label: 'Sky', short: 'Sky', icon: 'sky', items: ['stack', 'skybridge', 'rail', 'spire', 'arcology'], accent: '#a9b8ff' },
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
};

export function toolMeta(tool: ToolId): ToolMeta {
  if (isZoneTool(tool)) {
    const z = ZONES[tool];
    return { id: tool, name: z.name, desc: z.desc, icon: tool, color: z.color, badge: z.short, cost: z.cost, perTile: true, unlockPop: 0 };
  }
  if (isBuildingTool(tool)) {
    const b = BUILDINGS[tool];
    return {
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
  }
  switch (tool) {
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
      };
    case 'road':
      return {
        id: tool,
        name: 'Road',
        desc: `Streets carry traffic and power. Bridges ${credits(BRIDGE_COST)}.`,
        icon: 'road',
        color: '#c8d0f0',
        cost: ROAD_COST,
        perTile: true,
        unlockPop: 0,
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

export type LegendKind = 'heat' | 'power' | 'services' | 'turf';

export interface OverlayMeta {
  id: OverlayId;
  name: string;
  icon: IconName;
  desc: string;
  legend: LegendKind | null;
  low?: string;
  high?: string;
}

export const OVERLAYS: OverlayMeta[] = [
  { id: 'none', name: 'Off', icon: 'eyeOff', desc: 'Plain city view.', legend: null },
  { id: 'power', name: 'Power', icon: 'plug', desc: 'Which blocks are on the grid.', legend: 'power' },
  { id: 'landValue', name: 'Land Value', icon: 'gem', desc: 'Where towers want to rise.', legend: 'heat', low: 'Cheap', high: 'Prime' },
  { id: 'crime', name: 'Crime', icon: 'siren', desc: 'Street-crew activity.', legend: 'heat', low: 'Calm', high: 'Rough' },
  { id: 'pollution', name: 'Pollution', icon: 'smog', desc: 'Smog from fabs and plants.', legend: 'heat', low: 'Clean', high: 'Toxic' },
  { id: 'traffic', name: 'Traffic', icon: 'car', desc: 'Congestion on the streets.', legend: 'heat', low: 'Clear', high: 'Jammed' },
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
];
