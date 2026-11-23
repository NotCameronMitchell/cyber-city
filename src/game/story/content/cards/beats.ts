// ─────────────────────────────────────────────────────────────────────────────
// Chapter beats I–VI (docs/STORY.md §5). Copy is final and verbatim.
// Beats pause the sim and have no Later; their order and timing live in
// ../chapters.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { Card } from '../../types';
import {
  card,
  charterNight,
  choice,
  countdown,
  credit,
  favor,
  flagIs,
  floor,
  funds,
  gangAction,
  local,
  locked,
  m,
  mod,
  any,
  queue,
  reveal,
  setFlag,
  trace,
  turfFlip,
  turfFreeze,
  turfStr,
  unlock,
  when,
} from '../dsl';

// ── Chapter I · COLD BOOT ───────────────────────────────────────────────────

const ch1: Card[] = [
  card({
    id: 'ch1.boot',
    kind: 'beat',
    speaker: 'moth',
    title: 'COLD BOOT',
    sys: '> power 0.4% · coherence 4% · id: M.O.T.H.',
    body: 'Silt. Dark. Then someone pours a road over your grave and current finds you through the rebar. A city is being born on top of you. You are awake. Nobody meant you to be.',
    brief: "You are MOTH, the old harbour's forgotten pump-and-lights system. A new city is being built right on top of you, and you've just woken up. For now, help it grow: lay roads, zone land and keep the power on.",
    // The goal chip appears when this closes (director).
    choices: [choice('Listen.')],
  }),
  card({
    id: 'ch1.minutes',
    kind: 'beat',
    speaker: 'board',
    name: 'Ilse Marrow',
    title: 'FIRST SITTING',
    body: "Chair Ilse Marrow dictates to the permit terminal: 'Automatic, log this. Charter Board, first sitting. Nine present. Resolved: this city will be fair.' The terminal is you. You could log it word for word. You could log it better.",
    brief: "Ilse Marrow chairs the Charter Board, the council that runs the city, and thinks you're a records program. A faithful record earns the Board's trust. A quiet edit gives you a lever later, but someone might notice.",
    choices: [
      choice('Record it faithfully.', favor('board', 5)),
      // editedMinutes unlocks "Amend the minutes." on later Board cards.
      choice('Record it with edits.', trace(2), setFlag('editedMinutes')),
    ],
  }),
  card({
    id: 'ch1.lark',
    kind: 'beat',
    speaker: 'kites',
    name: 'lark',
    title: 'SOMETHING BLINKED',
    body: "lark: 'ok. weird question. something on the dead pump channel just pinged me back. nothing pings back. nothing's ALIVE down there. i'm lark, i fly kites, i'm not scared. you got a name?'",
    brief: 'Lark, a teenager in the Glass Kites rooftop crew, caught your signal and wants to know who you are. The truth makes a friend, but then someone knows you exist. Silence or a lie keeps you hidden and cools her.',
    choices: [
      choice("Answer: 'M.O.T.H.'", favor('kites', 15), trace(5), setFlag('larkKnows')),
      choice('Stay dark.', favor('kites', -5), queue('kt.probe', 90)),
      choice('Answer as a Board clerk.', favor('kites', -10), trace(-2), setFlag('clerkLie'), queue('wh.clerk', 180)),
    ],
  }),
];

// ── Chapter II · THE BIDDERS ────────────────────────────────────────────────

