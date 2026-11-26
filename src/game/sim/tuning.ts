// ─────────────────────────────────────────────────────────────────────────────
// Internal simulation coefficients. Player-facing numbers (costs, capacities,
// radii, upkeep) live in config.ts; these are the "physics" weights that turn
// them into city behaviour. Grouped by system so tuning stays readable.
//
// Megacity scale (docs/MEGACITY.md §4.3, §4.4): head counts are × POP_SCALE (10) and every
// per-head rate here ÷ 10 (trips, taxes), so every per-tile number is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { ROAD_KINDS } from '../config';
import { RoadKind } from '../types';

// ── Scheduling ───────────────────────────────────────────────────────────────
/** Fraction of zoned tiles evaluated for growth each tick. */
export const GROWTH_SAMPLE = 1 / 6;
/**
 * Heavy field passes are spread over this many ticks inside step() (MEGACITY §3.3, O4). 2 (today's latency):
 * 0 traffic + pollution + noise; 1 neighbourhood + land value + crime + wealth score. 4 (O4's stagger, a quarter of
 * the field work a day): 0 traffic; 1 pollution + noise; 2 neighbourhood + land value; 3 crime + wealth score.
 * The stagger follows the city's size (Simulation.fieldStagger): a one-district city keeps today's 2 (its day costs
 * ≤ 1 ms, and the 4-day latency moves the existing one-district balance tests, EXPANSION B4 on seed 2091 and
 * MEGACITY S4, below their thresholds: WP-1 report), and a city of FIELD_STAGGER_FROM districts or more runs O4's 4,
 * which §11.1's 9- and 25-district day budgets assume. Step 9 may move the threshold to 1 once the balance is re-tuned.
 */
export const FIELD_STAGGER: 2 | 4 = 4;
/** The stagger of a city with fewer than FIELD_STAGGER_FROM owned districts (today's 2-day field cycle). */
export const FIELD_STAGGER_SMALL: 2 | 4 = 2;
/** Owned districts from which a city runs FIELD_STAGGER. */
export const FIELD_STAGGER_FROM = 2;

// ── Traffic ──────────────────────────────────────────────────────────────────
/** Trips emitted per resident / job by zone (index = ZoneType). */
export const TRIPS_PER_UNIT = [0, 0.1, 0.09, 0.08];
/** Trips per resident/job housed in a service building or landmark. */
export const BUILDING_TRIPS = 0.05;
/** Share of trips removed at full transit coverage. */
export const TRANSIT_TRIP_CUT = 0.6;
/**
 * Raw trips at which a street reads ~63% congested (1 - e^-1): the Street capacity, one source
 * (EXPANSION §3.8). Other kinds use ROAD_KINDS[k].capacity; this stays the pollution reference.
 */
export const TRAFFIC_SCALE = ROAD_KINDS[RoadKind.Street].capacity;
/** Smoothing passes along connected roads. */
export const TRAFFIC_SMOOTH_PASSES = 2;
/** Faint traffic shown on lots next to a road (overlay only), by distance 1, 2. */
export const TRAFFIC_SPILL = [0, 0.32, 0.12];

// ── Pollution ────────────────────────────────────────────────────────────────
/** Pollution emitted by a road tile per unit of traffic. */
export const ROAD_POLLUTION = 0.22;
export const POLLUTION_BLUR_PASSES = 3;
/** Diffused field is scaled by this, then the raw source is added on top. */
export const POLLUTION_GAIN = 1.6;
export const POLLUTION_SOURCE_KEEP = 0.25;
/** Fraction of pollution removed at full park coverage. */
export const PARK_FILTER = 0.55;

// ── Land value ───────────────────────────────────────────────────────────────
export const LV_BASE = 0.3;
/** Bonus for tiles that overlook water, falling off over WATER_VIEW_RANGE tiles. */
export const LV_WATER = 0.17;
export const WATER_VIEW_RANGE = 5;
/** Amplitude of the static terrain noise term. */
export const LV_NOISE = 0.08;
export const LV_DENSITY = 0.1;
export const LV_PARK = 0.28;
export const LV_NET = 0.22;
export const LV_PRESTIGE = 0.32;
export const LV_HEALTH = 0.1;
export const LV_SECURITY = 0.08;
export const LV_POLLUTION = 0.5;
export const LV_CRIME = 0.3;
export const LV_TRAFFIC = 0.12;

