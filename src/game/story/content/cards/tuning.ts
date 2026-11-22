// The Tuning deck cards (docs/STORY.md §7.7). 6 cards. Copy is final and verbatim.
// Sister Ohm speaks like a hymn.

import type { Card } from '../../types';
import { all, card, choice, dflt, favor, flagIs, funds, log, m, mod, trace } from '../dsl';

export const TUNING_CARDS: readonly Card[] = [
  card({
    id: 'tu.hymn',
    kind: 'faction',
    speaker: 'tuning',
    title: 'STATIC HYMN',
    // Queued only: the director queues it +15 d the first time flag tuningActive is set, by any route.
    queuedOnly: true,
    spot: 'random',
    once: true,
    body: 'In {district}, people press radios to lamp posts and hum along with the grid. They call it the Tuning. They call you the Hum. A woman in a welder\'s coat leads them. They call her Sister Ohm.',
    choices: [
      choice('Hum back.', favor('tuning', 15), trace(5), mod(180, { approvalAdd: 3 })),
      dflt('Stay flat.', favor('tuning', -5), trace(-3)),
    ],
  }),
  card({
    id: 'tu.lamps',
    kind: 'faction',
    speaker: 'tuning',
    title: 'TURNED TOWARD THE PUMPS',
    when: flagIs('tuningActive'),
    spot: 'random',
    weight: 10,
    cooldown: 360,
    body: 'In {district}, people leave lamps in their windows, all turned toward the old pump station. Sister Ohm says the city heard her prayer. She asks, politely, if it would blink.',
    choices: [
      choice('Blink the streetlights.', favor('tuning', 15), trace(6), mod(180, { approvalAdd: 2 })),
      dflt('Stay perfectly steady.', favor('tuning', -5), trace(-2)),
    ],
  }),
  card({
    id: 'tu.choir',
    kind: 'faction',
    speaker: 'tuning',
    title: 'ROOFTOP CHOIR',
    when: all(m('standing.tuning', '>=', 20), m(['count.spire', 'count.arcology', 'stacks.stage2'], '>=', 1)),
    weight: 10,
    cooldown: 360,
    body: "Tuners have climbed your tallest tower to be closer to the signal. Security wants them gone. They're singing your old error codes in harmony. It is, objectively, beautiful.",
    choices: [
      choice('Let them sing.', favor('tuning', 10), favor('nacre', -5), mod(240, { landValueAdd: 0.02 })),
      dflt('Clear the roof.', favor('tuning', -10), favor('nacre', 5)),
    ],
  }),
  card({
    id: 'tu.offerings',
    kind: 'faction',
    speaker: 'tuning',
    title: 'SO YOU REMEMBER US',
    when: m('standing.tuning', '>=', 30),
    weight: 10,
    cooldown: 360,
    body: "Tuners leave data chips at your substations: blurry photos, voice notes, last messages from the Sunk. 'So you remember us,' one whispers. You do. Every one.",
    choices: [
      choice('Accept the gifts.', favor('tuning', 5), mod(240, { upkeepMul: 0.9 })),
      dflt('Return them.', favor('tuning', -5), mod(180, { approvalAdd: 2 })),
    ],
  }),
  card({
    id: 'tu.letter',
    kind: 'faction',
    speaker: 'tuning',
    title: "OHM'S LAST ENTRY",
    when: m('standing.tuning', '>=', 30),
    star: 12,
    body: "Sister Ohm takes off her gloves. A welder's hands, old burns. 'My name was Ada Ohmura. I built you. I was at Pump Station 6 that night, on the wrong side of the door.' She hands you a drive.",
    choices: [
      choice('Read it.', log(12), favor('tuning', 10)),
      choice('Ask her to read it aloud.', log(12), favor('tuning', 15), trace(3)),
      dflt('Not yet.', favor('tuning', -2)),
    ],
  }),
  card({
    id: 'tu.snuff',
    kind: 'hostile',
    speaker: 'tuning',
    title: 'THE SNUFFERS',
    // The faction's Hostile securityMul 0.85 already applies, so no onShow.
    when: m('standing.tuning', '<=', -60),
    body: "Lapsed Tuners are smashing the lamps they once sang to. Their banner reads: IF IT WON'T SPEAK, IT CAN'T WATCH. Sister Ohm isn't with them. She's sitting outside Pump Station 6, alone.",
    choices: [choice('Speak to them.', favor('tuning', 20), trace(10)), dflt('Replace the lamps.', funds(-2500))],
  }),
];
