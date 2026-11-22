// Basalt Consolidated deck cards (docs/STORY.md §7.3). 6 cards. Copy is final and verbatim.

import type { Card } from '../../types';
import { all, card, choice, credit, dflt, favor, funds, locked, log, m, mod, setFlag, trace } from '../dsl';

export const BASALT_CARDS: readonly Card[] = [
  card({
    id: 'ba.shift',
    kind: 'faction',
    speaker: 'basalt',
    title: 'THIRD SHIFT',
    when: m('dev.ind', '>=', 40),
    spot: 'industrial',
    weight: 10,
    cooldown: 360,
    body: "Sallow: 'Stop throttling our fabs after dark. A third shift in {district}. The homes will adjust to the hum. People adjust to anything, Operations. It's their best feature.'",
    choices: [
      choice('Unthrottle it.', mod(360, { demandInd: 0.12, pollutionMul: 1.15 }), mod(180, { approvalAdd: -3 }), favor('basalt', 10)),
      choice('Unthrottle it, for a fee.', mod(360, { demandInd: 0.12, pollutionMul: 1.15 }), funds(3000), favor('basalt', 4), trace(3)),
      dflt('Keep the throttle on.', favor('basalt', -6)),
    ],
  }),
  card({
    id: 'ba.strike',
    kind: 'faction',
    speaker: 'basalt',
    title: 'FORTY TENTS',
    when: all(m('unemployment', '<=', 0.06), m('dev.ind', '>=', 30)),
    spot: 'industrial',
    weight: 10,
    cooldown: 360,
    body: 'Fab crews in {district} walk out for filtered air and a raise. Sallow asks you to cut power to the picket camp. Forty tents. One clinic tent. It\'s cold tonight.',
    choices: [
      choice("Cut the camp's power.", favor('basalt', 12), mod(180, { approvalAdd: -6 }), favor('tuning', -10), favor('undertow', -5), trace(3)),
      choice(
        'Route their demands to the Board.',
        favor('board', 6),
        favor('basalt', -8),
        mod(90, { demandInd: -0.1 }),
        mod(360, { pollutionMul: 0.9 }),
      ),
      dflt('Keep the lights on. Wait.', favor('basalt', -4), mod(60, { demandInd: -0.15 })),
    ],
  }),
  card({
    id: 'ba.brand',
    kind: 'faction',
    speaker: 'basalt',
    title: 'GOOD BONES',
    when: m('count.stack', '>=', 1),
    weight: 10,
    cooldown: 720,
    body: "Sallow: 'Your stacks are good bones. Let Basalt brand the next one and we'll pour the plinth free.' Basalt cameras on every landing come standard. So does Basalt's idea of a fire exit.",
    choices: [
      choice('Brand it Basalt.', credit('stack', 1, 0), setFlag('branded', '+1'), favor('basalt', 8), favor('kites', -5)),
      dflt('Keep it civic.', favor('board', 3), favor('basalt', -3)),
    ],
  }),
  card({
    id: 'ba.smog',
    kind: 'faction',
    speaker: 'basalt',
    title: 'NOBODY BREATHES AT 3 A.M.',
    when: all(m('avgPollution', '>=', 0.2), m('dev.ind', '>=', 20)),
    weight: 10,
    cooldown: 360,
    body: "Sallow wants the scrubbers off after midnight. 'Nobody breathes at three a.m.' His fabs run double shifts the night you sign. The homes downwind will taste it first.",
    choices: [
      choice('Sign the waiver.', favor('basalt', 15), favor('board', -10), mod(240, { demandInd: 0.2, pollutionMul: 1.3 })),
      dflt('Keep the scrubbers on.', favor('basalt', -10)),
      choice('Pay for quieter shifts.', funds(-1500), favor('basalt', 5)),
    ],
  }),
  card({
    id: 'ba.purchase',
    kind: 'faction',
    speaker: 'basalt',
    title: 'SALVAGE RIGHTS',
    when: m('standing.basalt', '>=', 30),
    star: 8,
    body: "Basalt's archive bot flags an old purchase order for you, by mistake or not: 'Pump Station 6, contents, salvage rights.' Approved 2085. Never collected. There's a note in the margin, in pencil.",
    choices: [
      choice('Read the note.', log(8), trace(1)),
      choice('Ask Sallow about it.', log(8), favor('basalt', 5), trace(3)),
      dflt('Ignore the flag.'),
    ],
  }),
  card({
    id: 'ba.embargo',
    kind: 'hostile',
    speaker: 'basalt',
    title: 'REVIEWS END',
    when: m('standing.basalt', '<=', -60),
    body: "Basalt has 'paused deliveries pending review'. Cranes freeze mid-swing across {city}. Sallow's message is one line: 'Reviews end when cooperation begins.'",
    choices: [
      choice('Pay the review fee.', funds(-6000), favor('basalt', 20)),
      dflt('Wait it out.', mod(180, { buildCostMul: 1.35, upkeepMul: 1.15 })),
      locked(
        'Leak it to Nacre.',
        m('standing.nacre', '>=', 0),
        'Needs Nacre standing 0 or better',
        favor('nacre', 6),
        mod(90, { buildCostMul: 1.35 }),
        trace(3),
      ),
    ],
  }),
];
