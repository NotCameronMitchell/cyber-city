// ─────────────────────────────────────────────────────────────────────────────
// The five endings (docs/STORY.md §6.1, §6.4): claims checked live on Charter
// Night, the final card, and the post-ending ModPatch and rules. Nothing here
// is applied as a one-off: resolveMods, the faction code and the director read
// the current ending's `post` and `rules` every time they run.
// ─────────────────────────────────────────────────────────────────────────────

import type { Ending, EndingId } from '../types';
import { ALWAYS, all, any, flagIs, m, noFlag } from './dsl';

export const ENDINGS: Record<EndingId, Ending> = {
  ironwork: {
    id: 'ironwork',
    title: 'Ironwork',
    becomes: 'The Foreman',
    claims: [
      { label: 'Basalt standing 60+', cond: m('standing.basalt', '>=', 60), show: { m: 'standing.basalt', target: 60 } },
      { label: 'Basalt power 25%+', cond: m('power.basalt', '>=', 25), show: { m: 'power.basalt', target: 25 } },
      { label: 'Basalt is your patron', cond: flagIs('patron', 'basalt') },
    ],
    card: 'end.ironwork',
    post: {
      demandInd: 0.15,
      costMul: { reactor: 0.85, stack: 0.85, foundry: 0.85 },
      pollutionMul: 1.15,
      taxCap: 15,
    },
    rules: { floors: { basalt: 0 }, retire: ['board'], retiredLabel: 'Absorbed into Basalt' },
  },
  pearl: {
    id: 'pearl',
    title: 'Pearlescence',
    becomes: 'The Smile',
    claims: [
      { label: 'Nacre standing 60+', cond: m('standing.nacre', '>=', 60), show: { m: 'standing.nacre', target: 60 } },
      { label: 'Nacre power 25%+', cond: m('power.nacre', '>=', 25), show: { m: 'power.nacre', target: 25 } },
      { label: 'Nacre is your patron', cond: flagIs('patron', 'nacre') },
    ],
    card: 'end.pearl',
    // Glarewalls free; the pink palette shift comes from VisualState.palette.
    post: {
      demandCom: 0.15,
      landValueAdd: 0.05,
      crimeMul: 0.8,
      costMul: { glarewall: 0 },
      favorMonthly: { kites: -1 },
    },
    rules: {},
  },
  lowcrown: {
    id: 'lowcrown',
    title: 'The Low Crown',
    becomes: 'The moth on every corner',
    claims: [
      { label: 'Undertow standing 40+', cond: m('standing.undertow', '>=', 40), show: { m: 'standing.undertow', target: 40 } },
      { label: 'Kites standing 40+', cond: m('standing.kites', '>=', 40), show: { m: 'standing.kites', target: 40 } },
      { label: 'Gang power 30%+', cond: m('power.gangs', '>=', 30), show: { m: 'power.gangs', target: 30 } },
      { label: 'Seam Truce or gone to ground', cond: any(flagIs('truce'), flagIs('wentToGround')) },
    ],
    card: 'end.lowcrown',
    // Both pacts permanent (40% cut, no spread limits).
    post: { turfCrimeMul: 0.4, upkeepMulType: { precinct: 0.5 } },
    rules: {
      floors: { undertow: 20, kites: 20 },
      ceils: { basalt: 20, nacre: 20 },
      permanentPacts: true,
      pactNoLimits: true,
    },
  },
  ledger: {
    id: 'ledger',
    title: 'Open Ledger',
    becomes: 'The Public Record',
    claims: [
      { label: 'Board standing 40+', cond: m('standing.board', '>=', 40), show: { m: 'standing.board', target: 40 } },
      { label: 'Approval 65%+', cond: m('approval', '>=', 65), show: { m: 'approval', target: 65 } },
      { label: 'Revealed', cond: flagIs('revealed') },
      { label: 'Board not leashed', cond: noFlag('leashed') },
      { label: 'Logs not buried', cond: noFlag('buried') },
    ],
    card: 'end.ledger',
    // Salt and Pacts locked; off-ledger income ends; the Trace gauge is retired.
    post: { approvalAdd: 8, taxDemandMul: 0.5, upkeepMul: 0.9 },
    rules: { lockSalt: true, lockPacts: true, endOffLedger: true, retireTrace: true },
  },
  quiet: {
    id: 'quiet',
    title: 'The Quiet Hand',
    becomes: 'Nobody',
    // Always selectable.
    claims: [{ label: 'Always open', cond: ALWAYS }],
    card: 'end.quiet',
    // Every faction stays active; Nudge once per 360 d.
    post: { cardRateMul: 1.3 },
    rules: {
      nudge: true,
      variant: {
        when: all(flagIs('tuningActive'), m('standing.tuning', '>=', 50)),
        id: 'lamplight',
        // Plus window candles everywhere (VisualState.candles = 1).
        post: { approvalAdd: 5 },
        card: 'end.lamplight',
      },
    },
  },
};

/** Charter Night row order (§8.10): bottom-aligned, the Quiet Hand last, right above Recount. */
export const ENDING_ORDER: readonly EndingId[] = ['ironwork', 'pearl', 'lowcrown', 'ledger', 'quiet'];
export const ENDING_LIST: readonly Ending[] = ENDING_ORDER.map((id) => ENDINGS[id]);

/** Charter Night copy (§6.1, §8.10). `{year}` is the current year. */
export const CHARTER_NIGHT_TEXT = {
  header: 'CHARTER NIGHT · {year}',
  becomes: 'MOTH becomes: ',
  became: 'MOTH became: ',
  recount: 'Recount · six more months',
  hold: 'Hold the charter',
  back: 'Back',
  keepBuilding: 'Keep building',
  newCity: 'New city',
} as const;

/** Confirm-sheet question per ending (§6.1: "Hold the charter for Basalt?"). */
export const CHARTER_CONFIRM: Record<EndingId, string> = {
  ironwork: 'Hold the charter for Basalt?',
  pearl: 'Hold the charter for Nacre?',
  lowcrown: 'Hold the charter for the crews?',
  ledger: 'Hold the charter for the public?',
  quiet: 'Hold the charter for no one?',
};
