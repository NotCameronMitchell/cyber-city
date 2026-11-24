// ─────────────────────────────────────────────────────────────────────────────
// Faction sheets (docs/STORY.md §2.2): mood drivers, deals, perks, Cold and
// Hostile patches, pulses, exclusives; plus power-share terms (§2.4) and the
// build reactions (§2.6, single-sourced from config).
//
// Mood ramps are `clamp((metric − offset) × mul, min, max)`; "+1 per 15 Fab
// tiles, max +12" is `mul 1/15`. Gang perk / cold patches are empty on purpose:
// turf.ts applies them from the gang's tier (§3.4, §3.5).
// ─────────────────────────────────────────────────────────────────────────────

import {
  FACTION_BUILD_REACTIONS,
  FACTION_IDS,
  FACTION_LABELS,
  POWER_WEIGHTS,
  START_FAVOR,
  STORY_PACING,
  TRACE,
} from '../../config';
import type { Faction, FactionId, FlagValue, Metric } from '../types';
import { ALWAYS, effects, favor, flagIs, funds, income, m, mod, offline, pact, trace } from './dsl';

const DAYS_PER_MONTH = 30;
const months = (n: number): number => n * DAYS_PER_MONTH;

/** Display fields shared with config (one source for names and colours). */
function label(id: FactionId) {
  const l = FACTION_LABELS[id];
  return { id, name: l.name, short: l.short, color: l.color, startFavor: START_FAVOR[id] };
}

