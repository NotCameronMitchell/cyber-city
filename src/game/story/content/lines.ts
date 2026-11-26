// ─────────────────────────────────────────────────────────────────────────────
// Ticker and toast lines (docs/STORY.md §5.0 unlock news, §7.10 system lines)
// and the unlock fallback table (§5.0). Ticker lines are ≤ 90 chars after
// token fill.
// ─────────────────────────────────────────────────────────────────────────────

import { UNLOCK_FALLBACK_POP } from '../../config';
import type { NewsItem } from '../../types';
import type { FactionId, Unlockable } from '../types';

export interface SystemLine {
  text: string;
  kind: NewsItem['kind'];
  /** Shown as a toast instead of a ticker line. */
  toast?: true;
}

/**
 * Lines for events that have no card (§7.10). Variables: `{district}`, `{gang}` ("the
 * Undertow" / "the Glass Kites"; capitalise at a sentence start), `{stage}` (stage or
 * crown name), `{n}` stations, `{plant}` / `{building}` building names, `{faction}`.
 * turf.ts, vertical.ts and actions.ts post several of these themselves; the table is
 * the single reference copy.
 */
export const SYSTEM_LINES = {
  seedUndertow: { text: 'Fresh tags in {district}: a hook and a wave.', kind: 'bad' },
  seedKites: { text: 'Fresh tags in {district}: a diamond kite, drawn in one line.', kind: 'bad' },
  tagback: { text: "Tagback in {district}: {gang} paint over the wasps' work.", kind: 'bad' },
  crackdown: { text: 'Wasps over {district}. Doors kicked, tags scrubbed, nobody sleeps.', kind: 'info' },
  truceBroken: { text: 'The Seam Truce is over. Both crews heard the wasps first.', kind: 'bad' },
  pactSigned: { text: '{gang} keep to their streets. Somebody is paying for it.', kind: 'info' },
  pactBroken: { text: '{gang}: pact broken. Expect company.', kind: 'bad' },
  stageComplete: { text: '{stage} complete in {district}. The skyline steps up.', kind: 'good' },
  ribbonLive: { text: 'Ribbon live: {n} stations joined by light.', kind: 'good' },
  ribbonDead: { text: 'Ribbon line dark near {district}. It needs 2 powered stations.', kind: 'warn' },
  skybridgeSealed: { text: 'Skybridge sealed: an anchor dropped below the skyline.', kind: 'warn' },
  basaltPulse: { text: 'Basalt "maintenance" takes a {plant} offline for 20 days.', kind: 'bad' },
  undertowPulse: { text: 'Divers cut the feed to a {building} in {district}.', kind: 'bad' },
  nacrePulse: { text: 'Nacre screens run a soft smear on city hall. Approval dips.', kind: 'bad' },
  lureOutage: { text: 'Lamps stutter in {district}. Something else is in the wires.', kind: 'bad' },
  saltSent: { text: 'Salt sent. {faction} remembers.', kind: 'good', toast: true },
  noAnswer: { text: 'No answer. {faction} took that as a yes.', kind: 'info', toast: true },
} as const satisfies Record<string, SystemLine>;
export type SystemLineId = keyof typeof SYSTEM_LINES;

/** The news line a faction's Hostile pulse posts (§2.2, §7.10). */
export const PULSE_LINE: Partial<Record<FactionId, SystemLineId>> = {
  basalt: 'basaltPulse',
  nacre: 'nacrePulse',
  undertow: 'undertowPulse',
};

/** Unlock news (§5.0), posted by the director as `info`. */
export const UNLOCK_NEWS: Partial<Record<Unlockable, string>> = {
  factions: 'Unlocked: Factions. Everyone wants the switch.',
  comms: 'Unlocked: COMMS. Messages meant for no one, routed to you.',
  deals: 'Unlocked: Deals. Friendly factions will trade.',
  stack: 'Unlocked: Stratablock. Homes, shops and jobs, stacked.',
  crackdown: 'Unlocked: Crackdown. Inspect a precinct to send the wasps.',
  pact: 'Unlocked: Pacts. Some crews will keep to their streets.',
  turfOverlay: 'Unlocked: Turf overlay. See whose streets are whose.',
  skybridge: 'Unlocked: Skybridge. Link two towers across the sky.',
  rail: 'Unlocked: Ribbon Rail. Join two stations with light.',
  crowns: 'Unlocked: Crowns. Finish a Stratablock, pick a side.',
  glarewall: "Unlocked: Glarewall. Nacre's light, on your corners.",
  foundry: "Unlocked: Foundry Spine. Basalt's fire, on your grid.",
  memorial: 'Unlocked: Sunk Memorial. Eleven thousand names.',
};

/** Where an unlock comes from and what opens it without the story (§5.0). */
export interface UnlockSource {
  /** Story source, for docs and tooltips. */
  source: string;
  /** maxPop fallback, `'faction'` (only the faction gate), or `'story'` (story-only). */
  fallback: number | 'faction' | 'story';
}

const pop = (u: Unlockable): number => UNLOCK_FALLBACK_POP[u] as number;

/** Every Unlockable the story grants, with its fallback row (§5.0). */
export const UNLOCK_SOURCES: Partial<Record<Unlockable, UnlockSource>> = {
  factions: { source: 'Chapter I reward', fallback: pop('factions') },
  comms: { source: 'Chapter I reward', fallback: pop('comms') },
  stack: { source: 'Chapter II reward', fallback: pop('stack') },
  deals: { source: 'Chapter II reward', fallback: pop('deals') },
  crackdown: { source: 'Chapter III start', fallback: pop('crackdown') },
  pact: { source: 'Chapter III start', fallback: pop('pact') },
  turfOverlay: { source: 'Chapter III start', fallback: pop('turfOverlay') },
  skybridge: { source: 'Chapter III reward', fallback: pop('skybridge') },
  rail: { source: 'Chapter III reward', fallback: pop('rail') },
  crowns: { source: 'Chapter V reward', fallback: pop('crowns') },
  glarewall: { source: 'Chapter II vote (a Nacre win)', fallback: 'faction' },
  foundry: { source: 'Chapter II vote (a Basalt win)', fallback: 'faction' },
  memorial: { source: 'Chapter IV Publish, or the Full Recall coda', fallback: 'story' },
};
