// The Undertow deck cards (docs/STORY.md §7.5). 7 cards. Copy is final and verbatim.

import type { Card } from '../../types';
import { abandon, all, card, choice, dflt, favor, funds, locked, log, m, mod, offline, pact, trace, turfStr } from '../dsl';

const NEEDS_PRECINCT = 'Needs an Enforcer Precinct';

export const UNDERTOW_CARDS: readonly Card[] = [
  card({
    id: 'ut.salt',
    kind: 'faction',
    speaker: 'undertow',
    title: 'A PINCH OF SALT',
    when: all(m('turf.undertow', '>=', 40), m('pactActive.undertow', '==', 0)),
    weight: 10,
    cooldown: 360,
    body: "A jar of bay salt on a precinct step. Old Brine: 'My tidemarkets run blessed or not, little light. Take a pinch of the profit. Keep your wasps off my piers.'",
    brief: 'Old Brine, head of the Undertow salvage gang, offers a pact: keep the police drones off her piers and she shares her profits. Her turf calms down, but secret money slowly raises Trace. Or raid her turf instead.',
    choices: [
      choice('Take the pinch.', pact('undertow', 12), favor('undertow', 10)),
      locked(
        'Send the wasps.',
        m('count.precinct', '>=', 1),
        NEEDS_PRECINCT,
        turfStr('undertow', 'strongestTurf', -50, 8),
        favor('undertow', -15),
        favor('board', 5),
      ),
      dflt('Do nothing. Watch.', favor('undertow', -3)),
    ],
  }),
  card({
    id: 'ut.surge',
    kind: 'faction',
    speaker: 'undertow',
    title: 'STORM SURGE',
    when: all(m('pop', '>=', 20000), m('turf.undertow', '>=', 10)),
    spot: 'waterfrontTurf',
    weight: 10,
    cooldown: 360,
    body: "Storm surge tonight. The pumps under {district} can save the homes or the Undertow's flooded market. Not both. Old Brine is listening. So is 2084.",
    brief: "A storm is hitting {district}, and the pumps can protect the homes or the Undertow's market, not both. Saving homes keeps residents happy but hurts the gang. Saving the market empties some homes.",
    choices: [
      choice('Save the homes.', favor('undertow', -10), mod(90, { approvalAdd: 3 }), turfStr('undertow', 'spot', -30, 6)),
      choice('Save the market.', favor('undertow', 15), abandon('spot', 6, 6, 'res'), mod(90, { approvalAdd: -4 })),
      dflt('Split the pumps.', funds(-2000), favor('undertow', 4), abandon('spot', 6, 3, 'res')),
    ],
  }),
  card({
    id: 'ut.recruits',
    kind: 'faction',
    speaker: 'undertow',
    title: 'A JOBS PROGRAMME',
    when: all(m('unemployment', '>=', 0.12), m('turf.undertow', '>=', 10)),
    spot: 'turf:undertow',
    weight: 10,
    cooldown: 360,
    body: "Jobless kids in {district} are signing on with the Undertow. Brine calls it a jobs programme. The Board calls it a gang. They're reading from the same list of names.",
    brief: "Out-of-work young people in {district} are joining the Undertow. Letting it happen grows the gang's turf. A job fair costs money but boosts industry instead. A raid hits the gang but upsets residents.",
    choices: [
      dflt('Let her hire them.', favor('undertow', 8), turfStr('undertow', 'spot', 20, 5), mod(180, { demandRes: 0.03 })),
      choice('Fund a fab job fair.', funds(-2500), mod(180, { demandInd: 0.1 }), favor('undertow', -5), favor('basalt', 4)),
      choice('Raid the hiring hall.', favor('undertow', -12), favor('board', 4), mod(90, { approvalAdd: -2 })),
    ],
  }),
  card({
    id: 'ut.pylons',
    kind: 'faction',
    speaker: 'undertow',
    title: 'WHAT HOLDS THEM UP',
    when: m('railOnTurf.undertow', '>=', 6),
    weight: 10,
    cooldown: 360,
    body: "Brine: 'Your ribbon shades my markets and flies wasps over my roofs. Reroute it, or my divers learn what holds those pylons up.' Below, a wrench taps steel. Twice.",
    brief: "Your Ribbon Rail runs over Undertow turf, and Old Brine wants it gone. Pay her off, ignore her and she'll knock out part of the line for a while, or post police drones along it if you have a Precinct.",
    choices: [
      choice('Pay her off: 3,000.', funds(-3000), favor('undertow', 8)),
      // The live line with the most tiles on Undertow turf goes dead.
      dflt('Ignore her.', favor('undertow', -10), offline('rail', 1, 30, { gang: 'undertow' })),
      locked('Post wasps on the line.', m('count.precinct', '>=', 1), NEEDS_PRECINCT, favor('undertow', -6), turfStr('undertow', 'rail', -30, 1)),
    ],
  }),
  card({
    id: 'ut.copper',
    kind: 'faction',
    speaker: 'undertow',
    title: "YOU WEREN'T USING IT",
    when: all(m('turf.undertow', '>=', 20), m('abandoned', '>=', 5)),
    spot: 'abandoned',
    weight: 10,
    cooldown: 360,
    body: "Brine's divers are stripping copper from the dead streetlights in {district}. She's left a note taped to one: 'You weren't using it, little light. Were you?'",
    brief: 'Undertow salvagers are pulling copper wire out of the dead streetlights in {district}. Letting them keeps Brine friendly but weakens your power grid a little. Selling the copper earns cash. Relighting costs money.',
    choices: [
      dflt('Let them strip it.', favor('undertow', 10), mod(180, { powerSupplyMul: 0.97 })),
      choice('Swap to fibre, sell the copper.', funds(1200), favor('undertow', -5)),
      choice('Relight every lamp.', funds(-800), favor('tuning', 5), favor('undertow', -5)),
    ],
  }),
  card({
    id: 'ut.slate',
    kind: 'faction',
    speaker: 'undertow',
    title: 'STILL WARM',
    when: m('standing.undertow', '>=', 30),
    star: 10,
    body: "Brine sets a diver's slate on the pump hall floor. 'Found it in the Sunk the year after. Kept it for my girl. She's grown. You should have it.' Scratched letters. Then a child's hand.",
    brief: "Old Brine kept a diver's slate found in the Sunk after the 2084 flood, and wants you to have it. It may hold a piece of your lost memory. Reading it brings you closer to her. She's glad either way.",
    choices: [
      choice('Read the slate.', log(10), favor('undertow', 5)),
      // A declined ★ card returns in 240 d, so this can't be a big favor farm.
      dflt('Let Brine keep it.', favor('undertow', 6), favor('tuning', 2)),
    ],
  }),
  card({
    id: 'ut.highwater',
    kind: 'hostile',
    speaker: 'undertow',
    title: 'HIGH WATER NIGHT',
    when: m('standing.undertow', '<=', -60),
    spot: 'turf:undertow',
    body: "High Water night. The Undertow open the old storm drains under {district}. Streets flood knee-deep, power stutters, and every home hears Brine's name in the drains.",
    brief: 'The Undertow is now Hostile to you and has flooded the storm drains under {district}. Pumping it out costs money. Letting it drain cuts power there and empties some homes. Paying Brine off makes peace.',
    choices: [
      choice('Pump it out: 5,000.', funds(-5000)),
      dflt('Let it drain.', offline('district', 'all', 20, { at: 'spot', r: 6 }), abandon('spot', 6, 8, 'res')),
      choice('Offer salt for peace.', funds(-3000), favor('undertow', 20), trace(3)),
    ],
  }),
];
