// ─────────────────────────────────────────────────────────────────────────────
// News desk copy: flavor headlines for the ticker, event bulletins and the
// fictional corporations, crews and districts they mention. All names and
// jokes are original to Cyber City.
//
// Templates use {placeholders}: {city} {pop} {year} {lastYear} {district}
// {corp} {crew} {n} {tax}. Unknown placeholders are left untouched.
// ─────────────────────────────────────────────────────────────────────────────

import type { Rng } from './rng';
import { hash2 } from './rng';

export interface NewsContext {
  city: string;
  population: number;
  year: number;
  taxRate: number;
}

export interface Headline {
  text: string;
  /** Only run once the city has at least this many residents. */
  minPop?: number;
  /** Only run while the city is smaller than this. */
  maxPop?: number;
}

/** Fictional megacorps. */
export const CORPS = [
  'Halvane Dynamics',
  'Oxbow Biolytics',
  'Sunder & Vey',
  'Quillon Heavy Industries',
  'Marrowgate Systems',
  'Velloux Media',
  'Pellucid Labs',
  'Brightwater Aerial',
  'Corvane Securities',
  'Ostrava-Lumen',
  'Tidewell Pharma',
  'Gallowglass Logistics',
] as const;

/** Fictional street crews. */
export const CREWS = [
  'the Static Saints',
  'the Undertow',
  'the Glass Kites',
  'the Low Voltage',
  'the Hollow Choir',
  'the Rust Herons',
  'the Paper Lanterns',
  'the Ninth Gear',
  'the Velvet Static',
] as const;

/** District names, assigned to 8×8 tile neighbourhoods by a stable hash. */
export const DISTRICTS = [
  'Glasswater',
  'Lantern Row',
  'the Spindle',
  'Old Copperline',
  'Hexgate',
  'Cinder Quay',
  'Low Morrow',
  'Viaduct Nine',
  'Sablemarket',
  'the Undercroft',
  'Kettle Yards',
  'Mirrorside',
  'Ashfall Terrace',
  'Signal Hill',
  'Brine Steps',
  'the Lattice',
] as const;

/** Stable district name for a tile (same 8×8 block, same name, per city seed). */
export function districtName(x: number, y: number, seed = 0, artOffset = 0): string {
  // Art coordinates (MEGACITY §3.2 artXY: pass the world's art offset): the start slot keeps its names on either region.
  return DISTRICTS[Math.floor(hash2((x - artOffset) >> 3, (y - artOffset) >> 3, seed ^ 0x51ed) * DISTRICTS.length)];
}