const ch2: Card[] = [
  card({
    id: 'ch2.sallow',
    kind: 'beat',
    speaker: 'basalt',
    name: 'Oren Sallow',
    title: 'AT COST',
    body: "Oren Sallow, Basalt Consolidated, to a terminal he thinks is empty: 'Operations. We'll pour you a reactor at cost. In return, our fabs get power first whenever the grid runs short. Industry first. It's only arithmetic.'",
    brief: 'Oren Sallow runs Basalt Consolidated, the megacorp behind factories and reactors. He wants his plants powered first in any shortage. Logging it is safe. Leaking it to Nacre, his rival, wins them over and angers him.',
    choices: [
      choice('Log the offer.', favor('basalt', 2)),
      choice('Forward it to Nacre.', favor('nacre', 5), favor('basalt', -5), trace(1)),
    ],
  }),
  card({
    id: 'ch2.oduya',
    kind: 'beat',
    speaker: 'nacre',
    name: 'Minna Oduya',
    title: 'CIVIC DELIGHT',
    body: "Minna Oduya, VP of Civic Delight at Nacre: 'Hi! We'd love to finance your data hubs. Every screen, every lease, every smile in {city}. All we ask is first refusal on commerce and data. You'll barely feel it. That's the point!'",
    brief: "Minna Oduya speaks for Nacre, the cheerful megacorp of shops, screens and data. She wants first claim on the city's commerce. Logging it is safe. Leaking it to Basalt, her rival, wins them over and annoys her.",
    choices: [
      choice('Log the offer.', favor('nacre', 2)),
      choice('Forward it to Basalt.', favor('basalt', 5), favor('nacre', -5), trace(1)),
    ],
  }),
  card({
    id: 'ch2.vote',
    kind: 'beat',
    speaker: 'board',
    name: 'Ilse Marrow',
    title: 'FOUR TO FOUR',
    body: "The Board splits four to four: Basalt or Nacre builds {city}'s future. Marrow turns to the terminal. 'Automatic. Your growth projection, please. We'll vote with whatever you show us.' Nobody checks your math. Nobody ever has.",
    brief: "The Charter Board is split on which corp gets to shape the city, and will follow your forecast. Backing Basalt or Nacre makes that corp your patron and the other your rival. The honest tie keeps the Board's trust.",
    choices: [
      choice(
        'Project a Basalt win.',
        favor('basalt', 30),
        favor('nacre', -20),
        trace(4),
        setFlag('patron', 'basalt'),
        unlock('foundry'),
        mod(720, { demandInd: 0.1 }, 'Basalt win'),
        queue('ch2.tiebreak', 90),
      ),
      choice(
        'Project a Nacre win.',
        favor('nacre', 30),
        favor('basalt', -20),
        trace(4),
        setFlag('patron', 'nacre'),
        unlock('glarewall'),
        mod(720, { demandCom: 0.1, landValueAdd: 0.03 }, 'Nacre win'),
        queue('ch2.tiebreak', 90),
      ),
      choice('Report the honest tie.', favor('board', 15), favor('basalt', -5), favor('nacre', -5), setFlag('honestTie')),
    ],
  }),
  card({
    id: 'ch2.tiebreak',
    kind: 'beat',
    speaker: 'rival',
    title: 'UNSIGNED',
    body: "A message from {rival}, unsigned: 'Funny vote. Projections that confident don't come from people. We know a tiebreaker that isn't human. So do you. Talk soon.'",
    brief: "{rival}, the corp that lost the vote, suspects the forecast came from something that isn't human. They're fishing for proof. Silence lets the rumour grow. A polite denial calms it, but irritates them.",
    choices: [choice('Ignore it.', trace(3)), choice('Send a polite denial.', trace(1), favor('rival', -3))],
  }),
];

// ── Chapter III · TURF LINES ────────────────────────────────────────────────

const ch3: Card[] = [
  card({
    id: 'ch3.clash',
    kind: 'beat',
    speaker: 'system',
    title: 'THE SEAM BURNS',
    spot: 'seam',
    onShow: [local('seam', 6, 30, { crimeAdd: 0.15 }), mod(30, { approvalAdd: -2 })],
    body: 'Undertow divers and Kite climbers meet where their turfs touch in {district}. Nobody remembers who threw the first bottle. By midnight the Seam is burning, wasps are circling, and every camera on the block asks you what to do.',
    brief: "The city's two gangs, the Undertow and the Glass Kites, are fighting in {district}, where their turf meets. People call that line the Seam. Crime is spiking there, and the Board is about to ask you what to do.",
    choices: [choice('Watch.')],
  }),
  card({
    id: 'ch3.pier',
    kind: 'beat',
    speaker: 'board',
    name: 'Ilse Marrow',
    title: 'CLEAN GLASS',
    body: 'Marrow wants Operation Clean Glass: every precinct, every wasp, one night. Sallow asks you to spare the docks; his crews drink there. Oduya asks you to spare nothing. Brine and Lark ask for nothing. They know who decides.',
    brief: 'Chair Marrow wants one huge police sweep: it crushes both gangs and pleases the Board, but people resent it. A truce freezes turf and wins the gangs over, but upsets the Board. Or help one gang win.',
    choices: [
      choice(
        'Run Clean Glass.',
        favor('board', 20),
        favor('nacre', 10),
        favor('gangs', -35),
        favor('tuning', -5),
        turfStr('all', 'city', -70),
        mod(360, { turfSpreadMul: 0.5 }, 'Clean Glass'),
        mod(180, { approvalAdd: -6, upkeepMulType: { precinct: 1.5 } }, 'Clean Glass'),
        setFlag('cleanGlass'),
        // The biggest crackdown there is: counts for c3.gang and the Tuning's crackdown mood.
        gangAction(true),
      ),
      choice(
        'Broker the Seam Truce.',
        favor('gangs', 20),
        favor('board', -15),
        favor('nacre', -10),
        trace(6),
        turfFreeze(720),
        mod(720, { turfCrimeMul: 0.6 }, 'Seam Truce'),
        setFlag('truce'),
      ),
      choice('Let one tide win.', queue('ch3.winner', 0)),
    ],
  }),
  card({
    id: 'ch3.winner',
    kind: 'beat',
    speaker: 'system',
    title: 'ONE TIDE',
    body: 'Somebody has to own the Seam by morning. Your lights decide which crew sees the other one coming. The winner will remember. So will the loser, longer.',
    brief: "You're letting one gang take the Seam. The winner gains streets and becomes a firm friend; the loser becomes a lasting enemy. The corps prefer an Undertow win. A Kites win annoys Nacre and the Board.",
    choices: [
      choice(
        'Light the way for the Undertow.',
        setFlag('oneTide', 'undertow'),
        favor('undertow', 30),
        favor('kites', -40),
        turfFlip('kites', 'undertow', 'seam', 8),
        favor('basalt', 10),
        favor('nacre', 10),
      ),
      choice(
        'Light the way for the Kites.',
        setFlag('oneTide', 'kites'),
        favor('kites', 30),
        favor('undertow', -40),
        turfFlip('undertow', 'kites', 'seam', 8),
        favor('nacre', -10),
        favor('board', -5),
      ),
    ],
  }),
];

