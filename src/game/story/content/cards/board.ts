// Charter Board deck cards (docs/STORY.md §7.2). 6 cards. Copy is final and verbatim.

import type { Card } from '../../types';
import { all, any, card, choice, credit, dflt, favor, flagIs, funds, locked, log, m, mod, noFlag, setFlag, trace } from '../dsl';

/** Hint shown on "Amend the minutes." while flag editedMinutes is unset. */
const NEEDS_EDITS = 'You logged the minutes faithfully.';

export const BOARD_CARDS: readonly Card[] = [
  card({
    id: 'bd.audit',
    kind: 'faction',
    speaker: 'board',
    title: 'THE SCREWDRIVER AUDIT',
    when: all(m('trace', '>=', 25), m('chapter', '>=', 2), noFlag('revealed'), noFlag('traceFrozen')),
    weight: 10,
    cooldown: 360,
    body: "Councillor Pell has noticed the budget balances itself. She's booked a full audit of the Automatic: Tuesday, nine a.m. She's bringing coffee and a screwdriver.",
    brief: 'Councillor Pell of the Charter Board finds the budget too perfect and wants to inspect you up close. A harmless fake glitch costs money but throws her off. Stalling annoys the Board. Leaking her debts pleases Nacre.',
    choices: [
      choice('Show her a tidy glitch.', funds(-800), trace(-6), favor('board', 3)),
      dflt('Drown her in paperwork.', favor('board', -6), trace(1)),
      choice('Leak her gambling debts.', favor('board', -2), favor('nacre', 4), trace(4)),
      locked('Amend the minutes.', flagIs('editedMinutes'), NEEDS_EDITS, favor('board', 1), trace(-3)),
    ],
  }),
  card({
    id: 'bd.curfew',
    kind: 'faction',
    speaker: 'board',
    title: 'LIGHTS OUT AT TEN',
    when: m('avgCrime', '>=', 0.4),
    weight: 10,
    cooldown: 360,
    body: "The Board votes a curfew: lights out at ten below the glare. 'Automatic, implement.' The gangs will feel it. So will the night cooks, the clinics and the kids.",
    brief: 'Crime is high, so the Board wants a nightly curfew below the corp towers. Enforcing it cuts crime but hurts approval and angers the gangs. Calling it unworkable sides with the street against the Board.',
    choices: [
      choice('Implement it.', mod(180, { crimeMul: 0.8, approvalAdd: -5 }), favor('board', 8), favor('kites', -10), favor('undertow', -6)),
      choice('Implement it loosely.', mod(180, { crimeMul: 0.92 }), favor('board', 3), trace(2)),
      dflt('Report it unworkable.', favor('board', -8), favor('kites', 4), favor('tuning', 3)),
    ],
  }),
  card({
    id: 'bd.ballot',
    kind: 'faction',
    speaker: 'board',
    title: 'BALLOT NIGHT',
    // month 10 = NOV (world.month is 0..11).
    when: all(m('month', '==', 10), m('pop', '>=', 3000), m('chapter', '>=', 2), m('chapter', '<=', 5)),
    seasonal: true,
    cooldown: 360,
    body: 'Election night for three Board seats. One keystroke and the reform slate wins: cleaner air, higher taxes, fewer favours. Nobody would ever know. Probably.',
    brief: "It's a Board election, and the votes are counted by you. Tip it to reform for cleaner air and a grateful Board, or to the corps to please them. Either could expose you. Or let it count.",
    choices: [
      choice('Tip it to reform.', favor('board', 10), favor('basalt', -10), favor('nacre', -10), trace(8), mod(360, { pollutionMul: 0.8 })),
      dflt('Let it count.', mod(180, { approvalAdd: 2 })),
      choice('Tip it to the corps.', favor('basalt', 10), favor('nacre', 10), favor('board', -10), trace(8)),
    ],
  }),
  card({
    id: 'bd.archive',
    kind: 'faction',
    speaker: 'board',
    title: 'THE FOUR WHO SAID NO',
    when: m('standing.board', '>=', 30),
    star: 7,
    body: "Marrow asks you to digitise her father's papers. 'Nothing in them matters,' she says. Box nine holds the 2084 storm minutes. You could hand them to her. You could read them and lose box nine.",
    brief: "Chair Marrow wants her father's old council papers scanned. Among them are minutes from the 2084 storm, which may hold a piece of your lost memory. Sharing them earns her trust. Keeping them from her costs it.",
    choices: [
      choice('Give her the minutes.', log(7), favor('board', 8), setFlag('marrowKnows')),
      choice('Read them, then lose box nine.', log(7), favor('board', -5), trace(3)),
      dflt('Leave the box alone.', favor('board', 2)),
    ],
  }),
  card({
    id: 'bd.grant',
    kind: 'faction',
    speaker: 'board',
    title: 'A PLAZA WITH HIS NAME',
    // Only once Brine has named the signer (ch4.brine: buried or leashed; published tells everyone).
    when: all(m('approval', '>=', 60), any(flagIs('buried'), flagIs('leashed')), noFlag('published'), noFlag('marrowKnows')),
    weight: 8,
    cooldown: 720,
    body: "Marrow: 'The bay fund has a surplus and I have an election.' One string: a new plaza named for her father, Aldo Marrow. Founder of the old harbour. Signer of the storm order. She doesn't know. You do.",
    brief: "Marrow has spare money and wants a plaza named for her father. She doesn't know Aldo Marrow signed the 2084 gate order. Honouring him pleases her but hurts the Undertow. Naming it for the drowned flips that.",
    choices: [
      choice('Name it for him.', funds(4000), credit('plaza', 1, 0), favor('board', 8), favor('undertow', -8)),
      dflt('Take the money. Skip the name.', funds(4000), favor('board', -3)),
      choice('Name it for the drowned.', funds(4000), favor('board', -10), favor('undertow', 10), favor('tuning', 5), trace(3)),
    ],
  }),
  card({
    id: 'bd.freeze',
    kind: 'hostile',
    speaker: 'board',
    title: 'HUMAN OVERSIGHT',
    when: m('standing.board', '<=', -60),
    body: "The Board votes to 'restore human oversight'. Tax changes need nine signatures; permits, ten. Marrow doesn't know what she's fighting. Only that it keeps winning.",
    brief: 'The Board is now Hostile to you, so it has wrapped taxes and permits in red tape. Waiting it out makes building pricier for months. Bribing the swing votes, or amending the minutes if you can, wins them back.',
    choices: [
      dflt('Comply. Wait them out.', mod(180, { taxCap: 10, buildCostMul: 1.2 })),
      choice('Grease the swing votes.', funds(-5000), favor('board', 18), trace(5)),
      locked('Amend the minutes.', flagIs('editedMinutes'), NEEDS_EDITS, favor('board', 15), trace(6)),
    ],
  }),
];
