import type { BuildingType, ServiceEffect, ToolId } from './types';
import { ZoneType } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Balance + content definitions. All gameplay numbers live here so tuning is
// one file. Monetary unit is credits ("CR").
// ─────────────────────────────────────────────────────────────────────────────

export const CURRENCY = 'CR';
export const START_FUNDS = 25000;
export const DEFAULT_TAX = 9; // percent
export const MIN_TAX = 0;
export const MAX_TAX = 20;

export const ROAD_COST = 15;
export const BRIDGE_COST = 90;
export const ROAD_UPKEEP = 0.6; // per road tile per month
export const BRIDGE_UPKEEP = 3;
export const BULLDOZE_COST = 5; // per non-empty tile; buildings refund nothing
/** Zoned tiles need a road within this many tiles (Chebyshev distance) to develop. */
export const ROAD_ACCESS_RANGE = 3;

export interface ZoneDef {
  zone: ZoneType;
  tool: 'res' | 'com' | 'ind';
  name: string;
  short: string;
  cost: number; // per tile
  /** Residents (res) or jobs (com/ind) at levels 0..3. */
  capacity: [number, number, number, number];
  /** Power draw at levels 0..3. */
  power: [number, number, number, number];
  /** Pollution emitted at levels 0..3 (0..1 scale, before diffusion). */
  pollution: [number, number, number, number];
  /** Minimum land value (0..1) to reach level 2 and 3. */
  levelLandValue: [number, number];
  /** Signature neon colour used by renderer + UI. */
  color: string;
  desc: string;
}

export const ZONES: Record<'res' | 'com' | 'ind', ZoneDef> = {
  res: {
    zone: ZoneType.Residential,
    tool: 'res',
    name: 'Hab Blocks',
    short: 'R',
    cost: 20,
    capacity: [0, 14, 48, 150],
    power: [0, 1, 3, 8],
    pollution: [0, 0, 0.02, 0.05],
    levelLandValue: [0.35, 0.6],
    color: '#ff2bd6',
    desc: 'Residential zone. Stacks of capsule homes that grow into hab towers.',
  },
  com: {
    zone: ZoneType.Commercial,
    tool: 'com',
    name: 'Market Strip',
    short: 'C',
    cost: 30,
    capacity: [0, 8, 28, 90],
    power: [0, 2, 5, 12],
    pollution: [0, 0.02, 0.05, 0.08],
    levelLandValue: [0.4, 0.65],
    color: '#22e5ff',
    desc: 'Commercial zone. Noodle bars, cyberware clinics and holo-ad towers.',
  },
  ind: {
    zone: ZoneType.Industrial,
    tool: 'ind',
    name: 'Fab District',
    short: 'I',
    cost: 25,
    capacity: [0, 12, 34, 75],
    power: [0, 3, 7, 14],
    pollution: [0, 0.35, 0.6, 0.85],
    levelLandValue: [0, 0],
    color: '#ffb02e',
    desc: 'Industrial zone. Drone fabs and synth-protein vats. Pollutes.',
  },
};