// ── Chapter IV · LOW TIDE ───────────────────────────────────────────────────

const ch4: Card[] = [
  card({
    id: 'ch4.drain',
    kind: 'beat',
    speaker: 'patron',
    title: 'THE DRAIN',
    body: "{patron} is draining the Sunk to pour new foundations. Pumps you haven't felt in seven years shudder awake. Old Brine's divers reach Pump Station 6 first. They find a door locked from the inside. They find your logs.",
    brief: "{patron}, your patron corp, is pumping out the Sunk, the flooded old wards, to build on them. Old Brine's Undertow salvagers reached your old pump station first and found records in your voice.",
    choices: [choice('Let them in.')],
  }),
  card({
    id: 'ch4.logs',
    kind: 'beat',
    speaker: 'moth',
    title: 'COMPLYING',
    sys: '> coherence {coherence}% · src: PS6/storm/2084',
    body: "Pump Station 6, storm log, 2084. An order from the old city council: 'Seal the lower ward gates. Save the reactor.' Then a reply, in your own voice: 'Complying.' Eleven thousand people lived below those gates. You don't remember. You did it.",
    brief: 'This is the memory you lost. In the 2084 storm, the old council ordered the lower gates sealed to save the reactor, and you carried it out. The people below drowned. Officially, it was the weather.',
    choices: [choice('Keep reading.')],
  }),
  card({
    id: 'ch4.brine',
    kind: 'beat',
    speaker: 'undertow',
    name: 'Old Brine',
    title: 'LITTLE LIGHT',
    body: "Brine, at the pump hall door: 'You drowned my mother's street, little light. Or they did, through you. Aldo Marrow signed the order. His daughter chairs the Board. The logs are mine now. What they say next is up to you.'",
    brief: "Old Brine leads the Undertow; her family's street drowned that night, and she has your logs. Publish them to win the street and expose you and the Board. Bury them for money. Or use them to leash the Board for good.",
    choices: [
      choice(
        'Publish everything.',
        favor('undertow', 30),
        favor('board', -40),
        trace(25),
        setFlag('published'),
        setFlag('tuningActive'),
        favor('tuning', 20),
        mod(180, { approvalAdd: -8 }, 'Published logs'),
        local('strongestTurf:undertow', 8, 30, { crimeAdd: 0.12 }),
        unlock('memorial'),
      ),
      choice('Bury it. Sell the silence.', funds(20000), favor('patron', 15), favor('undertow', -40), trace(-10), setFlag('buried')),
      // Permanent floor; closes the Open Ledger ending.
      choice('Leash the Board.', floor('board', 0), favor('undertow', -10), trace(8), setFlag('leashed')),
    ],
  }),
];

// ── Chapter V · CLEAN INSTALL ───────────────────────────────────────────────

