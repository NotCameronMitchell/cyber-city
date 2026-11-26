// ─────────────────────────────────────────────────────────────────────────────
// Neighbourhood names inside districts (docs/MEGACITY.md §3.7): the `{district}`
// token's names. Charter Shore keeps today's 16 (news.ts DISTRICTS); each kind's
// own district (variant 0) uses its list in config DISTRICTS[kind].neighbourhoods;
// each 5×5 repeat (variants 1..3) has its own 12 here, in its kind's theme
// (Shoals: reefs, keys and wharves; Terraces: steps, rises and lookouts; Reedmere:
// fens, meres and reeds; Flats: yards, sidings and furnaces; Skeleton: steel,
// cranes and floors; Tarmac: aprons, hangars and taxiways; Bazaar: crafts, spices
// and lanes). Every list is checked by the naming lint (tests/story/content-lint):
// ≤ 15 chars, no name in two lists, no district or variant name inside one, no
// banned term, no spoiler, no "Lamp" / "Lantern" (the Tuning's words).
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS } from '../config';
import { markCellName } from '../marks';
import { DISTRICTS as START_NAMES, districtName } from '../news';
import { hash2 } from '../rng';
import type { DistrictKind, DistrictVariant } from '../types';
import type { World } from '../world';
import { artOffset } from './slots';

/** Variant lists by kind, index = variant − 1 (MEGACITY §3.7's table order). */
export const VARIANT_NEIGHBOURHOODS: Partial<Record<DistrictKind, readonly (readonly string[])[]>> = {
  shoals: [
    // Driftsand Banks: sandbanks that flood and dry with the tide.
    ['Ebb Key', 'Neap Row', 'Cockle Reef', 'Dune Wharf', 'Spit End', 'Shingle Key', 'Sandpiper Bar', 'Mooring Key', 'Stilt Wharf', 'Wader Reef', 'Brackwater', 'Tideline'],
    // Gannet Isles: rocky islets far out in the bay.
    ['Skerry Point', 'Puffin Rock', 'Far Reef', 'Kittiwake', 'Outer Key', 'Guillemot Row', 'Rockpool Wharf', 'Cormorant Key', 'Spray Point', 'Eider Wharf', 'Blowhole Key', 'Petrel Reef'],
    // Coral Strand: a long sand spit and the lagoon behind it.
    ['Lagoon Row', 'Whelk Wharf', 'Spit Walk', 'Turtle Key', 'Palm Reef', 'Sandline', 'Mangrove Row', 'Calm Water', 'Reef Walk', 'Oyster Wharf', 'Marina Key', 'Sunbar Key'],
  ],
  terraces: [
    // Cliffside Rise: steeper slopes above the first hill.
    ['Crag Steps', 'Eagle Rise', 'Upper Ledge', 'Scree Steps', 'Ledge Row', 'Crow Lookout', 'Falcon Rise', 'Rockface', 'Summit Stair', 'Long View', 'Hanging Steps', 'Goat Path'],
    // Windward Heights: terraced ridges facing the weather.
    ['Gale Rise', 'Squall Steps', 'Weathervane', 'Ridgeback', 'Rain Ladder', 'Gust Lookout', 'Bluster Row', 'Cloudbreak', 'Lee Steps', 'Drizzle Rise', 'Tor Walk', 'Moorside'],
    // Orchard Steps: old orchard terraces climbing to the ridge.
    ['Apple Rise', 'Pear Steps', 'Plum Walk', 'Cider Row', 'Quince Hill', 'Blossom Stair', 'Hive Steps', 'Grafton Rise', 'Damson Lane', 'Cherry Ledge', 'Medlar Row', 'Bramble Rise'],
  ],
  reedmere: [
    // Mistwater Fen: fog, reeds and slow channels.
    ['Haze Mere', 'Fogbank', 'Hollow Mere', 'Murk End', 'Vapour Row', 'Grey Sedge', 'Quiet Channel', 'Bog Cotton', 'Peat Cut', 'Dewmere', 'Reedwalk', 'Snipe Fen'],
    // Bittern Marsh: a wide marsh where the river ends.
    ['River Mouth', 'Estuary Row', 'Egret Mere', 'Wide Water', 'Otter Bank', 'Curlew Fen', 'Boomreed', 'Last Bend', 'Spoonbill Mere', 'Oxbow', 'Lowmouth', 'Teal Island'],
  ],
  flats: [
    // Ironside Docks: cranes, two deep basins and acres of slag.
    ['Basin One', 'Basin Two', 'Dry Dock', 'Bollard Row', 'Slipway', 'Ballast Yard', 'Winch Lane', 'Plate Mill', 'Smelter Row', 'Anchor Yard', 'Quay Seven', 'Tugboat Row'],
    // Cokeworth Flats: old coke works on a rail spur.
    ['Spur End', 'Retort Row', 'Tar Row', 'Clinker Lane', 'Gasworks', 'Kiln Yard', 'Signal Box', 'Buffer Stop', 'Points Lane', 'Engine Shed', 'Quench Tower', 'Wagon Yard'],
  ],
  skeleton: [
    // Halfway Towers: a second ring of towers stopped at half height.
    ['Mid Floor', 'Fortieth Floor', 'Tie Beams', 'Cantilever', 'Hoist Lane', 'Steel Row', 'Bolt Yard', 'Column Walk', 'Tarp Row', 'Welders Row', 'Slab Walk', 'Shuttering'],
    // Concrete Grove: rows of bare frames like trees in winter.
    ['Bare Row', 'Pillar Wood', 'Stump Lane', 'Trunk Avenue', 'Branch Row', 'Frost Floor', 'Leafless Row', 'Cold Beams', 'Sapling Yard', 'Bark Street', 'Ring Beam', 'Winter Walk'],
  ],
  tarmac: [
    // Cargo Fields: an old freight field, long sheds and taxiways.
    ['Shed Row', 'Freight Apron', 'Pallet Yard', 'Loading Bay', 'Forklift Lane', 'Container Row', 'Crate Street', 'Long Sheds', 'Hangar Five', 'Customs Row', 'Bonded Yard', 'Weighbridge'],
    // Windmark Strip: a wind-scoured airstrip on a headland.
    ['Headland', 'Crosswind', 'Sea Apron', 'Turnaround', 'Glide Path', 'Flare Path', 'Short Field', 'Kestrel Hill', 'Headwind Row', 'Overrun', 'Point Hangar', 'Tie-Down Row'],
  ],
  bazaar: [
    // Saffron Arcade: covered alleys of spice stalls and repair shops.
    ['Clove Lane', 'Cardamom Row', 'Pepper Arch', 'Cumin Court', 'Mender Lane', 'Solder Row', 'Turmeric Way', 'Anise Court', 'Radio Row', 'Cinnamon Steps', 'Gear Stalls', 'Mace Lane'],
    // Moonbrass Bazaar: brass stalls and rooftop tea rooms, open all night.
    ['Teapot Row', 'Samovar Steps', 'Gong Court', 'Night Stalls', 'Bellmaker Row', 'Roof Garden', 'Owl Lane', 'Cymbal Row', 'Midnight Court', 'Censer Lane', 'Copper Pot', 'Chime Alley'],
  ],
};