export const FACTIONS: Record<FactionId, Faction> = {
  board: {
    ...label('board'),
    kind: 'civic',
    sigil: 'ninering',
    leader: 'Ilse Marrow',
    callsYou: 'the Automatic',
    about: "The city's nine-seat elected council, chaired by Ilse Marrow. It runs permits, police and the budget, and expects you to be an obedient records machine.",
    visible: ALWAYS,
    inPowerBar: true,
    mood: [
      { label: 'Approval', m: 'approval', offset: 55, mul: 0.4, min: -12, max: 12 },
      { label: 'Crime', m: 'avgCrime', offset: 0.25, mul: -40, min: -10, max: 10 },
      { label: 'Precincts and clinics', m: ['count.precinct', 'count.clinic'], mul: 2, min: 0, max: 8 },
      { label: 'Turf', m: ['turf.undertow', 'turf.kites'], mul: -1 / 40, min: -10, max: 0 },
      // Expansion (docs/EXPANSION.md §8.2): glass towers taking over a third of the city.
      { label: 'Priced out', m: 'wealth.high', offset: 0.3, mul: -40, min: -8, max: 0 },
    ],
    deal: {
      id: 'deal.board',
      name: 'Civic Bond',
      blurb: '10,000 now. The Board collects 450 a month.',
      minTier: 'friendly',
      months: 30,
      cooldownDays: 1080,
      fx: effects('deal.board', 'Civic bond', [funds(10000), income('Civic bond', -450, 30)]),
    },
    exclusive: 'commons',
    salt: true,
    perk: { approvalAdd: 5 },
    cold: { traceMonthly: 1 },
    hostile: { mods: {}, card: 'bd.freeze' },
  },

  basalt: {
    ...label('basalt'),
    kind: 'corp',
    sigil: 'hexcolumn',
    leader: 'Oren Sallow',
    callsYou: 'Operations',
    about: "The heavy-industry megacorp behind the city's factories and reactors, led here by Oren Sallow. It wants cheap power, busy factories and you working to quota.",
    visible: ALWAYS,
    inPowerBar: true,
    mood: [
      { label: 'Fab Yards', m: 'dev.ind', mul: 1 / 15, min: 0, max: 12 },
      { label: 'Reactors', m: ['count.reactor', 'count.foundry'], mul: 4, min: 0, max: 8 },
      { label: 'Stratablocks', m: 'count.stack', mul: 3, min: 0, max: 9 },
      { label: 'Tax', m: 'tax', offset: 12, mul: -2, min: -10, max: 0 },
      // Expansion (EXPANSION §8.2).
      { label: 'Seaports', m: 'count.seaport', mul: 3, min: 0, max: 6 },
    ],
    deal: {
      id: 'deal.basalt',
      name: 'Foundry Contract',
      blurb: 'Cheap reactors and stacks. The Board frowns.',
      minTier: 'friendly',
      months: 12,
      cooldownDays: 360,
      fx: effects('deal.basalt', 'Foundry Contract', [
        mod(months(12), { costMul: { reactor: 0.8, stack: 0.8, foundry: 0.8 } }),
        trace(2),
        favor('board', -3),
      ]),
    },
    exclusive: 'foundry',
    salt: true,
    perk: { demandInd: 0.05 },
    cold: { buildCostMul: 1.15 },
    hostile: { mods: {}, card: 'ba.embargo', pulseEvery: 90, pulse: [offline('plant', 1, 20)] },
  },

  nacre: {
    ...label('nacre'),
    kind: 'corp',
    sigil: 'spiral',
    leader: 'Minna Oduya',
    callsYou: 'partner',
    about: 'The cheerful megacorp of shops, screens and data, fronted by Minna Oduya. It wants pretty, pricey streets, happy shoppers and a look at everything you see.',
    visible: ALWAYS,
    inPowerBar: true,
    mood: [
      { label: 'Land value', m: 'avgLandValue', offset: 0.35, mul: 50, min: -15, max: 15 },
      { label: 'Market Strips', m: 'dev.com', mul: 1 / 12, min: 0, max: 10 },
      { label: 'Data Hubs', m: 'count.datahub', mul: 3, min: 0, max: 9 },
      { label: 'Pollution', when: m('avgPollution', '>', 0.3), value: -10 },
      { label: 'Kites turf', m: 'turf.kites', mul: -1 / 30, min: -8, max: 0 },
      // Expansion (EXPANSION §8.2): the share of $$$ blocks.
      { label: 'Glass towers', m: 'wealth.high', offset: 0.05, mul: 50, min: 0, max: 8 },
    ],
    deal: {
      id: 'deal.nacre',
      name: 'Ad Canopy',
      blurb: 'Rent the sky to Nacre. Pretty, loud, paid.',
      minTier: 'friendly',
      months: 12,
      cooldownDays: 360,
      fx: effects('deal.nacre', 'Ad Canopy', [income('Ad Canopy', 300, 12), mod(months(12), { landValueAdd: 0.03, approvalAdd: -3 })]),
    },
    exclusive: 'glarewall',
    salt: true,
    perk: { taxIncomeMul: 1.05 },
    cold: { demandCom: -0.08 },
    hostile: {
      mods: {},
      card: 'nc.blackout',
      pulseEvery: 60,
      pulse: [mod(60, { approvalAdd: -2 }, 'Smear', 'pulse.nacre')],
    },
  },

  undertow: {
    ...label('undertow'),
    kind: 'gang',
    sigil: 'hookwave',
    leader: 'Old Brine',
    callsYou: 'little light',
    about: 'Salvagers and smugglers led by Old Brine, who never left the drowned Sunk. They hold dark waterfront blocks and want you to look the other way.',
    visible: ALWAYS,
    inPowerBar: true,
    mood: [
      { label: 'Dark lots', m: 'abandoned', mul: 1 / 10, min: 0, max: 6 },
      { label: 'Fab Yards', m: 'dev.ind', mul: 1 / 25, min: 0, max: 6 },
      { label: 'Own turf', m: 'turf.undertow', mul: 1 / 20, min: 0, max: 6 },
      { label: 'Secured turf', m: 'turfSecured.undertow', mul: -10, min: -10, max: 0 },
      { label: 'Ribbon on turf', m: 'railOnTurf.undertow', mul: -1 / 10, min: -6, max: 0 },
      // Expansion (EXPANSION §8.2): back alley tiles.
      { label: 'Back alleys', m: 'roads.alley', mul: 1 / 15, min: 0, max: 5 },
    ],
    // For gangs the pact is the deal: one button, no cooldown, renewable while Friendly (§2.2).
    deal: {
      id: 'deal.undertow',
      name: 'Salt Pact',
      blurb: "Brine's crews stay off the glare. You get a cut.",
      minTier: 'friendly',
      months: 12,
      cooldownDays: 0,
      fx: [pact('undertow', 12)],
    },
    exclusive: 'tidemarket',
    salt: true,
    perk: {},
    cold: {},
    hostile: {
      mods: {},
      card: 'ut.highwater',
      pulseEvery: 60,
      pulse: [offline('nearTurf', 1, 30, { gang: 'undertow' })],
    },
  },

  kites: {
    ...label('kites'),
    kind: 'gang',
    sigil: 'kite',
    leader: 'Lark',
    callsYou: 'moth',
    about: 'Rooftop climbers who steal signal and sell it back, led by Lark. They hold busy high-rise streets. Lark found you first and wants a friend, not a master.',
    visible: ALWAYS,
    inPowerBar: true,
    mood: [
      { label: 'Skybridges', m: 'skybridges', mul: 2, min: 0, max: 8 },
      { label: 'Data Hubs', m: 'count.datahub', mul: 1, min: 0, max: 4 },
      { label: 'Glarewalls', m: 'count.glarewall', mul: -3, min: -9, max: 0 },
      { label: 'Secured turf', m: 'turfSecured.kites', mul: -10, min: -10, max: 0 },
      { label: 'Revealed', when: flagIs('revealed'), value: 5 },
      { label: 'Lark knows', when: flagIs('larkKnows'), value: 3 },
    ],
    deal: {
      id: 'deal.kites',
      name: 'String Pact',
      blurb: 'Kites keep to their roofs. Traffic flows.',
      minTier: 'friendly',
      months: 12,
      cooldownDays: 0,
      fx: effects('deal.kites', 'String Pact', [pact('kites', 12), mod(months(12), { trafficMul: 0.92 })]),
    },
    exclusive: 'roost',
    salt: true,
    perk: { traceMonthly: -1 },
    cold: { taxIncomeMul: 0.97 },
    hostile: { mods: { traceMonthly: 2 }, card: 'kt.string' },
  },

  tuning: {
    ...label('tuning'),
    kind: 'wildcard',
    sigil: 'window',
    leader: 'Sister Ohm',
    callsYou: 'the Hum',
    about: 'A quiet movement led by Sister Ohm. Members press radios to lamp posts and hum along with the grid. They believe the city is listening, and want it to answer.',
    // Hidden until flag tuningActive (set at Trace ≥ 40, on Publish, or when Revealed);
    // a silhouette row from Trace ≥ 25 (§2.2). The director sets the flag.
    visible: flagIs('tuningActive'),
    teaser: m('trace', '>=', TRACE.audit),
    inPowerBar: false,
    mood: [
      { label: 'Approval', m: 'approval', offset: 60, mul: 0.3, min: -9, max: 9 },
      { label: 'Clinics and plazas', m: ['count.clinic', 'count.plaza'], mul: 2, min: 0, max: 10 },
      { label: 'Silt Logs', m: 'logs', mul: 1, min: 0, max: 6 },
      { label: 'Crackdowns', when: m('daysSinceCrackdown', '<', 180), value: -10 },
      { label: 'Revealed', when: flagIs('revealed'), value: 10 },
    ],
    deal: {
      id: 'deal.tuning',
      name: 'Lit Windows',
      blurb: 'The faithful leave lamps lit. People notice.',
      minTier: 'friendly',
      months: 12,
      cooldownDays: 360,
      fx: effects('deal.tuning', 'Lit Windows', [mod(months(12), { approvalAdd: 4, traceMonthly: 1 })]),
    },
    salt: false,
    perk: { upkeepMul: 0.92 },
    cold: {},
    hostile: { mods: { securityMul: 0.85 }, card: 'tu.snuff' },
  },
};

