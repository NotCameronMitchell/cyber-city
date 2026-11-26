// Megacity deck cards (docs/MEGACITY.md §8.3, "Districts, Scale, Skybridges and Variety"). Eleven faction cards
// that arise from what the player annexed and built: one per district kind (the eight `ds.*` cards, each drawable
// once a district of that kind is owned) and three for the new landmarks (`lm.*`). Titles, bodies, labels and
// effects are §8.3's; the briefs too, except that `ds.sunk`'s no longer names the Tuning (the card can show while
// the Tuning is still hidden, STORY.md §2.2, and the clarity lint keeps it a mystery: the Tuning −6 chip stays
// hidden the same way).
//
// They join DECK (and so CARD_LIST) but not FACTION_DECKS, as the expansion cards do. Every one is a weight-10
// faction card on a 720 d cooldown, `once`, with one ‡ default, a brief and no ⚑, ★, beat or queue: they add
// variety, not frequency (the pace's deck gates set the rate). None opens by itself; each waits in COMMS.
//
// The physical promises are kept by effects (§8.4): `ruins clear`, `brownfield clear`, `reeds drain` and
// `apron rehouse` / `apron clear` are reserved flags that run their district verb once (story/effects.ts
// DISTRICT_VERBS, since the frozen Effect union has no member for them), and `ds.skeleton` dims the Kites'
// turf on the frames with the `slot:skeleton` target. District names are written literally (no spot rule).

import type { Card } from '../../types';
import { all, card, choice, dflt, favor, flagIs, funds, income, m, mod, setFlag, trace, turfStr } from '../dsl';

/** Every megacity card is a weight-10, once-only faction card on a 720 d cooldown (§8.3). */
const BASE = { kind: 'faction', weight: 10, cooldown: 720, once: true } as const;

