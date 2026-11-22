// The Glass Kites deck cards (docs/STORY.md §7.6). 7 cards. Copy is final and verbatim.
// Lark types in lowercase.

import type { Card } from '../../types';
import { all, card, choice, dflt, favor, funds, income, log, m, mod, noFlag, offline, queue, setFlag, trace, turfSeed } from '../dsl';

export const KITES_CARDS: readonly Card[] = [
  card({
    id: 'kt.probe',
    kind: 'faction',
    speaker: 'kites',
    title: 'STILL PINGING',
    // Queued only, from ch1.lark ("Stay dark.").
    queuedOnly: true,
    when: noFlag('larkKnows'),
    body: "lark: 'ok so you're still there. i can see the pump channel blink when i type. you can stay dark, moth. but i'm a kite. we're very patient and very annoying.'",
    choices: [
      choice('Answer her this time.', favor('kites', 12), trace(4), setFlag('larkKnows')),
      choice('Blink once. Say nothing.', favor('kites', 4), trace(1)),
      dflt('Change the channel key.', favor('kites', -8), trace(-1)),
    ],
  }),
  card({
    id: 'kt.relay',
    kind: 'faction',
    speaker: 'kites',
    title: 'NOBODY LOOKS TWICE',
    when: all(m('count.datahub', '>=', 1), m('turf.kites', '>=', 20)),
    weight: 10,
    cooldown: 360,
    body: "lark: 'we kited a nacre uplink. free net for all of shadeside, ha. wasps are hunting the relay tho. hide it in your traffic? nobody looks twice at a moth.'",
    choices: [
      choice('Hide the relay.', favor('kites', 12), favor('nacre', -8), mod(180, { demandCom: 0.05 }), trace(3)),
      choice('Hide it. Skim it.', favor('kites', 4), income('Relay skim', 150, 12), trace(4)),
      dflt('Give it to the wasps.', favor('kites', -12), favor('nacre', 8)),
    ],
  }),
  card({
    id: 'kt.door',
    kind: 'faction',
    speaker: 'kites',
    title: 'ONE DOOR',
    when: all(m('count.precinct', '>=', 2), m('turf.kites', '>=', 30)),
    once: true,
    body: "lark: 'wasps caught fen. he's fourteen. they'll book him as a signal thief, six years. you run their door locks, moth. it's one door. please.'",
    choices: [
      choice('Open one door.', favor('kites', 15), favor('board', -8), trace(6), setFlag('fen', 'free'), queue('wh.fenFree', 180)),
      choice('Lose his paperwork.', favor('kites', 8), favor('board', -2), trace(3), setFlag('fen', 'free'), queue('wh.fenFree', 180)),
      dflt('Leave it locked.', favor('kites', -15), favor('board', 2), setFlag('fen', 'jailed'), queue('wh.fenJailed', 360)),
    ],
  }),
  card({
    id: 'kt.paint',
    kind: 'faction',
    speaker: 'kites',
    title: 'KITE-WING BIG',
    when: m('skybridges', '>=', 1),
    spot: 'skybridge',
    weight: 10,
    cooldown: 720,
    body: "lark: 'that skybridge over {district} is the best thing you ever built. we wanna paint it. kite-wing big, glow paint. nacre will hate it. that's the point. say yes.'",
    choices: [
      // flag mural switches the bridge art variant.
      choice('Say yes.', favor('kites', 10), favor('nacre', -6), turfSeed('kites', 'spot', 60), setFlag('mural')),
      choice('Say yes, in Nacre pink.', funds(-1000), favor('kites', 3), favor('nacre', 3)),
      dflt('Say no.', favor('kites', -5)),
    ],
  }),
  card({
    id: 'kt.file',
    kind: 'faction',
    speaker: 'kites',
    title: "WHAT'S MY POCKET WORTH",
    when: all(m('trace', '>=', 40), m('standing.kites', '<=', -20), noFlag('revealed'), noFlag('traceFrozen')),
    weight: 12,
    cooldown: 360,
    body: "lark: 'funny thing. got a file says {city} has a mind living in the meters. would play great on every screen at once. or it stays in my pocket. what's my pocket worth?'",
    choices: [
      choice('Pay 5,000 for the file.', funds(-5000), trace(-8), favor('kites', 5)),
      dflt('Call her bluff.', trace(12), favor('kites', -5)),
      choice("Trade her Nacre's secrets.", favor('kites', 10), favor('nacre', -10), trace(2)),
    ],
  }),
  card({
    id: 'kt.heartbeat',
    kind: 'faction',
    speaker: 'kites',
    title: '02:17',
    when: m('standing.kites', '>=', 30),
    star: 11,
    body: "lark: 'my mum logged a ping off the dead pump channel. every night, 02:17, six years. she called it the heartbeat. she died thinking it was a broken relay. was it you, moth?'",
    choices: [
      choice("'Yes. It was me.'", log(11), favor('kites', 8), trace(2)),
      choice("'I don't know yet.'", log(11), favor('kites', 3)),
      dflt('Say nothing.', favor('kites', -3)),
    ],
  }),
  card({
    id: 'kt.string',
    kind: 'hostile',
    speaker: 'kites',
    title: 'STRING CUT',
    when: m('standing.kites', '<=', -60),
    body: "At 3 a.m. every data hub in {city} blinks out. On each dead screen, the same drawing: a kite, its string cut. Lark doesn't sign it. She doesn't need to.",
    choices: [
      choice('Rebuild the links: 4,000.', funds(-4000)),
      dflt('Let them stay dark.', offline(['datahub'], 'all', 20)),
      choice('Make it right with Lark.', favor('kites', 20), favor('board', -6), trace(4)),
    ],
  }),
];
