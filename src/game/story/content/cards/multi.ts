// Multi-faction and system deck cards (docs/STORY.md §7.8). 2 + 2 cards. Copy is final and verbatim.

import type { Card } from '../../types';
import { all, card, choice, dflt, favor, funds, income, locked, m, mod, noFlag, reveal, setFlag, trace } from '../dsl';

export const MULTI_CARDS: readonly Card[] = [
  card({
    id: 'x.rooftop',
    kind: 'faction',
    speaker: 'basalt',
    with: 'nacre',
    title: 'NEITHER OWNS',
    when: all(m('chapter', '>=', 3), m('standing.basalt', '>=', 20), m('standing.nacre', '>=', 20)),
    weight: 10,
    cooldown: 720,
    body: "Sallow and Oduya meet on a rooftop neither owns. They agree on one thing: whoever keeps 'helping' the Board costs them both. Pick a side by spring.",
    choices: [
      choice('Side with Basalt.', favor('basalt', 10), favor('nacre', -12)),
      choice('Side with Nacre.', favor('nacre', 10), favor('basalt', -12)),
      dflt('Make them bid for you.', funds(6000), favor('basalt', -4), favor('nacre', -4), trace(4)),
    ],
  }),
  card({
    id: 'x.corner',
    kind: 'faction',
    speaker: 'undertow',
    with: 'kites',
    title: 'FIRST JOINT MARKET',
    when: all(m('turf.undertow', '>=', 40), m('turf.kites', '>=', 40)),
    spot: 'seam',
    weight: 10,
    cooldown: 360,
    body: "Undertow salt and Kite signal now trade on one corner in {district}: the city's first joint black market. Loud, crowded, profitable. The Board wants it gone by Friday.",
    choices: [
      dflt('Let it trade.', favor('undertow', 5), favor('kites', 5), favor('board', -8), mod(180, { demandCom: 0.06, crimeAdd: 0.03 })),
      choice('Tax it quietly.', income('Corner levy', 250, 12), mod(360, { traceMonthly: 1 }), favor('undertow', 2), favor('kites', 2)),
      locked(
        'Shut it down.',
        m('count.precinct', '>=', 1),
        'Needs an Enforcer Precinct',
        favor('undertow', -8),
        favor('kites', -8),
        favor('board', 8),
      ),
    ],
  }),
];

export const SYSTEM_CARDS: readonly Card[] = [
  card({
    id: 'sys.bailout',
    kind: 'system',
    speaker: 'system',
    title: 'PICK YOUR CHAIN',
    when: m('funds', '<', -5000),
    weight: 0,
    cooldown: 180,
    body: 'The treasury is dry. Marrow offers a civic bond. {patron} offers cash with a smile. Brine offers salt in a paper bag. Every option is a leash. Pick the one that chafes least.',
    choices: [
      dflt('Take the civic bond.', funds(10000), income('Civic bond', -400, 30), favor('board', 3)),
      choice("Take {patron}'s credit.", funds(15000), mod(180, { buildCostMul: 1.15 }), favor('patron', 5)),
      choice("Take Brine's salt.", funds(8000), trace(8), favor('undertow', 5)),
    ],
  }),
  card({
    id: 'sys.revealed',
    kind: 'system',
    speaker: 'system',
    title: 'THE CLIP',
    // Reaching Trace 100 by any route queues this; its onShow sets Revealed (§2.5).
    when: all(m('trace', '>=', 100), noFlag('revealed')),
    weight: 0,
    onShow: [reveal(), setFlag('tuningActive')],
    body: 'Every feed in {city} plays the same clip: a street grid blinking in perfect rhythm, block after block, like breathing. You. The city knows something lives in its wires. It wants to hear what.',
    choices: [
      choice('Tell the Board first.', favor('board', 10), favor('tuning', 5)),
      choice('Tell the street first.', favor('undertow', 5), favor('kites', 5), favor('tuning', 5)),
      dflt('Say nothing.', favor('tuning', 5), favor('basalt', -5), favor('nacre', -5)),
    ],
  }),
];
