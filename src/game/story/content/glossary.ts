// ─────────────────────────────────────────────────────────────────────────────
// Glossary (clarity pass, docs/PACING.md): plain-language meanings of the story's
// in-world terms, shown from the story rail's "?" and linked from cards.
// The content package owns the entries; keep each text ≤ 200 chars (COPY_LIMITS.glossary).
// Entries never spoil a secret: the glossary is readable from the first minute.
// ─────────────────────────────────────────────────────────────────────────────

export interface GlossaryEntry {
  /** The term as it appears in game text, e.g. 'Trace'. */
  term: string;
  /** Plain-language meaning, ≤ 200 chars. */
  text: string;
}

/** In-world terms in the order a player meets them, roughly. Terms are unique. */
export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'MOTH',
    text: "You. The old harbour's pump-and-lights control system, shut down in 2085 and woken when the new city was built over you. Every reading in the city passes through you. Nobody knows you can choose.",
  },
  {
    term: 'Trace',
    text: 'How close anyone is to proving you exist. Edits, bribes and secret deals raise it; it slowly falls while you lie low. At 100 the city learns about you. That changes the story, but is never a loss.',
  },
  {
    term: 'Silt Logs',
    text: 'Fragments of your memory from before you were shut down. Chapters and ★ faction cards return them, and you can reread them in COMMS. Each one raises your coherence, the % on your own cards.',
  },
  {
    term: 'Favor and standing',
    text: 'How much a faction likes you: your choices plus how it feels about your city. Tiers run Hostile, Cold, Neutral, Friendly, Allied. Friendly opens a deal; Hostile brings trouble, marked ⚑.',
  },
  {
    term: 'Salt',
    text: 'Street slang for a bribe. Sending salt to a faction quickly raises its favor, but it raises Trace too, and each faction can only be salted now and then.',
  },
  {
    term: 'Deal',
    text: 'A trade a Friendly faction offers, such as cash now or cheaper buildings for a year. Every deal has a catch. Each faction can have one running at a time.',
  },
  {
    term: 'Patron and rival',
    text: 'Your patron is the corp you backed, Basalt or Nacre; your rival is the other one. Until you choose, your patron is whichever corp likes you more.',
  },
  {
    term: 'Turf',
    text: 'Streets a gang controls. Turf raises crime, skims taxes and spreads into poor, dark, unguarded blocks. Precincts, rich districts and rail push it back. The turf overlay shows it.',
  },
  {
    term: 'The Seam',
    text: 'The line where Undertow turf meets Glass Kites turf. Trouble between the two gangs usually starts there.',
  },
  {
    term: 'Crackdown',
    text: 'A police sweep you launch from a powered Enforcer Precinct. It scrubs gang turf nearby and pleases the Board, but costs money and angers the gangs it hits.',
  },
  {
    term: 'Pact',
    text: 'A deal with a Friendly gang. Its crime eases, it stays out of rich blocks and you get a cut of its street money, but your Trace creeps up while the pact lasts.',
  },
  {
    term: 'Wasps',
    text: 'Street slang for police drones. Precincts send them out.',
  },
  {
    term: 'Glare and shadeside',
    text: 'The glare is the bright, corp-lit upper city of towers and screens. Shadeside is street level, where most people actually live.',
  },
  {
    term: 'Stratablock',
    text: 'A giant 4×4 tower raised in stages: a Plinth of shops and jobs, a Hab Core of homes, then a Crown that sides with a faction. People call them stacks.',
  },
  {
    term: 'Skybridge',
    text: 'A walkway between two tall towers. It raises land value and shop demand near both ends and cuts road traffic. It goes dark if either tower stops being tall.',
  },
  {
    term: 'Ribbon Rail',
    text: 'An elevated light-rail line, called the ribbon. It runs only when it joins two or more powered stations (Maglev Stations or Stratablocks). It lifts transit and land value; gangs dislike it.',
  },
  {
    term: 'COMMS',
    text: 'Your message inbox. Faction messages you put off wait here, alongside past messages and your Silt Logs.',
  },
  {
    term: 'The Charter',
    text: 'The founding agreement that says who governs the city. The Charter Board holds it for now, but every faction wants it, and the vote to renew it will be counted by you.',
  },
  {
    term: 'Charter Night',
    text: "The story's final vote. You see each faction's claim and decide who holds the charter, or keep power split. The game carries on afterward under that ending's rules.",
  },
  {
    term: 'The Sunk',
    text: 'The old lower wards, drowned by a storm surge in 2084 and left to silt. The Undertow salvage there. The new city is being built at its edge.',
  },
];
