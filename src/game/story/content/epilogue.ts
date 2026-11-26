// ─────────────────────────────────────────────────────────────────────────────
// Choices that last, the words (docs/MEGACITY.md §9.3, §9.4): the Charter
// Review's callback lines, the strings of the three epilogue tokens, and the
// names and plaques of the marks the key choices leave on the map.
//
// Review lines: each Charter Review appends exactly one, the first whose
// `when` holds and whose id is not in story.callbacks, in table order; the
// generic line when none is left (director.ts). Lines are narrator voice,
// ≤ 140 characters with {patron} at its longest.
//
// Spoiler guard (§8.6): every string here can only show after Chapter IV's
// reveal (they are keyed on the key choices or the ending), and none of them
// names the gates, the sealing, the order's word or the toll.
// ─────────────────────────────────────────────────────────────────────────────

import type { FlagValue, StoryState } from '../types';

/** The longest review line, after {patron} is filled at its longest (§9.4). */
export const REVIEW_LINE_MAX = 140;

/** One Charter Review callback line (§9.4). */
export interface ReviewLine {
  id: string;
  /** The saved story state the line remembers. */
  when: (st: StoryState) => boolean;
  text: string;
}

const flag = (st: StoryState, k: string, eq?: FlagValue): boolean => (eq === undefined ? !!st.flags[k] : st.flags[k] === eq);
const key = (st: StoryState, card: string, i: number): boolean => st.keyChoices[card] === i;

/** The generic line, when every callback the city has earned is used. */
export const GENERIC_REVIEW_LINE = 'rl.generic';

/** §9.4's table, in order. */
export const REVIEW_LINES: readonly ReviewLine[] = [
  { id: 'rl.lark', when: (s) => flag(s, 'larkKnows'), text: 'Lark still flies the moth kite over the rooftops. She tells the new kids it answers when they ping it. It does.' },
  { id: 'rl.dark', when: (s) => key(s, 'ch1.lark', 1), text: "The dead pump channel still pings now and then. You still don't answer. The kids on the roofs have stopped asking." },
  { id: 'rl.clerk', when: (s) => flag(s, 'clerkLie'), text: 'A permit form still lists Clerk No. 9. Nobody has ever met the clerk. You keep it that way.' },
  { id: 'rl.tie', when: (s) => flag(s, 'honestTie'), text: 'The Board still quotes the four-to-four vote. The terminal told the truth that night, and they have not forgotten.' },
  { id: 'rl.basalt', when: (s) => key(s, 'ch2.vote', 0), text: 'Basalt still builds on the projection you gave them. The furnaces never asked whether it was honest.' },
  { id: 'rl.nacre', when: (s) => key(s, 'ch2.vote', 1), text: 'Nacre still frames the projection in its lobby: the night the city chose delight. They frame it beautifully.' },
  { id: 'rl.glass', when: (s) => flag(s, 'cleanGlass'), text: 'The Clean Glass mast still lights the Seam. The kids there were born after the sweep. They know the story anyway.' },
  { id: 'rl.truce', when: (s) => flag(s, 'truce'), text: 'The Truce Wall at the Seam has more tags than ever, and not one of them is crossed out.' },
  { id: 'rl.tideU', when: (s) => flag(s, 'oneTide', 'undertow'), text: 'Nets still hang over Low Water. The Undertow tells the story of the Seam one way. The Kites tell it another.' },
  { id: 'rl.tideK', when: (s) => flag(s, 'oneTide', 'kites'), text: 'Kites still fly over the High Line. The Kites tell the story of the Seam one way. The Undertow tells it another.' },
  { id: 'rl.published', when: (s) => flag(s, 'published'), text: 'The names from the Sunk are read aloud every year now. Old Brine reads her mother\'s street last.' },
  { id: 'rl.buried', when: (s) => flag(s, 'buried'), text: "The old pump hall is still fenced and dark. {patron}'s sign has faded. The water under it has not." },
  { id: 'rl.leashed', when: (s) => flag(s, 'leashed'), text: 'The Board still keeps the key to the old pump hall. Marrow checks the lock herself, every month.' },
  { id: 'rl.signed', when: (s) => flag(s, 'lure', 'shelved'), text: "{patron}'s colours are on every lamp you light. You light them anyway, on time, every night." },
  { id: 'rl.ground', when: (s) => flag(s, 'wentToGround'), text: 'Three dark blocks still hum after midnight. The crews never ask what runs in them. You never tell.' },
  { id: 'rl.kept', when: (s) => flag(s, 'keptByBoard'), text: 'Every month you answer to the Board, out loud. Five to four, the first time. Some months now it is six.' },
  { id: 'rl.ohm', when: (s) => flag(s, 'hiddenByTuning'), text: "Sister Ohm still keeps a lamp by the pump hall door. She says it is for next time. She hopes there isn't one." },
  { id: 'rl.recall', when: (s) => flag(s, 'fullRecall'), text: 'Every lamp in the old pump hall is lit. You stayed. Some nights that is the whole job.' },
  { id: GENERIC_REVIEW_LINE, when: () => true, text: 'The city has grown since Charter Night. So have the claims.' },
];

