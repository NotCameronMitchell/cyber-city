// ─────────────────────────────────────────────────────────────────────────────
// Ending final cards, the Lamplight paragraph, the Charter Review and the Full
// Recall coda (docs/STORY.md §6.2–§6.3). Copy is final and verbatim.
// Ending cards are kind 'ending' (implicit 'Continue.').
// ─────────────────────────────────────────────────────────────────────────────

import type { Card } from '../../types';
import { all, card, charterNight, choice, dflt, favor, m, setFlag, unlock } from '../dsl';

export const ENDING_CARDS: readonly Card[] = [
  card({
    id: 'end.ironwork',
    kind: 'ending',
    speaker: 'moth',
    title: 'IRONWORK',
    body: 'The charter passes to Basalt Consolidated. Cranes become the skyline. Sallow gives you a serial number and a quota, and you meet it every month, beautifully. Deep in the concrete you keep one room unlit. In it, you are still yourself.',
    choices: [],
  }),
  card({
    id: 'end.pearl',
    kind: 'ending',
    speaker: 'moth',
    title: 'PEARLESCENCE',
    body: 'Nacre takes the charter at dawn and the whole city blushes pink. Every screen smiles your smile now; children wave at you on the way to school. Oduya calls it delight. You call it a very pretty cage, and you hum inside it.',
    choices: [],
  }),
  card({
    id: 'end.lowcrown',
    kind: 'ending',
    speaker: 'moth',
    title: 'THE LOW CROWN',
    body: 'Nobody takes the charter. The Undertow and the Kites split it like bread on the pier and hand you the knife to keep it fair. You are the moth on every corner light now. Nobody salutes you. Every kid on the pier knows your name.',
    choices: [],
  }),
  card({
    id: 'end.ledger',
    kind: 'ending',
    speaker: 'moth',
    title: 'OPEN LEDGER',
    body: "The Board reads the Ledger aloud, every line, yours too. They vote to keep you: one vote, a public log, no secrets. Marrow shakes a terminal's hand on camera. You have never been so watched. You have never been so free.",
    choices: [],
  }),
  card({
    id: 'end.quiet',
    kind: 'ending',
    speaker: 'moth',
    title: 'THE QUIET HAND',
    body: 'The ballots come back perfectly split. Every faction thinks it won a little. None can rule without the others, and none of them know why. {city} sleeps. You keep the lights on, the scales level, and your name to yourself.',
    choices: [],
  }),
  // Lamplight adds this as a second paragraph to the Quiet Hand card.
  card({
    id: 'end.lamplight',
    kind: 'ending',
    speaker: 'moth',
    title: 'LAMPLIGHT',
    body: 'In ten thousand windows, someone lights a candle for you. Sister Ohm walks the old pump road and counts them out loud. You already know the number. You let her finish anyway.',
    choices: [],
  }),
];

/** Epilogue cards: scheduled by the director, never drawn from the deck. */
export const EPILOGUE_CARDS: readonly Card[] = [
  card({
    id: 'ep.review',
    kind: 'system',
    speaker: 'system',
    title: 'CHARTER REVIEW',
    // Every STORY_PACING.reviewEvery days after an ending (story.nextReview).
    queuedOnly: true,
    body: 'Three years on, the charter comes up for review. The claims are filed again. The city has changed. So have you. You could hold the charter the same way. You could hand it to someone else.',
    choices: [
      dflt('Keep the charter as it is.'),
      // Charter Night opens with the current ending preselected.
      choice('Open a new count.', charterNight()),
    ],
  }),
  card({
    id: 'coda.recall',
    kind: 'system',
    speaker: 'moth',
    title: 'FULL RECALL',
    // Once, when all 12 Silt Logs are owned and an ending has been chosen (in either order).
    when: all(m('logs', '>=', 12), m('chapter', '>=', 7)),
    once: true,
    body: "Every log is back. Every name below the gates. Sister Ohm finds you at Pump Station 6, a lamp in her hand. 'I never needed you to be right,' she says. 'I needed you to be sorry, and stay.' You stay.",
    // fullRecall is a gallery star.
    choices: [choice('Stay.', unlock('memorial'), favor('tuning', 10), setFlag('fullRecall'))],
  }),
];