export const MEGACITY_CARDS: readonly Card[] = [
  card({
    ...BASE,
    id: 'ds.shoals',
    speaker: 'nacre',
    title: 'GLASS ON THE WATER',
    when: m('district.shoals', '>=', 1),
    body: "Oduya: 'Partner! The Shoals are the prettiest water in the city! A ferry with a glass bar, light shows on every island, and our logo on the tide tables. A tiny logo. Everyone reads tide tables!'",
    brief: 'Nacre wants to brand the Shoals with a luxury ferry and island light shows. It pays and lifts land value but annoys the Board. Refuse, or make Nacre fund public ferries as well.',
    choices: [
      choice('Put the logo on the tides.', favor('nacre', 8), favor('board', -3), funds(4000), mod(360, { landValueAdd: 0.01 })),
      dflt('Keep the water plain.', favor('nacre', -4), favor('board', 2)),
      choice('Public ferries too.', favor('nacre', 3), favor('board', 3), funds(2000)),
    ],
  }),
  card({
    ...BASE,
    id: 'ds.sunk',
    speaker: 'undertow',
    title: 'WHAT THE TIDE KEPT',
    // The Sunk only opens for annexing after ch4.brine, so this card always comes after the reveal.
    when: all(m('district.sunk', '>=', 1), m('turf.undertow', '>=', 10)),
    body: "Brine, on a roof above a flooded street: 'You know what lies under these streets now, little light. My people still live in them. Your surveyors paint numbers on our doors. Tell me what the numbers mean, and say it kindly.'",
    brief: "Old Brine's people live in the Sunk's ruins. Clearing them for builders pays but angers the Undertow. Giving them title turns the ruins into homes. Renting them the ruins pays quietly but raises Trace.",
    choices: [
      choice(
        'Clear the ruins.',
        favor('undertow', -15),
        favor('tuning', -6),
        favor('board', 2),
        funds(2500),
        mod(360, { approvalAdd: -1 }),
        setFlag('ruins', 'cleared'),
      ),
      dflt('Give them title to the ruins.', favor('undertow', 10), favor('board', -2), mod(360, { demandRes: 0.03 })),
      choice('Rent them the ruins.', favor('undertow', 5), trace(2), income('Ruin rent', 250, 12)),
    ],
  }),
  card({
    ...BASE,
    id: 'ds.flats',
    speaker: 'basalt',
    title: 'BROWNFIELD',
    when: m('district.flats', '>=', 1),
    body: "Sallow: 'The Flats hold forty years of slag, Operations. Cleaning it costs nine thousand. Building fabs on top of it costs nothing. The soil does not vote. I have checked.'",
    brief: "Basalt wants to build on the Flats' polluted soil as it is: fast and cheap for industry, but the smog stays. Pay to clean it all now, or let it clear slowly as the district grows.",
    choices: [
      choice('Build on it as it is.', favor('basalt', 8), favor('board', -3), mod(360, { demandInd: 0.04 })),
      choice('Clean it first: 9,000.', funds(-9000), favor('board', 4), favor('tuning', 2), setFlag('brownfield', 'cleared')),
      dflt('Let it clear slowly.', favor('basalt', 2)),
    ],
  }),
  card({
    ...BASE,
    id: 'ds.terraces',
    speaker: 'tuning',
    title: 'LAMPS ON THE HILL',
    when: all(m('district.terraces', '>=', 1), flagIs('tuningActive')),
    body: "Sister Ohm: 'On the terraces every window can see every other window, Hum. Let the families leave a lamp lit on the stairs. One lamp a step. The hill will read like a hymn.'",
    brief: 'The Tuning want a lamp on every terrace stair. It lifts approval and pleases them, but you pay the lamp bill and Nacre calls it clutter. Refuse, or let each block decide for itself.',
    choices: [
      choice('Light every step.', favor('tuning', 8), favor('nacre', -3), income('Stair lamps', -120, 24), mod('perm', { approvalAdd: 2 })),
      dflt('Keep the stairs dark.', favor('tuning', -4)),
      choice('Let each block decide.', favor('tuning', 3), mod('perm', { approvalAdd: 1 })),
    ],
  }),
  card({
    ...BASE,
    id: 'ds.reedmere',
    speaker: 'board',
    title: 'THE GREEN LUNG',
    when: m('district.reedmere', '>=', 1),
    body: "Marrow: 'Minutes. Item: the reed marsh filters more smog than four plazas and costs nothing. Item: developers want it drained. The Board asks you to protect it. Noted: the Board asked politely.'",
    brief: 'The Board wants the Reedmere reeds protected: free parkland and a happy Board, but Basalt wants the land. Drain the south bank for homes instead, or sell the drainage rights for cash.',
    choices: [
      dflt('Protect the reeds.', favor('board', 8), favor('basalt', -3), mod('perm', { approvalAdd: 1 })),
      choice('Drain the south bank.', favor('board', -4), favor('basalt', 3), mod(360, { demandRes: 0.05 }), setFlag('reeds', 'drained')),
      choice('Sell the drainage rights.', funds(5000), favor('board', -6), favor('nacre', 2)),
    ],
  }),
  card({
    ...BASE,
    id: 'ds.skeleton',
    speaker: 'kites',
    title: 'THE FRAMES',
    when: all(m('district.skeleton', '>=', 1), m('turf.kites', '>=', 10)),
    body: "lark: 'the frames in skeleton row are the best climbing in the city, moth. we live up there now. finish them if you want. just leave us the top floors. we keep the wasps off your cranes.'",
    brief: "The Glass Kites live in Skeleton Row's unfinished towers. Let them keep the top floors (Kites pleased, Nacre not), clear them out for your building crews, or charge them rent.",
    choices: [
      dflt('Leave them the top floors.', favor('kites', 10), favor('nacre', -4)),
      // The Kites' string lights go dark on the frames: their turf in every owned Skeleton Row district weakens.
      choice('Clear the frames.', favor('kites', -8), favor('board', 2), turfStr('kites', 'slot:skeleton', -60)),
      choice('Charge them rent.', favor('kites', 2), trace(1), income('Frame rent', 150, 24)),
    ],
  }),
  card({
    ...BASE,
    id: 'ds.tarmac',
    speaker: 'board',
    title: 'FAMILIES ON THE APRON',
    when: m('district.tarmac', '>=', 1),
    body: "Marrow: 'Resolved: the old airfield is open again. Noted: the families who moved onto the apron in the dark years would like to know if they are part of the plan. The Board would also like to know.'",
    brief: 'Families live on the old Tarmac Reach apron. Rehouse them properly (costs money, Board pleased), let them stay as an affordable quarter, or clear them out for the leaseholder.',
    choices: [
      choice('Rehouse them: 6,000.', funds(-6000), favor('board', 8), mod('perm', { approvalAdd: 1 }), setFlag('apron', 'rehoused')),
      dflt('Let them stay.', favor('board', 2), mod(360, { demandRes: 0.02 })),
      choice('Clear the apron.', favor('board', -6), favor('basalt', 3), favor('nacre', 3), setFlag('apron', 'cleared')),
    ],
  }),
  card({
    ...BASE,
    id: 'ds.bazaar',
    speaker: 'undertow',
    with: 'kites',
    title: 'WHO RUNS THE STALLS',
    when: all(m('district.bazaar', '>=', 1), m('turf.undertow', '>=', 10), m('turf.kites', '>=', 10)),
    body: "Brine and lark, on one call for once. Brine: 'Verdigris ran its night stalls before the Seam had a name, little light. Now they want one set of rules.' lark: 'ours.' Brine: 'Ours.' Then both of them wait, very politely, for you to pick a word.",
    brief: "Both gangs want to run the Verdigris Bazaar's night stalls. Pick one (the other gang is angry), split the stalls down the middle, or send in the Board's inspectors (both gangs dislike that).",
    choices: [
      choice('Give it to the Undertow.', favor('undertow', 10), favor('kites', -8)),
      choice('Give it to the Kites.', favor('kites', 10), favor('undertow', -8)),
      dflt('Split it down the middle.', favor('undertow', 3), favor('kites', 3), favor('board', -2)),
      choice('Send in the inspectors.', favor('undertow', -6), favor('kites', -6), favor('board', 6)),
    ],
  }),
  card({
    ...BASE,
    id: 'lm.arena',
    speaker: 'nacre',
    title: 'HOME GAME',
    when: m('count.arena', '>=', 1),
    body: "Oduya: 'Partner! Opening night at the Arena! We'd love to put residents' faces on the big screen between matches! Only the happy ones! Our software already knows which ones are happy!'",
    brief: "Nacre wants to scan the Arena crowd and show the happiest faces. Fans like it and Nacre pays, but it feeds Nacre's cameras and raises Trace. Refuse, or allow it for people who opt in.",
    choices: [
      choice('Let the cameras pick.', favor('nacre', 8), funds(3000), trace(2)),
      dflt('No faces on the screen.', favor('nacre', -4), favor('board', 2)),
      choice('Only people who opt in.', favor('nacre', 3), favor('board', 2)),
    ],
  }),
  card({
    ...BASE,
    id: 'lm.beacon',
    speaker: 'undertow',
    title: 'A LAMP ON THE WATER',
    when: m('count.beacon', '>=', 1),
    body: "Brine: 'You built a lamp on the water, little light. The divers love it. The night boats do not. Dim it on moonless nights and both of them will owe you. Keep it bright and only one will.'",
    brief: 'Old Brine asks you to dim the Harbour Beacon on dark nights so her boats can run. It pleases the Undertow and pays, but raises Trace. Keep it lit, or dim it and log every boat.',
    choices: [
      choice('Dim it on dark nights.', favor('undertow', 8), trace(2), income('Dark nights', 200, 12)),
      dflt('Keep it lit.', favor('undertow', -4), favor('board', 2)),
      choice('Dim it, and log every boat.', favor('undertow', -2), favor('board', 4), trace(-1)),
    ],
  }),
  card({
    ...BASE,
    id: 'lm.halo',
    speaker: 'kites',
    title: 'THE BEST VIEW',
    when: m('count.halolookout', '>=', 1),
    body: "lark: 'your halo lookout has the best view in the city, moth. and the best signal. we could hang one tiny relay under the rim. tourists would never see it. you wouldn't either. that's the point.'",
    brief: 'The Glass Kites want a hidden relay on the Halo Lookout. It pleases them and lowers Trace, but Nacre is annoyed. Refuse, or allow it and file a report with the Board.',
    choices: [
      choice('Let them hide it.', favor('kites', 10), trace(-2), favor('nacre', -3)),
      dflt('No relays on the Lookout.', favor('kites', -5)),
      choice('Allow it, and file a report.', favor('kites', 3), favor('board', 3), trace(1)),
    ],
  }),
];