/**
 * The line the next Charter Review appends (§9.4): the first unused line whose `when` holds, in table order, else
 * the generic line.
 */
export function nextReviewLine(st: StoryState): ReviewLine {
  const used = new Set(st.callbacks ?? []);
  for (const l of REVIEW_LINES) if (l.id !== GENERIC_REVIEW_LINE && !used.has(l.id) && l.when(st)) return l;
  return REVIEW_LINES[REVIEW_LINES.length - 1];
}

/** A review line by id (undefined for an id a later build removed). */
export function reviewLine(id: string): ReviewLine | undefined {
  return REVIEW_LINES.find((l) => l.id === id);
}

// ── The three epilogue tokens (§9.4; their longest values are in tokens.ts CARD_TOKEN_MAX) ──

/** `{seamPast}`: what happened at the Seam in Chapter III. */
export const SEAM_PAST = {
  truce: 'the Seam Truce',
  cleanGlass: 'Clean Glass',
  undertow: 'the night the Undertow took the Seam',
  kites: 'the night the Kites took the Seam',
} as const;
/** `{votePast}`: what the terminal showed the Board in Chapter II. */
export const VOTE_PAST = { tie: 'the honest tie', basalt: 'the Basalt projection', nacre: 'the Nacre projection' } as const;
/** `{logsPast}`: what became of the logs in Chapter IV. */
export const LOGS_PAST = { published: 'the logs you published', buried: 'the logs you buried', leashed: 'the leash' } as const;

/** The three tokens' values for this city (missing choices leave the token out, so the text keeps `{…}`). */
export function epilogueTokens(st: StoryState): Record<string, string> {
  const out: Record<string, string> = {};
  if (st.flags.truce) out.seamPast = SEAM_PAST.truce;
  else if (st.flags.cleanGlass) out.seamPast = SEAM_PAST.cleanGlass;
  else if (st.flags.oneTide === 'undertow') out.seamPast = SEAM_PAST.undertow;
  else if (st.flags.oneTide === 'kites') out.seamPast = SEAM_PAST.kites;
  const vote = st.keyChoices['ch2.vote'];
  if (st.flags.honestTie || vote === 2) out.votePast = VOTE_PAST.tie;
  else if (vote === 0) out.votePast = VOTE_PAST.basalt;
  else if (vote === 1) out.votePast = VOTE_PAST.nacre;
  if (st.flags.published) out.logsPast = LOGS_PAST.published;
  else if (st.flags.buried) out.logsPast = LOGS_PAST.buried;
  else if (st.flags.leashed) out.logsPast = LOGS_PAST.leashed;
  return out;
}

// ── The marks' names and plaques (§9.3; each plaque ≤ 90 characters) ──