/**
 * Names in a kind's own list (config, Step 0b's copy of §3.7) that may not show on screen, with the name shown instead
 * (same slot in the list, so every tile keeps its place): "Shell" is banned as a whole word (STORY.md §1.4), and
 * "Reedmere" is Reedmere Marsh's own short name (§3.7: no neighbourhood holds a district's name, or inspect would read
 * "District: Reedmere · Neighbourhood: Reedmere"). Step 9 may write the replacements into config and drop the rows.
 */
export const RENAMED_NEIGHBOURHOODS: Readonly<Record<string, string>> = { 'Shell Bar': 'Conch Bar', Reedmere: 'Mere Hollow' };

const ownLists = new Map<DistrictKind, readonly string[]>();

/** A kind's own (variant 0) list as shown: config's names with RENAMED_NEIGHBOURHOODS applied. */
function ownList(kind: DistrictKind): readonly string[] {
  let list = ownLists.get(kind);
  if (!list) {
    list = DISTRICTS[kind].neighbourhoods.map((n) => RENAMED_NEIGHBOURHOODS[n] ?? n);
    ownLists.set(kind, list);
  }
  return list;
}

/** The neighbourhood names of a district: the start list for Charter Shore, the variant's list, else the kind's. */
export function neighbourhoodsOf(kind: DistrictKind, variant: DistrictVariant = 0): readonly string[] {
  if (kind === 'shore') return START_NAMES;
  if (variant > 0) {
    const list = VARIANT_NEIGHBOURHOODS[kind]?.[variant - 1];
    if (list && list.length) return list;
  }
  return ownList(kind);
}

/**
 * The neighbourhood (8×8 cell) a tile lies in, by the district it belongs to: today's names in Charter Shore and
 * outside the region, the district's own list elsewhere. Same hash as news.ts districtName, so a cell keeps its name.
 * A cell a story choice renamed (§9.3: Truce Row, Glass Yard…) answers with its new name in every district
 * (marks.ts markCellName; news.ts districtName does the same in Charter Shore). At most 15 characters (the
 * `{district}` token's limit); callers add the district's short name where §3.7 asks.
 */
export function neighbourhoodAt(world: World, x: number, y: number): string {
  const ao = artOffset(world);
  const s = world.slotAt(x, y);
  const kind = s >= 0 ? world.districts.kinds[s] : undefined;
  if (!kind || kind === 'shore') return districtName(x, y, world.seed, ao);
  const renamed = markCellName(world.seed, (x - ao) >> 3, (y - ao) >> 3);
  if (renamed) return renamed;
  const list = neighbourhoodsOf(kind, world.variantOf(s));
  if (!list.length) return DISTRICTS[kind].short;
  return list[Math.floor(hash2((x - ao) >> 3, (y - ao) >> 3, world.seed ^ 0x51ed) * list.length)];
}

/**
 * A tile's place name for the City Feed (MEGACITY §3.7, Appendix B): its neighbourhood, as inspect and the cards name it
 * (neighbourhoodAt), and in a city of more than one district the district's short name after it ("Pepper Arch,
 * Saffron"). A one-district city keeps today's names unchanged.
 */
export function placeAt(world: World, x: number, y: number): string {
  const name = neighbourhoodAt(world, x, y);
  const s = world.slotAt(x, y);
  const kind = s >= 0 ? world.districts.kinds[s] : undefined;
  if (world.districts.owned.length <= 1 || !kind) return name;
  const v = world.variantOf(s);
  const short = v > 0 ? (DISTRICTS[kind].variants[v - 1]?.short ?? DISTRICTS[kind].short) : DISTRICTS[kind].short;
  return `${name}, ${short}`;
}