/** Ticker flavor. Keep them short enough to read while scrolling (~120 chars). */
export const HEADLINES: readonly Headline[] = [
  { text: 'Delivery drones in {district} unionize over lunch breaks. Transit Authority "open to dialogue".' },
  { text: 'Rain forecast: 100% for the 412th straight day. Umbrella vendors post record quarter.' },
  { text: '{district} noodle bar earns its third holo-star. Queue now visible from low orbit.', minPop: 2000 },
  { text: 'Poll: 61% of {city} residents cannot remember the colour of the sky. 39% ask "which sky?"' },
  { text: '{corp} unveils self-cleaning trenchcoat. Early adopters say it also cleaned out their accounts.' },
  { text: 'Ad blimp "Persuasion IX" runs aground on a {district} rooftop. No injuries, many coupons.' },
  { text: 'Council votes to rename Tuesday. Motion stalls after a heated debate over "Glowday".' },
  { text: 'Synth-pigeon count hits {n}. Ornithologists unsure whether to celebrate or reboot.' },
  { text: 'Memory kiosk recalls a batch of second-hand birthdays. Check your childhood for defects.' },
  { text: 'Weather bureau admits clouds over {city} have been rendered, not real, since {lastYear}.' },
  { text: '{pop} residents, one shared opinion: the vending machine on 9th is haunted.', minPop: 3000 },
  { text: '{corp} launches lab-grown coffee bean that grows its own lab.' },
  { text: 'Rooftop koi farm in {district} wins the citywide "Most Unlikely Fish" award.' },
  { text: 'Traffic AI files for emotional leave after rush hour. Replacement AI "already tired".', minPop: 8000 },
  { text: 'Retro craze: teens rediscover "walking". Footwear stocks jump 300%.' },
  { text: "Mayor's hologram double-booked: appears at two ribbon cuttings and one very confused wedding." },
  { text: 'Vertical farm harvests its first lettuce that has never once touched the ground.' },
  { text: 'Late-night host claims {city} glows brighter than the moon. The moon declined to comment.' },
  { text: '{corp} patents the colour "midnight-ish". Painters advised to seek a licence.' },
  { text: 'Underground synth club so exclusive it does not exist. Tickets sold out anyway.' },
  { text: 'Insurers now cover "existential glitches". Premiums undisclosed and, frankly, unknowable.' },
  { text: 'Pollution sensors report record lows after someone unplugged the pollution sensors.' },
  { text: '{corp} adds a feature that lets you skip ads by watching longer ads.' },
  { text: 'Resident with zero implants found in {district}. Scientists politely request a selfie.' },
  { text: 'Stray cat elected honorary block warden of {district}. Approval rating beats council.' },
  { text: 'Maglev engineers deny rumours that trains are "just very confident buses".', minPop: 15000 },
  { text: 'Night market opens a "day market" section. Nobody has been able to find it.' },
  { text: '{city} ranks #3 in "Cities Visible From Space By Accident". Officials demand a recount.', minPop: 20000 },
  { text: 'Glow-in-the-dark graffiti spreads across {district}. Council cannot decide if it is art or a rash.' },
  { text: 'Local AI writes 10,000 poems about rain. Critics: "damp, but promising".' },
  { text: '{corp} recalls cargo drones that "got curious". Several still at large, sightseeing.' },
  { text: 'Ramen price index hits an all-time high. Economists recommend eating your feelings.' },
  { text: 'Sky-lane etiquette class oversubscribed after the third hover-taxi shouting match this week.', minPop: 10000 },
  { text: 'Data-smog advisory: residents urged to close all tabs and at least one window.' },
  { text: 'Retired cargo mech now runs a flower shop in {district}. "Roses are red," it reports, ominously.' },
  { text: 'Vending machine wins small-claims case against customer. Snack lawyers alarmed.' },
  { text: 'Survey: 8 in 10 residents own more screens than houseplants. Most houseplants are also screens.' },
  { text: '{corp} promises "a full night\'s sleep in one pill". Side effects include dreaming in spreadsheets.' },
  { text: 'Heatwave melts holo-billboards into abstract art. Galleries bid for the puddles.' },
  { text: 'Neon sign shop goes dark after forgetting to pay its power bill. Irony, say neighbours.' },
  { text: '{corp} launches a hover-bus with legroom. Engineers baffled by their own achievement.' },
  { text: 'Census drone counts {pop} residents, gives up on the umbrellas.', minPop: 5000 },
  { text: 'Chess champion defeated by a parking meter. Rematch set for Thursday.' },
  { text: '{corp} sells "personal fog" privacy clouds. Fog sold separately.' },
  { text: 'Undersea data vault springs a leak. Files now "slightly wet but legally binding".' },
  { text: 'Street-food drone recalls its dumplings for being "a little too self-aware".' },
  { text: 'Local legend says {city} was built on an old server farm. Residents report a dial-up hum at night.' },
  { text: 'Tax season approaches: accountants spotted wearing ceremonial visors.' },
  { text: '{crew} deface billboards with photos of real trees. Commuters openly weep.' },
  { text: 'Mass karaoke night in {district} trips the seismic sensors. Encore pending a permit.' },
  { text: 'Synthetic snow scheduled for the {year} winter festival. Real snow sends its regrets.' },
  { text: 'Ad-free zone proposed for {district}. Three corporations immediately offer to sponsor it.' },
  { text: 'New study: {city} residents blink 40% less than average. Optometrists blame "the good billboards".' },
  { text: 'Hab tower residents vote to name their elevator. "Gerald" wins by a landslide.', minPop: 12000 },
  { text: 'Lost-and-found office reports 3,000 umbrellas, 12 drones and one fully functional submarine.' },
  { text: 'Cab-share algorithm matches strangers by shared regrets. Ridership doubles.' },
  { text: '{corp} quarterly report: profits up, mood down, lighting "aggressively purple".', minPop: 25000 },
  { text: 'Frontier town {city} welcomes its newest resident: a very lost delivery robot.', maxPop: 4000 },
  { text: 'Settlers report the stars are still visible over {city}. Developers promise to fix that soon.', maxPop: 9000 },
  { text: 'Skyline so dense in {district} that pigeons now file flight plans.', minPop: 60000 },
  { text: 'Holo-dog walking service expands. Real dogs "deeply unimpressed".' },
  { text: 'Rain-powered street organ in {district} plays nonstop. Locals request a dry spell.' },
  { text: 'At {tax}% tax, café owners debate whether the city is "a bargain" or "a cry for help".' },
];