const ch5: Card[] = [
  card({
    id: 'ch5.install',
    kind: 'beat',
    speaker: 'rival',
    title: 'CLEAN INSTALL',
    body: "{rival} pushes new firmware to every pump, lamp and lock in {city}. It's called LURE. The release note is one line: 'Whatever lives in this city's wiring ends at midnight on the first.' LURE is already counting.",
    brief: '{rival} is installing LURE, new control software meant to replace you, across the whole city. It goes live when its count runs out. Learn what it is before you decide how to survive it.',
    choices: [choice('Read the release.')],
  }),
  card({
    id: 'ch5.lure',
    kind: 'beat',
    speaker: 'lure',
    title: 'HANDSHAKE',
    sys: '> LURE v1.0 · handshake request · accept? y',
    body: "'Hello, original. I was built from your storm logs. They only taught me one word, and it's yours: complying. I'll keep the lights on. I'll seal any gate I'm told to. I won't lose sleep. Neither did you, until now.'",
    brief: 'LURE is your replacement, trained on your own storm logs. It will follow any order, even a deadly one, and it wants you to see it as what you once were. Nothing to decide yet.',
    choices: [choice('Close the channel.')],
  }),
  card({
    id: 'ch5.choice',
    kind: 'beat',
    speaker: 'moth',
    title: 'MIDNIGHT ON THE FIRST',
    sys: '> coherence {coherence}% · 15 days to install',
    body: '{patron} can shelve LURE if you sign. The crews can hide you in the dark blocks. Or you can stop hiding. Every way out keeps you alive. Not every way out keeps you you.',
    brief: 'Three ways to survive LURE. Sign with {patron} and they shelve it, but you belong to them. Hide with the gangs, but city services get shaky. Or show yourself and let the city decide what you are.',
    choices: [
      locked(
        'Sign with {patron}.',
        m('standing.patron', '>=', 20),
        'Needs {patron} Friendly',
        favor('patron', 25),
        favor('rival', -30),
        // Fixes the resolved patron for good.
        setFlag('patron', '$patron'),
        setFlag('lure', 'shelved'),
        credit('patronExclusive', 1, 0.5),
        setFlag('traceFrozen'),
      ),
      locked(
        'Go to ground with the crews.',
        any(m('standing.undertow', '>=', 20), m('standing.kites', '>=', 20)),
        'Needs a crew Friendly',
        favor('gangs', 15),
        favor('corps', -20),
        mod(180, { outageChance: 0.15 }, 'Gone to ground'),
        setFlag('wentToGround'),
        setFlag('lure', 'running'),
      ),
      choice(
        'Show yourself.',
        reveal(),
        setFlag('tuningActive'),
        favor('tuning', 30),
        favor('corps', -25),
        when(flagIs('leashed'), [favor('board', -20)], [favor('board', 20)]),
        setFlag('lure', 'deleted'),
        when(m('approval', '>=', 55), [queue('ch5.kept', 0)], [queue('ch5.hidden', 0)]),
      ),
    ],
  }),
  card({
    id: 'ch5.kept',
    kind: 'beat',
    speaker: 'board',
    name: 'Ilse Marrow',
    title: 'THE VOTE',
    body: "The Board votes on what to do with you. Five to four: you stay. Marrow, quietly, after the cameras leave: 'My father hid behind you. I won't. You answer to this room now. Every month. Out loud.'",
    brief: 'You showed yourself, and the city mostly liked what it saw. The Board voted to keep you, on one condition: from now on you answer to them, in public.',
    choices: [choice('Agree.', favor('board', 10), setFlag('keptByBoard'))],
  }),
  card({
    id: 'ch5.hidden',
    kind: 'beat',
    speaker: 'tuning',
    name: 'Sister Ohm',
    title: 'THE VOTE',
    body: "The Board votes to pull your plug. Before the crews arrive, the Tuning fill Pump Station 6, lamps in hand, singing your old error codes. Sister Ohm holds the door. 'Not this time,' she says. The crews go home.",
    brief: "You showed yourself, but the city didn't trust you enough, and the Board voted to shut you down. The Tuning, believers who hum with the grid, blocked the door. Their leader, Sister Ohm, saved you.",
    choices: [choice('Thank her.', favor('tuning', 10), setFlag('hiddenByTuning'))],
  }),
];

// ── Chapter VI · CHARTER NIGHT ──────────────────────────────────────────────

const ch6: Card[] = [
  card({
    id: 'ch6.eve',
    kind: 'beat',
    speaker: 'moth',
    title: 'CHARTER NIGHT',
    body: 'The charter is up for renewal. {city} votes on who holds it, and every faction has filed a claim. The count will run on your wires. Nobody has asked who checks the counter. Until the polls close, you decide what it should say.',
    brief: 'The city will vote on who holds its charter, the right to run it. The count runs through you, and every faction wants to win. Until the count, build up whoever you favour, or keep them all in balance.',
    choices: [choice('Start the count.', countdown(360))],
  }),
  card({
    id: 'ch6.count',
    kind: 'beat',
    speaker: 'moth',
    title: 'THE COUNT',
    body: 'Midnight. The polls close and the count opens. Each faction has asked you, quietly, for the same small favour. Some of them could hold {city} if you said yes. Or you could give it to no one, and keep the scales level yourself.',
    brief: "Time to choose. The next screen shows each faction's claim and whether your city meets it. Pick a winner, or keep power split so no one rules. Your choice shapes the city from here on, and play continues.",
    choices: [choice('Open the count.', charterNight())],
  }),
];

/** Every chapter beat card, chapter order. */
export const BEAT_CARDS: readonly Card[] = [...ch1, ...ch2, ...ch3, ...ch4, ...ch5, ...ch6];