/** Names (the Keepsakes list's row titles) and plaques of every mark `marks.ts` derives, by mark id. */
export const MARK_COPY: Readonly<Record<string, { title: string; plaque: string }>> = {
  larkKite: { title: "lark's kite", plaque: "lark's kite: she flies it for you." },
  helloKite: { title: 'The new kids\' kite', plaque: 'A second kite. The new kids pinged back.' },
  deadChannel: { title: 'The dead channel', plaque: 'A dead pump channel. Nothing pings back.' },
  clerkNine: { title: 'Clerk No. 9', plaque: 'Permits: Clerk No. 9.' },
  patronBasalt: { title: 'Projection Yard', plaque: 'Ground broken on a projection.' },
  patronNacre: { title: 'Delight Row', plaque: 'Delight, as projected.' },
  honestTie: { title: 'Four-Four Plaza', plaque: 'Four to four. The terminal told the truth.' },
  cleanGlassMast: { title: 'Glass Yard', plaque: 'Operation Clean Glass began here.' },
  truceWall: { title: 'Truce Row', plaque: 'The crews signed the Seam Truce here.' },
  lowWater: { title: 'Low Water', plaque: 'The Undertow took the Seam here.' },
  highLine: { title: 'High Line', plaque: 'The Kites took the Seam here.' },
  openHall: { title: 'The open hall', plaque: 'Open to all. The names are read here every year.' },
  privateWorks: { title: 'Private works', plaque: 'Private works. No entry.' },
  pouredSlab: { title: 'The slab', plaque: 'Private works. One slab, poured over the file.' },
  archive: { title: 'The Board archive', plaque: 'Board archive. Key held by the Chair.' },
  everyLamp: { title: 'Every lamp lit', plaque: 'Every lamp lit.' },
  lowerWards: { title: 'The Lower Wards memorial', plaque: 'The names face the water here.' },
  livery: { title: 'Lamps under contract', plaque: 'Lit under contract.' },
  darkBlocks: { title: 'The dark blocks', plaque: 'Something hums here after midnight.' },
  balcony: { title: 'The answering balcony', plaque: 'MOTH answers to this room every month.' },
  ohmDoor: { title: "Ohm's door", plaque: 'A lamp by the door, for next time.' },
  crewBridge: { title: "lark's crew bridge", plaque: "lark's crew painted this." },
  fenKites: { title: "fen's kites", plaque: "fen's flying kites off the ribbon now." },
  minutes: { title: 'Minutes, unedited', plaque: 'Minutes, unedited.' },
  landmark: { title: 'The ending landmark', plaque: '' },
};

/** Taglines the Sunk takes after `ch4.brine` (§9.3), by the choice (first match wins: an opened hall reads open). */
export const SUNK_TAGLINES = {
  open: 'The drowned wards. The city knows their names now.',
  fenced: 'The drowned wards. Fenced off and quiet.',
  archive: 'The drowned wards. The Board keeps the key.',
} as const;

/** Neighbourhood names the marks give an 8×8 cell (§9.3; ≤ 15 characters like every `{district}` value). */
export const MARK_NAMES = {
  patronBasalt: 'Projection Yard',
  patronNacre: 'Delight Row',
  honestTie: 'Four-Four Plaza',
  cleanGlassMast: 'Glass Yard',
  truceWall: 'Truce Row',
  lowWater: 'Low Water',
  highLine: 'High Line',
} as const;

// ── The landmark set (§3.8, §9.2: a sandbox goal; the Keepsakes line and one ticker line) ──

/** The landmark set's copy: Keepsakes' progress line ({n} {of} {e} {eOf}), its whole line, the ticker line when it is whole ({pay}). */
export const LANDMARK_SET_COPY = {
  progress: 'The landmark set: {n} of {of} landmarks, {e} of {eOf} ending landmarks. A Charter Review can open another ending\'s landmark.',
  whole: 'The landmark set is whole: every landmark stands, and all five ending landmarks with them.',
  news: 'The landmark set is whole: every landmark stands, and all five ending landmarks with them. +{pay} CR',
} as const;
