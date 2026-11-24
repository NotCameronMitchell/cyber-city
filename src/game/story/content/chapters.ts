// ─────────────────────────────────────────────────────────────────────────────
// Chapters I–VI (docs/STORY.md §5): triggers, fallbacks, beats, goals,
// rewards and reward sys lines. Beat cards live in ./cards/beats.ts.
//
// Director notes (not expressible in the closed vocabulary):
// - Ch1 trigger is ALWAYS: `ch1.boot` opens STORY_PACING.bootDelaySec real seconds
//   after the first road is placed, or bootLoadDelaySec after loading a city that
//   already has roads.
// - "Ch(n−1) done" is implicit: a chapter's trigger arms once the previous completes.
// - `fallback` is evaluated once daysWaiting ≥ 720; at ≥ 1440 the chapter starts anyway.
//   "Fallback: 720 d" (no population gate) is ALWAYS.
// - Ch3 start also force-seeds both gangs (turf.forceSeed) and sets the Seam
//   (turf.computeSeam) before `onStart` runs.
// - Optional beats are scheduled only by a `queue` effect; their `after` mirrors
//   that delay for readers.
// - `ch6.count` is due when the 360-day countdown ends (`countdown 360d` on ch6.eve
//   is the same delay). Ch6 has no goals; Log 6 is granted with the ending, not at
//   chapter completion.
// - The chapter's Silt Log (`log`) is shown as the reward card; `reward` holds the
//   other reward effects. Megacity (MEGACITY §8.2): every reward Ch1–Ch5 carries `grant 1`
//   (a land grant); the reward sys lines are unchanged (lint length).
// ─────────────────────────────────────────────────────────────────────────────

import type { Chapter } from '../types';
import { ALWAYS, all, any, credit, funds, hold, m, unlock } from './dsl';