// ── Crime ────────────────────────────────────────────────────────────────────
export const CRIME_BASE = 0.05;
export const CRIME_DENSITY = 0.35;
export const CRIME_UNEMPLOYMENT = 0.45;
export const CRIME_POVERTY = 0.2;
export const CRIME_ABANDONMENT = 0.3;
/**
 * Joblessness only bites once the town is a real city: its crime and approval
 * effects scale from UNEMPLOYMENT_FLOOR up to 1 as population reaches
 * UNEMPLOYMENT_FULL_POP (a 1,500-person camp with no factory isn't a crime den).
 */
export const UNEMPLOYMENT_FLOOR = 0.25;
export const UNEMPLOYMENT_FULL_POP = 8000;
/** Small towns are calmer: crime is scaled from CRIME_TOWN_SCALE up to 1 by CRIME_TOWN_POP residents. */
export const CRIME_TOWN_SCALE = 0.55;
export const CRIME_TOWN_POP = 30000;
/** Extra crime in big cities, reached at CRIME_CITY_POP residents. */
export const CRIME_CITY = 0.15;
export const CRIME_CITY_POP = 200_000;
/** Crime removed at full security coverage. */
export const SECURITY_SUPPRESS = 0.65;
/** Undeveloped land carries only this share of the computed crime. */
export const CRIME_EMPTY_LAND = 0.4;

// ── Demand ───────────────────────────────────────────────────────────────────
/** Share of residents who want a job. */
export const WORKFORCE_SHARE = 0.6;
/** Residents supported per job-holder (workers + dependents), as a multiple of 1/WORKFORCE_SHARE. */
export const RES_PER_JOB = 1.15;
/** Settlers who arrive with no jobs in town (keeps a new city moving). */
export const RES_STARTER = 2200;
/** Commercial jobs wanted per resident / per industrial job, plus a visitor base. */
export const COM_PER_RES = 0.25;
export const COM_PER_IND = 0.1;
export const COM_BASE = 250;
/** Industrial jobs wanted per worker, plus external-trade base. */
export const IND_PER_WORKER = 0.45;
export const IND_EXPORT_BASE = 1000;
/**
 * Smallest denominators of the demand ratios (census.demandTarget): residents (res) and jobs
 * (com, ind), so a tiny town's demand doesn't swing on a handful of heads.
 */
export const RES_DEMAND_FLOOR = 1600;
export const JOB_DEMAND_FLOOR = 600;
/** Tax neutral point (percent) and demand change per percentage point. */
export const TAX_NEUTRAL = 7;
export const TAX_DEMAND = 0.045;
/** Demand change per approval point away from APPROVAL_NEUTRAL. */
export const APPROVAL_NEUTRAL = 55;
export const APPROVAL_DEMAND = 0.004;
/** Per-tick smoothing toward the target demand. */
export const DEMAND_SMOOTH = 0.12;

// ── Growth ───────────────────────────────────────────────────────────────────
/** Probability (per evaluation) that an empty lot develops = base + slope * demand. */
export const GROW_BASE = 0.12;
export const GROW_SLOPE = 0.55;
/** Upgrades to level 2 / 3. */
export const UPGRADE_MIN_AGE = [0, 24, 48];
export const UPGRADE_MIN_DEMAND = [0, 0.02, 0.05];
export const UPGRADE_BASE = [0, 0.07, 0.045];
export const UPGRADE_SLOPE = [0, 0.3, 0.22];
/** Tolerances for upgrading. Index = ZoneType. */
export const UPGRADE_MAX_POLLUTION = [1, 0.42, 0.62, 1];
export const UPGRADE_MAX_CRIME = 0.5;
export const UPGRADE_MAX_TRAFFIC = 0.86;
/** Health coverage speeds up residential upgrades. */
export const HEALTH_GROWTH_BONUS = 0.12;
/** Decline. */
export const UNPOWERED_GRACE_DAYS = 45;
export const ABANDON_UNPOWERED = 0.22;
export const ABANDON_NO_ROAD = 0.3;
export const DECLINE_DEMAND = -0.45;
export const DECLINE_MIN_AGE = 30;
export const ABANDON_CRIME = 0.75;
export const ABANDON_RES_POLLUTION = 0.8;
/** Abandoned buildings come back when conditions recover. */
export const RECOVER_CHANCE = 0.2;
export const RECOVER_MIN_DEMAND = -0.05;
export const RECOVER_MAX_CRIME = 0.65;
export const RECOVER_MAX_RES_POLLUTION = 0.65;
/** Long-abandoned shells collapse back to an empty lot. */
export const COLLAPSE_AGE = 180;
export const COLLAPSE_CHANCE = 0.03;