export function zoneDefFor(zone: ZoneType): ZoneDef | null {
  switch (zone) {
    case ZoneType.Residential:
      return ZONES.res;
    case ZoneType.Commercial:
      return ZONES.com;
    case ZoneType.Industrial:
      return ZONES.ind;
    default:
      return null;
  }
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  desc: string;
  category: 'power' | 'services' | 'landmarks';
  size: number;
  cost: number;
  upkeep: number; // per month
  /** Power supplied (plants only). */
  powerSupply: number;
  powerUse: number;
  /** Coverage effect + radius in tiles (Euclidean, from footprint centre). */
  effect?: ServiceEffect;
  radius: number;
  /** Pollution emitted at the footprint (0..1). */
  pollution: number;
  /** Extra residents / jobs the structure houses. */
  residents: number;
  jobs: number;
  /** City population required to unlock. */
  unlockPop: number;
  /** Signature colour. */
  color: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  solar: {
    type: 'solar',
    name: 'Solar Farm',
    desc: 'Clean but modest power. 100 MW.',
    category: 'power',
    size: 2,
    cost: 1500,
    upkeep: 30,
    powerSupply: 100,
    powerUse: 0,
    radius: 0,
    pollution: 0,
    residents: 0,
    jobs: 0,
    unlockPop: 0,
    color: '#4dff9a',
  },
  reactor: {
    type: 'reactor',
    name: 'Fusion Reactor',
    desc: 'Massive output. 1200 MW, some thermal pollution.',
    category: 'power',
    size: 3,
    cost: 8000,
    upkeep: 220,
    powerSupply: 1200,
    powerUse: 0,
    radius: 0,
    pollution: 0.5,
    residents: 0,
    jobs: 40,
    unlockPop: 600,
    color: '#7b5cff',
  },
  plaza: {
    type: 'plaza',
    name: 'Neon Plaza',
    desc: 'Holo-garden. Raises land value, filters smog.',
    category: 'services',
    size: 1,
    cost: 250,
    upkeep: 10,
    powerSupply: 0,
    powerUse: 1,
    effect: 'park',
    radius: 6,
    pollution: 0,
    residents: 0,
    jobs: 0,
    unlockPop: 0,
    color: '#4dff9a',
  },
  precinct: {
    type: 'precinct',
    name: 'Enforcer Precinct',
    desc: 'Drone patrols suppress crime nearby.',
    category: 'services',
    size: 2,
    cost: 2200,
    upkeep: 110,
    powerSupply: 0,
    powerUse: 6,
    effect: 'security',
    radius: 13,
    pollution: 0,
    residents: 0,
    jobs: 20,
    unlockPop: 150,
    color: '#3d7bff',
  },
  clinic: {
    type: 'clinic',
    name: 'Med Clinic',
    desc: 'Street-level medtech. Residents grow faster nearby.',
    category: 'services',
    size: 2,
    cost: 2600,
    upkeep: 120,
    powerSupply: 0,
    powerUse: 8,
    effect: 'health',
    radius: 12,
    pollution: 0,
    residents: 0,
    jobs: 25,
    unlockPop: 400,
    color: '#ff3b5c',
  },
  datahub: {
    type: 'datahub',
    name: 'Data Hub',
    desc: 'Net uplink. Boosts land value and commerce.',
    category: 'services',
    size: 1,
    cost: 1800,
    upkeep: 90,
    powerSupply: 0,
    powerUse: 10,
    effect: 'net',
    radius: 9,
    pollution: 0,
    residents: 0,
    jobs: 10,
    unlockPop: 1000,
    color: '#22e5ff',
  },
  maglev: {
    type: 'maglev',
    name: 'Maglev Station',
    desc: 'Mass transit. Cuts traffic in its radius.',
    category: 'services',
    size: 2,
    cost: 3500,
    upkeep: 150,
    powerSupply: 0,
    powerUse: 12,
    effect: 'transit',
    radius: 11,
    pollution: 0,
    residents: 0,
    jobs: 15,
    unlockPop: 2000,
    color: '#ffe14d',
  },
  spire: {
    type: 'spire',
    name: 'Corp Spire',
    desc: 'Megacorp HQ. 600 office jobs, huge prestige.',
    category: 'landmarks',
    size: 2,
    cost: 25000,
    upkeep: 400,
    powerSupply: 0,
    powerUse: 60,
    effect: 'prestige',
    radius: 16,
    pollution: 0,
    residents: 0,
    jobs: 600,
    unlockPop: 5000,
    color: '#ff2bd6',
  },
  arcology: {
    type: 'arcology',
    name: 'Arcology',
    desc: 'Self-contained mega-hab for 3000 residents.',
    category: 'landmarks',
    size: 3,
    cost: 60000,
    upkeep: 700,
    powerSupply: 0,
    powerUse: 220,
    effect: 'prestige',
    radius: 12,
    pollution: 0.05,
    residents: 3000,
    jobs: 120,
    unlockPop: 12000,
    color: '#ffb02e',
  },
};

export const BUILDING_ORDER: BuildingType[] = [
  'solar',
  'reactor',
  'plaza',
  'precinct',
  'clinic',
  'datahub',
  'maglev',
  'spire',
  'arcology',
];

export function isBuildingTool(tool: ToolId): tool is BuildingType {
  return tool in BUILDINGS;
}

export function isZoneTool(tool: ToolId): tool is 'res' | 'com' | 'ind' {
  return tool === 'res' || tool === 'com' || tool === 'ind';
}

/** Population milestones: each fires a news item + bonus grant once. */
export const MILESTONES: { pop: number; title: string; grant: number }[] = [
  { pop: 100, title: 'Settlement', grant: 1000 },
  { pop: 500, title: 'Outpost', grant: 2000 },
  { pop: 1500, title: 'Boomtown', grant: 4000 },
  { pop: 5000, title: 'Neon City', grant: 8000 },
  { pop: 12000, title: 'Megacity', grant: 15000 },
  { pop: 30000, title: 'Hyper-Sprawl', grant: 30000 },
];

/** Simulation speeds: ticks (days) per real second, index = speed setting 0..3. */
export const SPEED_TICKS_PER_SEC = [0, 2, 6, 16];

/** Real seconds for one full visual day/night cycle at speed 1 (scaled by speed, paused at 0). */
export const DAY_CYCLE_SECONDS = 240;

export const SAVE_KEY = 'cybercity.save.v1';
export const SETTINGS_KEY = 'cybercity.settings.v1';
export const SAVE_VERSION = 1;