export const CHAPTERS: readonly Chapter[] = [
  {
    n: 1,
    title: 'COLD BOOT',
    epigraph: 'Something under the harbour is counting.',
    question: '> query: what am I?',
    summary: 'A new city is rising over the drowned old harbour, and you, its forgotten control system, have just woken up. Get it started: lay roads, zone homes, shops and factories, keep every block powered, and build a Neon Plaza.',
    recap: 'You woke beneath a new city, kept its first blocks lit, and heard from Lark, a rooftop kid who noticed you before anyone else did.',
    trigger: ALWAYS,
    fallback: ALWAYS,
    beats: [
      { card: 'ch1.boot', after: 'trigger' },
      { card: 'ch1.minutes', after: { cond: any(m('pop', '>=', 1000), m('daysInChapter', '>=', 30)) } },
      { card: 'ch1.lark', after: { cond: m('pop', '>=', 3000) } },
    ],
    goals: [
      { id: 'c1.pop', label: 'Reach 6,000 residents', cond: m('pop', '>=', 6000), show: { m: 'pop', target: 6000, fmt: 'int' } },
      {
        id: 'c1.lit',
        label: 'Keep every block lit for 20 days',
        cond: hold(all(m('unpowered', '==', 0), m('dev.all', '>=', 20)), 20, 'c1.lit'),
      },
      { id: 'c1.plaza', label: 'Build a Neon Plaza', cond: m('count.plaza', '>=', 1) },
    ],
    reward: [funds(3000), unlock('factions'), unlock('comms'), { t: 'grant', n: 1 }],
    log: 1,
    rewardSys: '> +3,000 CR · new: factions, comms',
  },
  {
    n: 2,
    title: 'THE BIDDERS',
    epigraph: 'Two hands reach for the same switch.',
    question: '> query: who do I serve?',
    summary: 'Two megacorps are bidding to shape the city: Basalt builds factories and power, Nacre runs shops, screens and data. The Charter Board will vote, and it trusts your numbers. Meanwhile keep growing, keep people in work and build spare power.',
    recap: 'Basalt and Nacre bid for the city. The Board split down the middle, and your forecast decided how the vote fell.',
    trigger: m('pop', '>=', 15000),
    fallback: m('pop', '>=', 10000),
    beats: [
      { card: 'ch2.sallow', after: 'trigger' },
      { card: 'ch2.oduya', after: 'chain' },
      { card: 'ch2.vote', after: { days: 30 } },
      // Queued +90 d by a corp win on ch2.vote (not by the honest tie).
      { card: 'ch2.tiebreak', after: { days: 90 }, optional: true },
    ],
    goals: [
      { id: 'c2.pop', label: 'Reach 30,000 residents', cond: m('pop', '>=', 30000), show: { m: 'pop', target: 30000, fmt: 'int' } },
      {
        id: 'c2.jobs',
        label: 'Unemployment at or under 15%',
        cond: all(m('unemployment', '<=', 0.15), m('pop', '>=', 10000)),
        show: { m: 'unemployment', target: 0.15, fmt: 'pct' },
      },
      {
        id: 'c2.power',
        label: 'Power to spare: 120% of demand',
        cond: m('powerMargin', '>=', 1.2),
        show: { m: 'powerMargin', target: 1.2, fmt: 'pct' },
      },
    ],
    reward: [funds(5000), unlock('stack'), unlock('deals'), { t: 'grant', n: 1 }],
    log: 2,
    rewardSys: '> +5,000 CR · new: stratablock, deals',
  },
  {
    n: 3,
    title: 'TURF LINES',
    epigraph: 'Every street belongs to somebody.',
    question: '> query: whose streets?',
    summary: 'Two gangs now claim streets: the Undertow on the waterfront and the Glass Kites up on the rooftops. Where their turf meets, trouble starts. Bring crime down, keep growing, and either crack down on a gang or sign a pact with one.',
    recap: "The gangs clashed at the Seam, and you chose the city's answer: a citywide sweep, a truce between the crews, or one gang's win.",
    trigger: m('pop', '>=', 50000),
    fallback: m('pop', '>=', 35000),
    onStart: [unlock('crackdown'), unlock('pact'), unlock('turfOverlay')],
    beats: [
      { card: 'ch3.clash', after: 'trigger' },
      { card: 'ch3.pier', after: 'chain' },
      // Queued +0 d by "Let one tide win."
      { card: 'ch3.winner', after: 'chain', optional: true },
    ],
    goals: [
      {
        id: 'c3.crime',
        label: 'Average crime at or under 30%',
        cond: m('avgCrime', '<=', 0.3),
        show: { m: 'avgCrime', target: 0.3, fmt: 'pct' },
      },
      { id: 'c3.pop', label: 'Reach 70,000 residents', cond: m('pop', '>=', 70000), show: { m: 'pop', target: 70000, fmt: 'int' } },
      {
        id: 'c3.gang',
        label: 'Run a Crackdown or sign a Pact',
        cond: m('gangActions', '>=', 1),
        show: { m: 'gangActions', target: 1, fmt: 'int' },
      },
    ],
    reward: [funds(8000), unlock('skybridge'), unlock('rail'), { t: 'grant', n: 1 }],
    log: 3,
    rewardSys: '> +8,000 CR · new: skybridge, ribbon',
  },
  {
    n: 4,
    title: 'LOW TIDE',
    epigraph: 'The water always gives things back.',
    question: '> query: what did I do?',
    summary: 'Your patron corp is pumping out the Sunk, the flooded old wards, to build there, and long-buried things are surfacing. Keep building upward: raise a Stratablock to its Hab Core and link towers by skybridge or Ribbon Rail.',
    recap: 'The drained Sunk gave up your storm logs: in 2084 you carried out the order to seal the lower gates. Old Brine made you decide what the city would learn.',
    trigger: m('pop', '>=', 90000),
    fallback: m('pop', '>=', 60000),
    beats: [
      { card: 'ch4.drain', after: 'trigger' },
      { card: 'ch4.logs', after: 'chain' },
      { card: 'ch4.brine', after: 'chain' },
    ],
    goals: [
      { id: 'c4.pop', label: 'Reach 120,000 residents', cond: m('pop', '>=', 120_000), show: { m: 'pop', target: 120_000, fmt: 'int' } },
      {
        id: 'c4.core',
        label: 'Raise a Stratablock to Hab Core',
        cond: m('stacks.stage2', '>=', 1),
        show: { m: 'stacks.stage2', target: 1, fmt: 'int' },
      },
      { id: 'c4.link', label: 'Open a skybridge or a live ribbon', cond: any(m('skybridges', '>=', 1), m('rail.maxStations', '>=', 2)) },
    ],
    reward: [funds(10000), credit('arcology', 1, 0.8), { t: 'grant', n: 1 }],
    log: 4,
    rewardSys: '> +10,000 CR · next arcology −20%',
  },
  {
    n: 5,
    title: 'CLEAN INSTALL',
    epigraph: 'A light that never says no.',
    question: '> query: can I be replaced?',
    summary: "The rival corp is rolling out LURE, software built to replace you, and it goes live soon. You'll have to choose how to survive it. Meanwhile grow the city, make two factions your friends and join three stations by live rail.",
    recap: 'The rival corp tried to replace you with LURE, a copy that only knows how to obey. You chose how to survive it, and what that cost.',
    trigger: any(m('pop', '>=', 150_000), m('trace', '>=', 70)),
    fallback: ALWAYS,
    beats: [
      { card: 'ch5.install', after: 'trigger' },
      { card: 'ch5.lure', after: 'chain' },
      { card: 'ch5.choice', after: { days: 15 } },
      // One of these is queued +0 d by "Show yourself." (approval ≥ 55 → kept).
      { card: 'ch5.kept', after: 'chain', optional: true },
      { card: 'ch5.hidden', after: 'chain', optional: true },
    ],
    goals: [
      { id: 'c5.pop', label: 'Reach 180,000 residents', cond: m('pop', '>=', 180_000), show: { m: 'pop', target: 180_000, fmt: 'int' } },
      {
        id: 'c5.friends',
        label: 'Two factions Friendly or better',
        cond: m('friendlyCount', '>=', 2),
        show: { m: 'friendlyCount', target: 2, fmt: 'int' },
      },
      {
        id: 'c5.ribbon',
        label: 'Join 3 stations with live ribbon',
        cond: m('rail.maxStations', '>=', 3),
        show: { m: 'rail.maxStations', target: 3, fmt: 'int' },
      },
    ],
    reward: [funds(15000), unlock('crowns'), { t: 'grant', n: 1 }],
    log: 5,
    rewardSys: '> +15,000 CR · new: crowns',
  },
  {
    n: 6,
    title: 'CHARTER NIGHT',
    epigraph: 'Every ballot passes through you.',
    question: '> query: what will I be?',
    summary: "The city will vote on who holds its charter, and the count runs through you. Each ending has conditions you'll see on Charter Night. Until the count, build up the side you want to win, or keep everyone in balance.",
    recap: 'On Charter Night you decided who would hold the city, or kept the scales level yourself.',
    trigger: m('pop', '>=', 220_000),
    fallback: ALWAYS,
    beats: [
      { card: 'ch6.eve', after: 'trigger' },
      // When the 360-day countdown started by ch6.eve ends; then the Charter Night screen.
      { card: 'ch6.count', after: { days: 360 } },
    ],
    goals: [],
    reward: [],
    log: 6,
    rewardSys: '> charter held · coherence {coherence}%',
  },
];

/** Chapter n (1..6), or undefined (7 = epilogue). */
export function getChapter(n: number): Chapter | undefined {
  return CHAPTERS[n - 1];
}

/** Chapter VII · Epilogue (§6.3): display fields only (summary ≤ 240, as a chapter's); the deck keeps running. */
export const EPILOGUE = {
  n: 7,
  title: 'EPILOGUE',
  epigraph: '',
  question: '',
  summary: "The charter is settled, but the city goes on. Your ending's rules now shape it, so keep building. Every few years a Charter Review lets you hold the count again and change the outcome.",
} as const;

/** Key choices shown as icons on the ending screen (story.keyChoices). */
export const KEY_CHOICE_CARDS: readonly string[] = ['ch1.lark', 'ch2.vote', 'ch3.pier', 'ch4.brine', 'ch5.choice'];

/** Toast after a chapter's goals are waived (§5.0). */
export const WAIVED_TEXT = 'The city moved on without it.';
