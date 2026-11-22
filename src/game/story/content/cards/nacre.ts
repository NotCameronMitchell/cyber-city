// Nacre deck cards (docs/STORY.md §7.4). 7 cards. Copy is final and verbatim.
// Nacre is the only speaker allowed exclamation marks.

import type { Card } from '../../types';
import { all, card, choice, dflt, favor, funds, local, locked, log, m, mod, queue, renew, trace, turfClear } from '../dsl';

export const NACRE_CARDS: readonly Card[] = [
  card({
    id: 'nc.feeds',
    kind: 'faction',
    speaker: 'nacre',
    title: 'A HUG, AT SCALE',
    when: all(m('approval', '<=', 55), m('chapter', '>=', 2)),
    weight: 10,
    cooldown: 360,
    body: "Oduya: 'Your citizens look tired! Let Nacre gently brighten the public screens. Warmer colours, kinder headlines. Just route the feeds through us. A hug, at scale.'",
    choices: [
      choice('Route the feeds.', mod(360, { approvalAdd: 6 }), favor('nacre', 10), trace(-3), favor('kites', -6), favor('tuning', -4)),
      dflt('Keep the feeds raw.', favor('nacre', -5), favor('kites', 3)),
    ],
  }),
  card({
    id: 'nc.census',
    kind: 'faction',
    speaker: 'nacre',
    title: 'LOYALTY PROGRAMME',
    when: m('pop', '>=', 3000),
    once: true,
    body: "Nacre wants the full census 'for the loyalty programme': names, faces, routines. 5,000 CR and a warm thank-you card. Oduya swears it's anonymised. It isn't. You checked.",
    choices: [
      choice('Sell the census.', funds(5000), favor('nacre', 12), favor('tuning', -8), favor('kites', -8), trace(2)),
      choice('Send a convincing fake.', favor('nacre', 4), trace(4), queue('nc.fake', 180)),
      dflt('Refuse.', favor('nacre', -8), favor('board', 3)),
    ],
  }),
  card({
    id: 'nc.fake',
    kind: 'faction',
    speaker: 'nacre',
    title: 'THREE HUNDRED OF HIM',
    queuedOnly: true,
    body: "Oduya, still smiling: 'Funny thing! Our loyalty data says 300 of your residents are the same man. He's very loyal. We'd love a refund, or a real census. Either is delightful!'",
    choices: [
      choice('Refund 3,000.', funds(-3000), favor('nacre', 2)),
      choice('Send the real one.', favor('nacre', 6), favor('tuning', -8), favor('kites', -8)),
      dflt('Deny everything.', favor('nacre', -15)),
    ],
  }),
  card({
    id: 'nc.renewal',
    kind: 'faction',
    speaker: 'nacre',
    title: 'URBAN RENEWAL',
    when: m('abandoned', '>=', 15),
    spot: 'abandoned',
    weight: 10,
    cooldown: 360,
    body: "Nacre wants the dead blocks in {district}. 'Urban renewal!' Clear the squatters, pave the lots, sell the view. The squatters are Undertow families. They were here first.",
    choices: [
      choice(
        'Approve the renewal.',
        renew('spot', 4),
        turfClear('undertow', 'spot', 4),
        local('spot', 6, 360, { lvAdd: 0.04 }),
        favor('nacre', 12),
        favor('undertow', -20),
      ),
      choice('Approve, but warn them.', renew('spot', 4), local('spot', 6, 360, { lvAdd: 0.04 }), favor('nacre', 6), favor('undertow', -4), trace(3)),
      dflt('Deny it.', favor('nacre', -8), favor('undertow', 8)),
    ],
  }),
  card({
    id: 'nc.premium',
    kind: 'faction',
    speaker: 'nacre',
    title: 'NO HOMES IN FRAME',
    when: all(m('avgLandValue', '>=', 0.4), m('dev.com', '>=', 40)),
    weight: 10,
    cooldown: 360,
    body: "Oduya wants three blocks declared premium: private drones, no noodle carts, no homes in frame. 'It's not exclusion! It's curation!' Nacre will pay well to keep shadeside off its postcards.",
    choices: [
      choice(
        'Sign the zoning deal.',
        funds(6000),
        favor('nacre', 15),
        favor('board', -10),
        mod(180, { demandRes: -0.1 }),
        mod(360, { landValueAdd: 0.02 }),
      ),
      dflt('Decline politely.', favor('nacre', -5)),
      choice('Leak the memo.', favor('nacre', -15), favor('board', 10), trace(5)),
    ],
  }),
  card({
    id: 'nc.focus',
    kind: 'faction',
    speaker: 'nacre',
    title: 'QUESTION FIVE',
    when: m('standing.nacre', '>=', 30),
    star: 9,
    body: "Oduya, delighted: 'We found our oldest focus group! 2086! Tiny budget, huge heart!' She sends the transcript. She hasn't read it. She never reads anything older than a quarter.",
    choices: [choice('Read question five.', log(9), trace(1)), dflt('Send it back unread.', favor('nacre', 3))],
  }),
  card({
    id: 'nc.blackout',
    kind: 'hostile',
    speaker: 'nacre',
    title: 'REDUCED EXPERIENCE',
    when: m('standing.nacre', '<=', -60),
    body: "Every Nacre screen in {city} goes grey. One line scrolls forever: 'We apologise for the reduced experience.' Oduya is very sorry. Oduya is not sorry.",
    choices: [
      choice('Apologise. Pay 6,000.', funds(-6000), favor('nacre', 20)),
      dflt('Live without screens.', mod(180, { demandCom: -0.2, taxIncomeMul: 0.9, landValueAdd: -0.04 })),
      locked(
        'Let the Kites hijack them.',
        m('standing.kites', '>=', 20),
        'Needs Kites Friendly',
        // No extra Nacre loss: a ⚑ side choice must not feed the hostility that drew it.
        favor('kites', 5),
        mod(60, { demandCom: -0.2, crimeAdd: 0.03 }),
      ),
    ],
  }),
];
