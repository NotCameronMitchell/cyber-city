// ─────────────────────────────────────────────────────────────────────────────
// Epilogue deck cards (docs/MEGACITY.md §9.4): callback cards that only draw in
// Chapter VII. cards/index.ts spreads this list into DECK (and so CARD_LIST),
// so WP-8 never edits the index (§12).
//
// Every card is `once`, weight 10, cooldown 720, has exactly one default (‡) and
// a brief, no ⚑, no beat and no queue. They arrive through the deck's slots under
// the pace's deck gaps (Relaxed: ≥ 15 min apart) and wait in COMMS like any
// faction card: they add callbacks, never frequency, and never open by
// themselves. {seamPast}, {votePast} and {logsPast} resolve from the key choices
// (content/epilogue.ts). The five core cards are §9.4's, verbatim; the five
// optional ones (one per ending landmark, while it stands and its ending holds)
// are WP-8's copy under the same lint.
//
// `ep.fence` and `ep.leash` only set new flags (hallPoured, hallOpened,
// unleashed): `buried` and `leashed` stay, so the ending claims and the Board's
// permanent floor are unchanged (STORY.md §6.4).
// ─────────────────────────────────────────────────────────────────────────────

import type { Card, EndingId } from '../../types';
import { all, any, card, choice, dflt, favor, flagIs, funds, m, mod, setFlag, trace } from '../dsl';

/**
 * The optional cards' ending (§9.4: `ending = ironwork & count.gantry >= 1` …). The condition vocabulary has no
 * current-ending term, so the director keeps each of these out of the draw while its ending is not current
 * (director.drawDeck); the card's own `when` holds the rest.
 */
export const LANDMARK_CARD_ENDING: Readonly<Record<string, EndingId>> = {
  'ep.quota': 'ironwork',
  'ep.smile': 'pearl',
  'ep.pier': 'lowcrown',
  'ep.record': 'ledger',
  'ep.level': 'quiet',
};

/** Every epilogue card: a weight-10 card on a 720 d cooldown, once (§9.4). */
const EP = { weight: 10, cooldown: 720, once: true } as const;
const EPILOGUE = m('chapter', '>=', 7);