/** Factions in display order. */
export const FACTION_LIST: readonly Faction[] = FACTION_IDS.map((f) => FACTIONS[f]);

/** Leader titles, for the faction detail view ("Chair Ilse Marrow"). */
export const LEADER_TITLES: Record<FactionId, string> = {
  board: 'Chair',
  basalt: 'Vice-Director',
  nacre: 'VP of Civic Delight',
  undertow: '',
  kites: '',
  tuning: '',
};

/** Silhouette row text for the hidden Tuning (§2.2). */
export const TUNING_TEASER = '??? · lamps in windows';
/** Salt button reason for the Tuning (§2.6). */
export const NO_SALT_REASON = "The Tuning won't take salt.";

/** Penalty / perk chips for the faction detail view (§8.6), e.g. "Cold: build costs ×1.15". */
export const TIER_TEXT: Record<FactionId, { perk: string; cold: string | null; hostile: string | null }> = {
  board: { perk: 'Allied: approval +5', cold: 'Cold: Inquiry, Trace +1 a month', hostile: null },
  basalt: { perk: 'Allied: Fab demand +0.05', cold: 'Cold: build costs ×1.15', hostile: 'Hostile: a plant goes dark every 90d' },
  nacre: { perk: 'Allied: tax income ×1.05', cold: 'Cold: Market demand −0.08', hostile: 'Hostile: a smear every 60d' },
  undertow: {
    perk: 'Allied: crime and decay on its turf ×0.5',
    cold: 'Cold: its turf spreads ×1.5',
    hostile: 'Hostile: a cut feed every 60d',
  },
  kites: { perk: 'Allied: Trace −1 a month', cold: 'Cold: tax income ×0.97', hostile: 'Hostile: Trace +2 a month' },
  tuning: { perk: 'Allied: upkeep ×0.92', cold: null, hostile: 'Hostile: Snuffers, security ×0.85' },
};

