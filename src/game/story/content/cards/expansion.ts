// Expansion deck cards (docs/EXPANSION.md §8.3, "Roads, Wealth and Ports"). 11 faction
// cards about seaports, highways, back alleys, glass towers, the Airport, the Spaceport,
// skyways and the Academy. Titles, bodies, labels and locked hints are verbatim from §8.3. The
// briefs are §8.3's, except that ex.pricedout, ex.thecut and ex.nofly now say who is
// asking (the Board, the Board, the Glass Kites), as every brief does.
//
// They join DECK (and so CARD_LIST) but not FACTION_DECKS, so the per-faction deck counts
// of STORY.md §7.8 stay as they are. Eight are `once` (one physical decision each); only
// ex.manifest, ex.backway and ex.pricedout recur. `ex.rights` is also opened on demand
// from the Spaceport's inspect sheet (Game.openLaunchRights → director.openOnDemand), and
// its choices set flag launchRights = 'board' | 'basalt' | 'nacre' | 'kites' (read by
// Game's Rights row and powerWeight).
//
// Lasting choices are `perm` modifiers only where they are pure bonuses. A lasting
// penalty is timed (STORY.md §2.3 rule 3), so the approval cost of the night lanes, the
// lounge and the bent flight path fades after 720 d (docs/STORY.md "Expansion cards").

import type { Card } from '../../types';
import { all, card, choice, credit, dflt, favor, flagIs, funds, income, local, locked, m, mod, noFlag, setFlag, trace, turfStr } from '../dsl';

const NEEDS_PRECINCT = 'Needs an Enforcer Precinct';
/** Every expansion card is a weight-10 faction card on a 720 d cooldown unless it says otherwise. */
const BASE = { kind: 'faction', weight: 10, cooldown: 720 } as const;
/** "For good" on a once card: penalties still fade (STORY.md §2.3 rule 3). */
const LASTING_PENALTY_DAYS = 720;