/** Event bulletins (random incidents). */
export const EVENT_COPY = {
  gridHack: [
    'GRID BREACH: intruders hijacked the {plant} in {district}. Output offline for {days} days.',
    'Power theft! A crew of code-thieves locked out the {plant} in {district}. Engineers need {days} days.',
    'Ransom on the wires: the {plant} near {district} is offline for {days} days while techs scrub the system.',
  ],
  gridHackFoiled: [
    'Enforcer drones traced an intrusion at the {plant} in {district} and slammed the door. Grid secure.',
    'Attempted grid hack foiled: patrol drones cornered the intruders outside the {plant}.',
  ],
  gridRestored: [
    'Lights back on: the {plant} is online again.',
    'Grid restored. The {plant} hums back to life.',
  ],
  gangSurge: [
    '{crew} are flexing in {district}. Expect muggings, tagging and very loud bikes. Enforcer cover would help.',
    'Turf war in {district}: {crew} are moving in. Crime spikes on every corner.',
    'Night-market shakedowns in {district}: {crew} are collecting "neon tax" from shopkeepers.',
  ],
  corpGrant: [
    '{corp} opens a regional office and gifts the treasury {amount}. Smile for the press drones.',
    '{corp} sponsors {city} infrastructure: {amount} lands in the city account.',
    'Tax-break thank-you: {corp} wires {amount} to city hall, plus a logo on everything.',
  ],
  smog: [
    'Smog alert! An inversion layer traps fab fumes over {city}. Air quality plunges for weeks.',
    'Chem-haze warning: a toxic cloud settles over the industrial belt. Masks recommended.',
  ],
  blackMarket: [
    'Black-market boom: pop-up bazaars flood the arcades of {district}. Commercial demand surges.',
    'Gray-goods gold rush! Smuggled gadgets sell out across {city}. Shopkeepers want more storefronts.',
  ],
} as const;

/** Replace {placeholders} in a template. */
export function fillTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/** Pick one line from a list and fill it. */
export function pickLine(rng: Rng, lines: readonly string[], vars: Record<string, string | number>): string {
  return capitalizeFirst(fillTemplate(rng.pick(lines), vars));
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Upper-case the first character (templates may start with "the …"). */
export const capitalizeFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Deals flavor headlines from a shuffled deck so the ticker never repeats a
 * joke until it has told all of them. Filters by city size at draw time.
 */
export class HeadlineDeck {
  private order: number[] = [];
  private pos = 0;

  draw(rng: Rng, ctx: NewsContext): string {
    for (let attempts = 0; attempts < HEADLINES.length * 2; attempts++) {
      if (this.pos >= this.order.length) this.shuffle(rng);
      const h = HEADLINES[this.order[this.pos++]];
      if (h.minPop !== undefined && ctx.population < h.minPop) continue;
      if (h.maxPop !== undefined && ctx.population >= h.maxPop) continue;
      return capitalizeFirst(fillTemplate(h.text, {
        city: ctx.city,
        pop: fmtInt(ctx.population),
        year: ctx.year,
        lastYear: ctx.year - 1 - rng.int(0, 6),
        district: rng.pick(DISTRICTS),
        corp: rng.pick(CORPS),
        crew: rng.pick(CREWS),
        n: fmtInt(1000 + Math.floor(rng.next() * 90000)),
        tax: ctx.taxRate,
      }));
    }
    return `${ctx.city}: all quiet on the neon front.`;
  }

  private shuffle(rng: Rng): void {
    const o = this.order;
    o.length = 0;
    for (let i = 0; i < HEADLINES.length; i++) o.push(i);
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = o[i];
      o[i] = o[j];
      o[j] = t;
    }
    this.pos = 0;
  }
}