export const EPILOGUE_DECK: readonly Card[] = [
  // ── Core (§9.4) ──
  card({
    ...EP,
    id: 'ep.kite',
    kind: 'faction',
    speaker: 'kites',
    name: 'lark',
    title: 'THE KITE STILL FLIES',
    when: all(EPILOGUE, flagIs('larkKnows')),
    body: "lark: 'remember when you pinged back? i teach the new kids the dead channel now. they made you a kite. it's ugly. it flies anyway. they want to meet you. i said you're shy.'",
    brief: "Lark, grown up now, teaches the Glass Kites' rooftop kids, and they made a kite for you. Say hello (the Kites are pleased, a little Trace), or stay the story they tell.",
    choices: [choice('Ping them back.', favor('kites', 6), trace(1), setFlag('kiteHello')), dflt('Stay a story.', favor('kites', 2))],
  }),
  card({
    ...EP,
    id: 'ep.seam',
    kind: 'faction',
    speaker: 'undertow',
    with: 'kites',
    name: 'Brine and lark',
    title: 'ONE NIGHT AT THE SEAM',
    when: all(EPILOGUE, any(flagIs('truce'), flagIs('cleanGlass'), flagIs('oneTide'))),
    spot: 'seam',
    body: "Brine and lark, on one call. Brine: 'Since {seamPast}, the kids at the Seam keep one night a year for both crews, little light. No colours.' lark: 'and lights. lots of lights.' Brine: 'Some lights.'",
    brief: 'Years after {seamPast}, kids from both crews want one shared night at the Seam in {district}. Lighting it pleases both gangs and the Board. Leaving it to them pleases both a little.',
    choices: [
      choice('Light the Seam for them.', funds(-3000), favor('undertow', 4), favor('kites', 4), favor('board', 2), setFlag('seamFair')),
      dflt('Leave it to the crews.', favor('undertow', 1), favor('kites', 1)),
    ],
  }),
  card({
    ...EP,
    id: 'ep.names',
    kind: 'faction',
    speaker: 'undertow',
    name: 'Old Brine',
    title: 'THE NAMES',
    when: all(EPILOGUE, flagIs('published'), m('district.sunk', '>=', 1)),
    body: "Brine: 'We read the names at the old pump hall now, little light. Every year, the whole night through. Come and keep the lamps lit while we read. You know the way better than anyone.'",
    brief: 'Since you published the logs, the Undertow reads the names of the drowned every year at the old pump hall in the Sunk. Paying for the lamps honours them and lifts approval for good.',
    choices: [
      choice('Keep every lamp lit.', funds(-2000), favor('undertow', 6), mod('perm', { approvalAdd: 1 }, 'The names'), setFlag('namesLit')),
      dflt('Leave it to them.', favor('undertow', 2)),
    ],
  }),
  card({
    ...EP,
    id: 'ep.fence',
    kind: 'system',
    speaker: 'system',
    title: 'PRIVATE WORKS',
    when: all(EPILOGUE, flagIs('buried'), m('district.sunk', '>=', 1)),
    body: 'A letter from {patron}: the old pump hall in the Sunk is still listed as private works, fenced and dark. They would like to pour one slab over it and close the file. The water under it is quiet. For now.',
    brief: 'You buried the logs, and {patron} wants to bury the old pump hall too. Pouring over it pays well, but the Undertow will not forgive it. Leave it fenced, or open it to the public after all.',
    choices: [
      choice('Pour over it.', funds(15000), favor('undertow', -15), favor('patron', 5), setFlag('hallPoured')),
      dflt('Leave it fenced.'),
      choice('Open it after all.', favor('undertow', 10), favor('patron', -10), trace(4), mod(180, { approvalAdd: -2 }, 'The hall opened'), setFlag('hallOpened')),
    ],
  }),
  card({
    ...EP,
    id: 'ep.leash',
    kind: 'faction',
    speaker: 'board',
    name: 'Ilse Marrow',
    title: 'THE LEASH',
    // Retired with the Board under Ironwork, like every Board card (pacing.ts cardEligible).
    when: all(EPILOGUE, flagIs('leashed')),
    body: "Marrow: 'Minutes. Item: the leash you hold on this Board. Proposed: you take it off. Noted: we are asking, not telling. Noted: we know what that means. Noted: so do you.'",
    brief: 'Years ago you used the logs to leash the Board. Chair Marrow asks you to let it go. Freeing them pleases the Board a great deal. Keeping the leash keeps things as they are.',
    choices: [choice('Take the leash off.', favor('board', 12), setFlag('unleashed')), dflt('Keep the leash.', favor('board', -2))],
  }),

  // ── Optional: one per ending landmark, while it stands and its ending holds (§9.4) ──
  card({
    ...EP,
    id: 'ep.quota',
    kind: 'faction',
    speaker: 'basalt',
    name: 'Oren Sallow',
    title: 'THE QUOTA RISES',
    when: all(EPILOGUE, m('count.gantry', '>=', 1)), // and while ironwork holds (LANDMARK_CARD_ENDING)
    body: "Sallow, under the Gantry: 'Operations. The board says one hundred percent. Next month I want it to say one hundred and six. I have done the arithmetic. Your one dark window up in the cab is not in it.'",
    brief: "Basalt's Oren Sallow wants the Foreman's Gantry quota raised. Meeting it pleases Basalt and lifts industry for a year. You can meet it and still keep your one dark room, or ask for a holiday.",
    choices: [
      choice('Meet the new quota.', favor('basalt', 6), favor('tuning', -2), mod(360, { demandInd: 0.03 }, 'The new quota')),
      dflt('Meet it. Keep the dark room.', favor('basalt', 3)),
      choice('Ask for a holiday.', favor('basalt', -4), mod(180, { approvalAdd: 2 }, 'A holiday')),
    ],
  }),
  card({
    ...EP,
    id: 'ep.smile',
    kind: 'faction',
    speaker: 'nacre',
    name: 'Minna Oduya',
    title: 'A WINK FOR THE CITY',
    when: all(EPILOGUE, m('count.glasssmile', '>=', 1)), // and while pearl holds (LANDMARK_CARD_ENDING)
    body: "Oduya: 'The Glass Smile tested beautifully! Ninety-four percent delight! Now picture this: once a night, it winks. At one lucky person, anywhere in the city. They will tell everyone. You only have to say yes!'",
    brief: "Nacre's Minna Oduya wants the Glass Smile to wink at one person a night. Nacre is thrilled and the shops get busier, but the Glass Kites find it creepy. Or keep the smile just as it is.",
    choices: [
      choice('Let it wink.', favor('nacre', 6), favor('kites', -4), mod(360, { demandCom: 0.03 }, 'The wink')),
      dflt('Keep it a smile.', favor('nacre', -1)),
    ],
  }),
  card({
    ...EP,
    id: 'ep.pier',
    kind: 'faction',
    speaker: 'undertow',
    with: 'kites',
    name: 'Brine and lark',
    title: 'THE FIRST LOAF',
    when: all(EPILOGUE, m('count.breadpier', '>=', 1)), // and while lowcrown holds (LANDMARK_CARD_ENDING)
    body: "Brine: 'First night on the pier, little light. One long table, both crews, one loaf. Somebody has to cut it fair, and nobody trusts anybody's hands but yours.' lark: 'we voted. you won. obviously.'",
    brief: 'The Undertow and the Glass Kites open Bread Pier with one shared supper and want you, the Low Crown referee, to cut the bread. Cutting it pleases both crews. Leaving the knife to them pleases them a little.',
    choices: [
      choice('Cut it fair.', favor('undertow', 5), favor('kites', 5), mod(360, { approvalAdd: 1 }, 'The first loaf')),
      dflt('Leave the knife to them.', favor('undertow', 1), favor('kites', 1)),
    ],
  }),
  card({
    ...EP,
    id: 'ep.record',
    kind: 'faction',
    speaker: 'board',
    name: 'Ilse Marrow',
    title: 'STRIKE A LINE',
    when: all(EPILOGUE, m('count.recordtower', '>=', 1)), // and while ledger holds (LANDMARK_CARD_ENDING)
    body: "Marrow: 'Minutes. Item: a resident asks that one line be struck from the Record Tower. Her late husband's unpaid fine, 2089. Noted: the Ledger is open by law. Noted: she is crying. Noted: your call.'",
    brief: 'Under Open Ledger the Record Tower shows every line of the accounts. A resident asks for one painful line to be struck. Keeping it whole pleases the Board. Striking it, or paying the fine yourself, is kind.',
    choices: [
      dflt('Keep every line.', favor('board', 3)),
      choice('Strike the line.', favor('board', -4), mod(360, { approvalAdd: 1 }, 'The line struck')),
      choice('Pay the fine yourself.', funds(-1500), favor('board', 1), mod(360, { approvalAdd: 1 }, 'The fine paid')),
    ],
  }),
  card({
    ...EP,
    id: 'ep.level',
    kind: 'system',
    speaker: 'moth',
    title: 'A HAIR OUT OF LEVEL',
    when: all(EPILOGUE, m('count.stillsquare', '>=', 1)), // and while quiet holds (LANDMARK_CARD_ENDING)
    body: 'At 03:00 the great balance in the Still Square dips by a hair. Nobody sees it but you. Every faction still thinks it won a little. You could leave it. You could put it back before the sun comes up.',
    brief: 'The scales in the Still Square, the sign of your Quiet Hand, have tilted very slightly. Setting them level again pleases every faction a little. Leaving them changes nothing for now.',
    choices: [
      choice('Set it level again.', favor('corps', 1), favor('gangs', 1), favor('board', 1)),
      dflt('Leave it.'),
    ],
  }),
];