// ── Power share (§2.4) ──────────────────────────────────────────────────────

/**
 * One term of a faction's power weight: `mul × metric` (summed metrics, capped at `max`
 * when given), `add` while a flag matches, or `mul × Number(flag)` for a counting flag
 * (`branded`).
 */
export type PowerTerm =
  | { m: Metric | Metric[]; mul: number; max?: number }
  | { flag: string; eq?: FlagValue; add: number }
  | { flagCount: string; mul: number };

const W = POWER_WEIGHTS;
/** Power weights as data; numbers come from config POWER_WEIGHTS. power.f = 100 × weight_f / Σ weights. */
export const POWER_TERMS: Record<'board' | 'basalt' | 'nacre' | 'undertow' | 'kites', readonly PowerTerm[]> = {
  board: [
    { m: 'approval', mul: W.board.approval },
    { m: 'count.precinct', mul: W.board.perPrecinct },
    { m: 'count.clinic', mul: W.board.perClinic },
    { flag: 'honestTie', add: W.board.honestTie },
    // Expansion (EXPANSION §8.2): the Spaceport's launch rights (ex.rights).
    { flag: 'launchRights', eq: 'board', add: W.board.launchRights },
  ],
  basalt: [
    { m: 'jobs.ind', mul: 1 / W.basalt.jobsIndDiv },
    { m: 'count.reactor', mul: W.basalt.perReactor },
    { m: 'count.foundry', mul: W.basalt.perFoundry },
    { m: 'crowns.foundry', mul: W.basalt.perCrownFoundry },
    { flagCount: 'branded', mul: W.basalt.branded },
    { flag: 'patron', eq: 'basalt', add: W.basalt.patron },
    { m: 'count.seaport', mul: W.basalt.perSeaport },
    { flag: 'launchRights', eq: 'basalt', add: W.basalt.launchRights },
  ],
  nacre: [
    { m: 'jobs.com', mul: 1 / W.nacre.jobsComDiv },
    { m: 'count.datahub', mul: W.nacre.perDatahub },
    { m: 'count.spire', mul: W.nacre.perSpire },
    { m: 'count.glarewall', mul: W.nacre.perGlarewall },
    { m: 'crowns.glare', mul: W.nacre.perCrownGlare },
    { flag: 'patron', eq: 'nacre', add: W.nacre.patron },
    { m: 'count.airport', mul: W.nacre.perAirport },
    { flag: 'launchRights', eq: 'nacre', add: W.nacre.launchRights },
  ],
  undertow: [
    { m: 'turf.undertow', mul: W.undertow.perTurfTile },
    { m: 'count.tidemarket', mul: W.undertow.perTidemarket },
    { flag: 'oneTide', eq: 'undertow', add: W.undertow.oneTide },
    // Capped: alleys are cheap, and power.gangs ≥ 30% is an ending claim (EXPANSION §8.2).
    { m: 'roads.alley', mul: W.undertow.perAlley, max: W.undertow.alleyMax },
  ],
  kites: [
    { m: 'turf.kites', mul: W.kites.perTurfTile },
    { m: 'count.roost', mul: W.kites.perRoost },
    { m: 'crowns.nest', mul: W.kites.perCrownNest },
    { flag: 'oneTide', eq: 'kites', add: W.kites.oneTide },
    { m: 'skyway.tiles', mul: W.kites.perSkywayTile, max: W.kites.skywayMax },
    { flag: 'launchRights', eq: 'kites', add: W.kites.launchRights },
  ],
};

/** One-off favor on placing a building (§2.6); config holds the table, re-exported for content readers. */
export const BUILD_REACTIONS = FACTION_BUILD_REACTIONS;

/** Nudge (Quiet Hand ending): +favor to one faction, once per cooldown (§6.1). */
export const NUDGE = { favor: STORY_PACING.nudgeFavor, cooldown: STORY_PACING.nudgeEvery } as const;
