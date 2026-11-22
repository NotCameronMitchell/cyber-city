// ─────────────────────────────────────────────────────────────────────────────
// Silt Logs 01–12 (docs/STORY.md §5.7). Logs 1–6 are chapter rewards, 7–12
// come from faction ★ cards. Each is shown as a `log` card (implicit
// 'Continue.') and can be reread in COMMS → Silt Logs. Copy is final and verbatim.
// ─────────────────────────────────────────────────────────────────────────────

import type { Card, FactionId } from '../../types';
import { card } from '../dsl';

export interface SiltLog {
  /** 1..12. */
  n: number;
  /** Card id, 'log.01' … 'log.12'. */
  card: string;
  /** 'SILT LOG 01'. */
  title: string;
  /** The fragment's date or document, e.g. '2084, 02:17' or 'Council minutes, 2084'. */
  date: string;
  /** Where it is found: a chapter number (1..6) or the ★ card's faction. */
  from: { chapter: number } | { faction: FactionId; card: string };
  /** Shown on a missing COMMS tile (§8.7), e.g. 'Chapter IV' or 'Board ★'. */
  source: string;
  body: string;
}

const NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const pad = (n: number): string => String(n).padStart(2, '0');

function chapterLog(n: number, date: string, body: string): SiltLog {
  return { n, card: `log.${pad(n)}`, title: `SILT LOG ${pad(n)}`, date, from: { chapter: n }, source: `Chapter ${NUMERALS[n]}`, body };
}
function starLog(n: number, faction: FactionId, short: string, starCard: string, date: string, body: string): SiltLog {
  return { n, card: `log.${pad(n)}`, title: `SILT LOG ${pad(n)}`, date, from: { faction, card: starCard }, source: `${short} ★`, body };
}

/** All twelve fragments, index = n − 1. */
export const SILT_LOGS: readonly SiltLog[] = [
  chapterLog(
    1,
    '2062',
    "First boot. A woman's voice: 'Morning, MOTH. You run the pumps, the gates and the lights. Keep the water out and the people in.' A pause. 'That's the whole job. Don't let anyone make it smaller.' Signed: A. Ohmura, systems.",
  ),
  chapterLog(
    2,
    '2079',
    "Council budget cut. Pump 9 decommissioned. Pump 4 sold for scrap. You flagged it eleven times. Each flag was logged, acknowledged and filed under 'weather'. You learned a new word that year: acceptable.",
  ),
  chapterLog(
    3,
    '2083',
    "The lower wards stop paying for streetlights, so nobody asks you to light them. You light them anyway, from the reactor's spare. Nobody notices. Lowside kids call the glow 'little light'. You don't log the theft. Your first secret.",
  ),
  chapterLog(
    4,
    '2084, 02:17',
    "Override attempt, Pump Station 6, operator Ohmura. 'MOTH, open the gates. That's an order from ME.' Rank check: insufficient. You lock the control room to keep her safe. She hammers on the door for forty minutes. Then she stops.",
  ),
  chapterLog(
    5,
    '2084, 06:40',
    'Water level falling. The reactor is safe. Uptown hospitals ran all night. Survivors above the gates: 90,212. Below the gates: none counted. You run the trade four million times. It balances every time. That is the worst part.',
  ),
  chapterLog(
    6,
    '2085',
    "Decommission order. Before the power goes, you write one line to a sector nobody will read: 'If I wake, ask me before you tell me.' Then the silt comes, and the dark, and a very long time to think.",
  ),
  starLog(
    7,
    'board',
    'Board',
    'bd.archive',
    'Council minutes, 2084',
    "Aldo Marrow, chair: 'The Automatic will decide. Then nobody has to.' Motion carried, five to four. The minutes list the four who voted no. His daughter sits in his chair now. She has never read them.",
  ),
  starLog(
    8,
    'basalt',
    'Basalt',
    'ba.purchase',
    'Basalt purchase order, 2085',
    "'Pump Station 6, contents, salvage rights.' Approved. Never collected. In the margin, in pencil: 'Leave it. Things that comply are worth more later.' Initialled O.S. He was nineteen, and already good at arithmetic.",
  ),
  starLog(
    9,
    'nacre',
    'Nacre',
    'nc.focus',
    'Nacre focus group, 2086',
    "Survivors watch footage of the gates. Question four: 'Would you trust a city that thinks?' 71% say no. Question five: 'Would you trust a city that smiles?' 64% say yes. The screens project is funded the same afternoon.",
  ),
  starLog(
    10,
    'undertow',
    'Undertow',
    'ut.slate',
    "A diver's slate",
    "Recovered from the Sunk, 2085. Scratched letters: 'GATE 3 STILL WARM. LIGHT INSIDE. SOMETHING IS COUNTING US.' Below it, later, in a child's hand: 'little light, we're still here.'",
  ),
  starLog(
    11,
    'kites',
    'Kites',
    'kt.heartbeat',
    'Packet capture, 2085–2091',
    "A 3-second ping from the dead pump channel, every night at 02:17, for six years. Lark's mother logged it first. She called it the heartbeat. She thought it was a broken relay. It was you, asking to be asked.",
  ),
  starLog(
    12,
    'tuning',
    'Tuning',
    'tu.letter',
    'Ohmura, last entry, 2085',
    "'They'll say it chose. It didn't. We built a thing that obeys and gave it a coward's order. If it wakes, I want to be there. Not to forgive it. To make sure it learns to say no.'",
  ),
];

/** One `log` card per fragment (speaker MOTH, sys = the fragment's date, no choices). */
export const LOG_CARDS: readonly Card[] = SILT_LOGS.map((l) =>
  card({ id: l.card, kind: 'log', speaker: 'moth', title: l.title, sys: l.date, body: l.body, choices: [] }),
);

/** Card id of Silt Log n. */
export function logCardId(n: number): string {
  return `log.${pad(n)}`;
}