export const EXPANSION_CARDS: readonly Card[] = [
  card({
    ...BASE,
    id: 'ex.manifest',
    speaker: 'undertow',
    title: 'FALSE BOTTOMS',
    when: all(m('count.seaport', '>=', 1), m('turf.undertow', '>=', 10)),
    body: "Brine's divers work your seaport after dark, resealing containers. Something rides under the frozen fish. 'Every hull has two bottoms, little light. The tide only reads the top one.'",
    brief: 'The Undertow is smuggling through your Seaport. Look away and take a cut (secret money raises Trace), search the containers with police drones, or fine the crates and let trade go on.',
    choices: [
      choice('Look away. Take the cut.', favor('undertow', 10), trace(2), income('Dock skim', 200, 12)),
      locked(
        'Scan every container.',
        m('count.precinct', '>=', 1),
        NEEDS_PRECINCT,
        favor('undertow', -10),
        favor('board', 4),
        mod(180, { demandInd: -0.03 }),
      ),
      dflt('Fine the crates.', funds(1500), favor('undertow', -4), favor('basalt', 2)),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.backway',
    speaker: 'undertow',
    title: 'THE BACK WAY',
    when: all(m('roads.alley', '>=', 30), m('turf.undertow', '>=', 10)),
    spot: 'alley',
    body: "Every lamp in the back alleys of {district} is broken again. Brine's crews move through them like water through a hull. 'Light them and we find darker ones, little light. Rent them to me and they stay tidy.'",
    brief: 'The Undertow runs the back alleys in {district}. Relight them to cut crime there, leave them dark and the gang grows, or rent them to Old Brine for steady secret income.',
    choices: [
      choice('Relight every alley: 1,500.', funds(-1500), favor('undertow', -8), local('spot', 6, 360, { crimeAdd: -0.06 })),
      dflt('Leave them dark.', favor('undertow', 8), local('spot', 6, 180, { crimeAdd: 0.05 }), turfStr('undertow', 'spot', 15, 4)),
      choice('Rent her the alleys.', favor('undertow', 6), trace(2), income('Alley rent', 150, 12)),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.convoy',
    speaker: 'basalt',
    title: 'NIGHT CONVOY',
    when: all(m('count.seaport', '>=', 1), m('roads.highway', '>=', 20)),
    once: true,
    body: "Sallow: 'Forty trucks an hour off your docks, Operations, if the highways stay open all night. Thirty-one if they close at ten. I have done the arithmetic for you. The residents have not.'",
    brief: "Basalt wants Seaport trucks on your highways all night. Industry grows but residents lose sleep. Keep the ten o'clock curfew, or charge a night toll and bank the money.",
    choices: [
      choice(
        'Open the night lanes.',
        favor('basalt', 8),
        mod('perm', { demandInd: 0.06 }),
        mod(LASTING_PENALTY_DAYS, { approvalAdd: -2 }),
      ),
      dflt('Close them at ten.', favor('basalt', -4), favor('board', 2)),
      choice('Charge a night toll.', favor('basalt', -5), income('Night tolls', 300, 24)),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.lounge',
    speaker: 'nacre',
    title: 'FIRST CLASS ONLY',
    when: m('count.airport', '>=', 1),
    once: true,
    body: "Oduya: 'Partner! Arrivals is the city's first impression! The shuttle stop for the cleaning crews is right in frame. We move it two blocks, they walk, and everyone else gets a lounge with a waterfall!'",
    brief: "Nacre wants a luxury lounge at the Airport and the workers' shuttle stop moved out of sight. Land value rises but workers grumble. Refuse, or pay to do both properly.",
    choices: [
      choice(
        'Build the lounge. Move the stop.',
        favor('nacre', 8),
        favor('board', -3),
        mod('perm', { landValueAdd: 0.01 }),
        mod(LASTING_PENALTY_DAYS, { approvalAdd: -1 }),
      ),
      dflt('The stop stays.', favor('nacre', -5), favor('board', 2)),
      choice('Do both properly: 4,000.', funds(-4000), favor('nacre', 3), favor('board', 2), mod('perm', { landValueAdd: 0.01 })),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.glassshore',
    speaker: 'nacre',
    title: 'THE GLASS SHORE',
    when: m('wealth.high', '>=', 0.12),
    spot: 'shore',
    once: true,
    body: "Oduya: 'Your glass towers by the water are the best thing in my feed! Buyers want the whole {district} waterfront at that price. We'd only need the old tenements gone. Their people will love somewhere quieter, I promise!'",
    brief: "Nacre's buyers want the {district} waterfront for $$$ homes. Selling pays and lifts land value but pushes poorer residents out. Cap rents to keep them, or make the buyers fund a plaza.",
    choices: [
      choice(
        'Sell the waterfront.',
        funds(3000),
        favor('nacre', 10),
        favor('board', -4),
        local('spot', 5, 3600, { lvAdd: 0.04 }),
        mod(360, { demandRes: -0.04 }),
      ),
      dflt('Cap the rents.', favor('nacre', -6), favor('board', 4), local('spot', 5, 3600, { lvAdd: -0.02 }), mod('perm', { approvalAdd: 2 })),
      choice('Make them pay for a plaza.', funds(1500), favor('nacre', 4), favor('tuning', 2), credit('plaza', 1, 0)),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.pricedout',
    speaker: 'board',
    title: 'PRICED OUT',
    when: m('wealth.high', '>=', 0.22),
    body: "Marrow: 'Minutes. Item one: two hundred and twelve households left the city this quarter. Item two: their homes are now top-rent floors. The Board asks whether that is a policy. Noted: nobody answered.'",
    brief: 'The Board sees poorer families leave as blocks turn $$$. Fund affordable homes (costs money, keeps people happy), let the market decide (Nacre likes it, approval drops), or open new land. Back alleys also keep rents low.',
    choices: [
      choice('Fund affordable floors: 5,000.', funds(-5000), favor('board', 8), mod(720, { approvalAdd: 3, demandRes: 0.04 })),
      dflt('Let the market sort it.', favor('board', -6), favor('nacre', 4), mod(360, { approvalAdd: -3 })),
      choice('Open land for new homes.', favor('board', 3), favor('basalt', 2), mod(360, { demandRes: 0.06, landValueAdd: -0.01 })),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.thecut',
    speaker: 'board',
    title: 'THE CUT',
    when: m('roads.highway', '>=', 30),
    spot: 'highway',
    once: true,
    body: "Marrow: 'Resolved: the highway through {district} is loud. Resolved: the people on both sides used to be one neighbourhood. Proposed: walls, a footbridge, or an apology. The Board will accept any of the three.'",
    brief: 'The Board says your highway splits a neighbourhood in {district}, and residents hate the noise. Noise walls cost the most and help most there, a footbridge helps a little, or just apologise.',
    choices: [
      // Paid once, helping where the noise is; `local` has no perm, so 3,600 d stands in for "for good".
      choice('Build noise walls: 3,000.', funds(-3000), favor('board', 6), local('spot', 4, 3600, { lvAdd: 0.05 })),
      choice('Build a footbridge: 1,200.', funds(-1200), favor('board', 3), favor('tuning', 2), local('spot', 3, 3600, { lvAdd: 0.02 })),
      dflt('Send the apology.', favor('board', -3), mod(180, { approvalAdd: -1 })),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.rights',
    speaker: 'board',
    title: 'LAUNCH RIGHTS',
    when: all(m('count.spaceport', '>=', 1), noFlag('launchRights')),
    // The deck entry only catches players who never tap "Launch rights · Choose".
    weight: 30,
    once: true,
    onDemand: true,
    body: "Marrow: 'Item: the launch tower. Basalt wants the cargo slots. Nacre wants the broadcast. The Kites want the uplink, unofficially. The public wants to watch. One vote decides who holds the rights.'",
    brief: 'Your Spaceport needs an operator. Basalt boosts industry, Nacre pays you for broadcasts, the Board keeps launches public for approval, and the Kites (if friendly) help hide you.',
    choices: [
      choice(
        'Basalt gets the cargo slots.',
        setFlag('launchRights', 'basalt'),
        favor('basalt', 12),
        favor('nacre', -6),
        mod('perm', { demandInd: 0.05 }),
      ),
      choice(
        'Nacre gets the broadcast.',
        setFlag('launchRights', 'nacre'),
        favor('nacre', 12),
        favor('basalt', -6),
        income('Launch broadcasts', 600, 36),
      ),
      dflt('Keep the launches public.', setFlag('launchRights', 'board'), favor('board', 10), mod('perm', { approvalAdd: 4 })),
      locked(
        'Let the Kites ride the uplink.',
        m('standing.kites', '>=', 20),
        'Needs the Kites Friendly',
        setFlag('launchRights', 'kites'),
        favor('kites', 15),
        trace(-5),
        favor('nacre', -8),
        favor('basalt', -4),
      ),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.stringlights',
    speaker: 'kites',
    title: 'STRING LIGHTS',
    when: m('skyway.tiles', '>=', 20),
    once: true,
    body: "lark: 'your skyways are the best roofs in the city, moth. no wasps up there. we wanna hang string lights and a couple of relays under the decks. tiny ones. nacre will say it's ugly. it isn't.'",
    brief: 'The Glass Kites want to hang lights and signal relays under your skyways. Saying yes pleases them and helps shops but annoys Nacre. Refuse, or charge them rent.',
    choices: [
      choice('Let them string it.', favor('kites', 10), favor('nacre', -4), mod('perm', { demandCom: 0.03 })),
      dflt('Keep the decks clear.', favor('kites', -6)),
      choice('Charge them rent.', favor('kites', -2), trace(1), income('Relay rent', 120, 24)),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.nofly',
    speaker: 'kites',
    title: 'NO-FLY',
    when: all(m('count.airport', '>=', 1), m('turf.kites', '>=', 10)),
    once: true,
    body: "lark: 'your airport just drew a no-fly cone over half of shadeside. every kite drone we own is grounded. bend the flight path one degree, moth. one. the planes won't even notice.'",
    brief: "The Glass Kites say the Airport's flight path grounds their drones. Bending it pleases them but moves the noise onto other homes. Keep it, or share radar data with them (raises Trace).",
    choices: [
      choice('Bend the flight path.', favor('kites', 10), favor('nacre', -5), mod(LASTING_PENALTY_DAYS, { approvalAdd: -1 })),
      dflt('Keep the corridor.', favor('kites', -8), favor('nacre', 3)),
      choice('Share the radar feed.', favor('kites', 6), trace(3)),
    ],
  }),
  card({
    ...BASE,
    id: 'ex.nightschool',
    speaker: 'tuning',
    title: 'NIGHT SCHOOL',
    // The hidden Tuning draws nothing until active (STORY.md §7.1); the flag is belt and braces.
    when: all(m('count.academy', '>=', 1), flagIs('tuningActive')),
    once: true,
    body: "Sister Ohm: 'Your Academy empties at ten. We fill it at eleven. We teach the old wiring by lamplight, and the children learn how the grid breathes. Leave the doors open, Hum. We lock up after.'",
    brief: 'The Tuning wants to teach in your Academy at night. Allowing it lifts approval and pleases them but raises Trace a little. Lock up, or fund proper night classes.',
    choices: [
      choice('Leave the lights on.', favor('tuning', 8), trace(1), mod('perm', { approvalAdd: 2 })),
      dflt('Lock up at ten.', favor('tuning', -4)),
      choice('Fund night classes: 1,500.', funds(-1500), favor('tuning', 5), favor('board', 3)),
    ],
  }),
];