// ── Budget ───────────────────────────────────────────────────────────────────
/** Monthly credits per resident / filled job per tax percentage point. */
export const TAX_PER_RESIDENT = 0.0035;
export const TAX_PER_COM_JOB = 0.0045;
export const TAX_PER_IND_JOB = 0.004;
/** Land value multiplies tax yield: (LV_TAX_BASE + LV_TAX_SLOPE * landValue). */
export const LV_TAX_BASE = 0.75;
export const LV_TAX_SLOPE = 0.5;
/** Unpowered buildings pay this share of their taxes. */
export const UNPOWERED_TAX = 0.5;

// ── Approval ─────────────────────────────────────────────────────────────────
export const APPROVAL_BASE = 66;
export const APPROVAL_TAX = 2.2; // per point below/above 8%
export const APPROVAL_CRIME = 35;
export const APPROVAL_POLLUTION = 35;
export const APPROVAL_UNEMPLOYMENT = 70;
export const APPROVAL_POWER = 35;
export const APPROVAL_TRAFFIC = 12;
export const APPROVAL_SERVICES = 25;

// ── Events ───────────────────────────────────────────────────────────────────
/** No random events before this tick (~3 months). */
export const EVENT_GRACE_TICKS = 90;
/** Days between events: uniform in [min, max] (~2–4 months). */
export const EVENT_INTERVAL: [number, number] = [60, 120];
export const EVENT_MIN_POP = 600;
/** Per-tick decay of temporary event effects. */
export const CRIME_BOOST_DECAY = 0.965;
export const SMOG_DECAY = 0.955;
export const COM_BOOST_DECAY = 0.97;

// ── News ─────────────────────────────────────────────────────────────────────
export const FLAVOR_INTERVAL: [number, number] = [8, 20];
/** Advisor checks run every this many ticks. */
export const ADVISOR_PERIOD = 5;

// ── Metro network (MEGACITY §6.3) ───────────────────────────────────────────
/** Powered, online Metro Stations in ≥ 2 owned districts link: every station's transit radius then reads this. */
export const METRO_NET_RADIUS = 12;
/** Trips within METRO_TRIP_RADIUS (Chebyshev) of a linked station × this. */
export const METRO_TRIP_MUL = 0.9;
export const METRO_TRIP_RADIUS = 4;
/** A live Grand Terminal: every Maglev and Metro Station's transit radius × this, city-wide. */
export const TERMINAL_TRANSIT_MUL = 1.5;

// ── Landmark terms (MEGACITY §6.3) the census, the ports and the budget apply ─
/**
 * Raw visitors a month per live (online, powered) Megacity landmark, beside EXPANSION's TOURISM.landmark: Pearl Atrium
 * 20,000, Harbour Beacon 5,000, Arc Arena 25,000, Market Hall 1,500 each, and the Halo Lookout 15,000 only while bridged
 * into a Sky Lobby (sim/ports.ts). Here, not in config.ts, which is numbers-only for the existing names this wave.
 */
export const MEGA_LANDMARK_VISITORS: Readonly<Record<string, number>> = {
  pearlatrium: 20000,
  beacon: 5000,
  arena: 25000,
  markethall: 1500,
  halolookout: 15000,
  glasssmile: 30000, // MEGACITY §9.2 ending landmarks (kept after a Charter Review swap)
  breadpier: 10000,
};
/** Approval while a Charter Hall / Lamp Choir stands. */
export const CHARTER_HALL_APPROVAL = 3;
export const LAMP_CHOIR_APPROVAL = 2;
/** Each live Market Hall: approval +0.5 (cap +2) and Market demand +0.01 (cap +0.05). */
export const MARKET_HALL_APPROVAL = 0.5;
export const MARKET_HALL_APPROVAL_CAP = 2;
export const MARKET_HALL_DEMAND = 0.01;
export const MARKET_HALL_DEMAND_CAP = 0.05;
/** City-wide upkeep × this while a Lamp Choir stands. */
export const LAMP_CHOIR_UPKEEP_MUL = 0.98;
