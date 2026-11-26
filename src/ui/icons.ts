// ─────────────────────────────────────────────────────────────────────────────
// Original inline SVG icon set (24 × 24 grid, 1.7 px strokes). Drawn for Cyber
// City; no third-party glyphs. Paths use `currentColor`; elements with class
// "f" are filled, class "d" are dimmed accents (see .cc-i rules in ui.css).
// ─────────────────────────────────────────────────────────────────────────────

const HEX = 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z';

const PATHS = {
  // ── Tool categories ──────────────────────────────────────────────────────
  inspect: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/><path class="d" d="M10.5 7.6v5.8M7.6 10.5h5.8"/>',
  bulldoze:
    '<rect x="2.5" y="14.5" width="12" height="5" rx="2.5"/><path d="M4.5 14.5V9.5H9l2.5 5"/><path d="M14.5 16.5H17"/><path d="M17.5 11l3 1.2v7.6l-3-1.2z"/><circle class="f" cx="5.5" cy="17" r=".9"/><circle class="f" cx="11.5" cy="17" r=".9"/>',
  road: '<path d="M8.5 3L4 21M15.5 3L20 21"/><path class="d" d="M12 4v2.6M12 10v3M12 16.6v3.9"/>',
  zones: '<path d="M2.5 20.5h19"/><path d="M4 20.5V11h5v9.5"/><path d="M10.5 20.5V4.5h5v16"/><path d="M17 20.5v-7h3.5v7"/><path class="d" d="M12.4 8h1.2M12.4 11.5h1.2M12.4 15h1.2"/>',
  power: '<path d="M13.2 2.5L5 13.6h6.2L10.3 21.5 19 10.2h-6.3z"/>',
  services: '<path d="M12 3l7.5 3v5.6c0 4.6-3.2 8.1-7.5 9.4-4.3-1.3-7.5-4.8-7.5-9.4V6z"/><path d="M12 8.5v7M8.5 12h7"/>',
  landmarks: '<path d="M12 1.8L14.2 6v15h-4.4V6z"/><path d="M7.5 21v-9.5l2.3-1.5M16.5 21v-9.5l-2.3-1.5"/><path d="M4 21h16"/><path class="d" d="M12 9v2.2M12 13.5v2.2"/>',
  data: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path class="d" d="M3 17l9 5 9-5"/>',
  /** City map (MEGACITY §7.2): a folded map with a district diamond. */
  map: '<path d="M3 6.2l5.8-2.4 6.4 2.4 5.8-2.4v14l-5.8 2.4-6.4-2.4L3 20.2z"/><path class="d" d="M8.8 3.8v14M15.2 6.2v14"/>',
  /** A plus (Annex). */
  plus: '<path d="M12 5v14M5 12h14"/>',
  /** A land grant (✦): a four-point star. */
  grant: '<path d="M12 2.8l2.2 6.9 6.9 2.3-6.9 2.3L12 21.2l-2.2-6.9L2.9 12l6.9-2.3z"/>',
  /** Power & Ports (the Power tray once the first port unlocks): a bolt over a crane and hull. */
  infra:
    '<path d="M9.6 2.5L5.2 9h3.2L7.6 13l4.5-6.2H8.9z"/><path d="M16.5 15.5V4.5M16.5 5.5h-3.5M13.4 5.5v3.4M16.5 9l3-3.5"/><path d="M2.5 15.5h19l-2.6 4.5H5.1z"/><path class="d" d="M9 15.5v-2h3.5v2"/>',

  // ── Megacity types (MEGACITY §6.3, §9.2): one original glyph each ──────────
  /** Floodwatch Station: a gauge post with wave lines. */
  floodwatch: '<path d="M12 3v14"/><path d="M9.5 5.5h5M9.5 9h5M9.5 12.5h5"/><path d="M2.5 17.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5"/><path class="d" d="M2.5 21c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5"/>',
  /** Pump House: a small hall with a pipe and a rising drop. */
  pumphouse: '<path d="M4 20.5V11l6-4 6 4v9.5z"/><path d="M16 14h3.5v6.5"/><path class="d" d="M10 13.2c1.4 1.7 1.4 3 0 3.6-1.4-.6-1.4-1.9 0-3.6z"/><path d="M2.5 20.5h19"/>',
  /** Canopy Park: three tree crowns under one roof line. */
  canopypark: '<path d="M2.5 8.5L12 3l9.5 5.5"/><circle cx="7" cy="13" r="2.8"/><circle cx="12" cy="11.5" r="3.2"/><circle cx="17" cy="13" r="2.8"/><path d="M7 16v4.5M12 15v5.5M17 16v4.5"/>',
  /** Med Tower: a tall slab with a cross. */
  medtower: '<rect x="7" y="2.8" width="10" height="17.7"/><path d="M12 6.5v5M9.5 9h5"/><path class="d" d="M9.5 14.5h5M9.5 17h5"/><path d="M4 20.5h16"/>',
  /** Reclaim Works: a chimney with a filter grid and clean air. */
  reclaim: '<path d="M4 20.5V12h9v8.5"/><path d="M13 20.5V6h3.5v14.5"/><path class="d" d="M6 15h5M6 17.5h5"/><path d="M18 4.5c1.6-.6 2.4 0 3.5-.5"/><path d="M2.5 20.5h19"/>',
  /** Metro Station: an arch over a track going underground. */
  metro: '<path d="M4 20.5v-8a8 8 0 0 1 16 0v8"/><path d="M8.5 20.5l1.5-6h4l1.5 6"/><path class="d" d="M9.4 17h5.2"/><circle class="f" cx="12" cy="9" r="1.2"/>',
  /** Market Hall: a hall with stall awnings. */
  markethall: '<path d="M3 10l9-6 9 6"/><path d="M4.5 10v10.5h15V10"/><path d="M4.5 13.5h15"/><path class="d" d="M7.5 13.5v-.5M10.5 13.5v-.5M13.5 13.5v-.5M16.5 13.5v-.5"/><path d="M10 20.5v-4h4v4"/>',
  /** Tidal Turbine: rotor blades over the water. */
  tidal: '<circle cx="12" cy="9" r="1.5"/><path d="M12 7.5V3M13.3 9.8l3.9 2.2M10.7 9.8L6.8 12"/><path d="M12 10.5v6"/><path d="M2.5 17c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4 2-1.4 3-1.4"/><path class="d" d="M2.5 20.5c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4"/>',
  /** Geothermal Bore: a derrick on a hill with heat waves. */
  geothermal: '<path d="M2.5 20.5l6-6 4 3 3-2 6 5"/><path d="M12 17.5V7l-2.5 3.5M12 7l2.5 3.5"/><path class="d" d="M8 5c.8-1 .8-2 0-3M12 4.5c.8-1 .8-2 0-3M16 5c.8-1 .8-2 0-3"/>',
  /** Data Vault: a buried hall with a data line. */
  datavault: '<path d="M2.5 12h19"/><rect x="5.5" y="14" width="13" height="6.5"/><path class="d" d="M8 17.2h2M11 17.2h2M14 17.2h2"/><path d="M12 12V4.5M9.5 6.5L12 4l2.5 2.5"/>',
  /** Charter Hall: a domed hall with flags. */
  charterhall: '<path d="M3 20.5h18"/><path d="M5 20.5v-8h14v8"/><path d="M8 12.5a4 4 0 0 1 8 0"/><path class="d" d="M8 15v5.5M12 15v5.5M16 15v5.5"/><path d="M12 8.5V3l3 1.2-3 1.2"/>',
  /** Hexworks: hex prisms and a flame stack. */
  hexworks: '<path d="M7 9.5l3.5-2 3.5 2v4l-3.5 2-3.5-2z"/><path d="M5 20.5l1-5h9l1 5z"/><path d="M17 20.5V7h2.5v13.5"/><path class="d" d="M18.2 5.5c-.9-1-.4-2 .4-3 .5 1 1 1.8.2 3"/>',
  /** Pearl Atrium: a glowing dome with a ring. */
  pearlatrium: '<path d="M4 20.5a8 8 0 0 1 16 0"/><ellipse cx="12" cy="10" rx="8.5" ry="2.4"/><circle class="d" cx="12" cy="6" r="2"/><path d="M2.5 20.5h19"/>',
  /** Hullhouse: an upturned hull over a hall. */
  hullhouse: '<path d="M2.5 11c3-3.5 16-3.5 19 0"/><path d="M4 11v9.5M20 11v9.5"/><path class="d" d="M8 11v9.5M12 10v10.5M16 11v9.5"/><path d="M2.5 20.5h19"/>',
  /** Kite Mast: a mast with kites on lines. */
  kitemast: '<path d="M12 21V3"/><path d="M9 21h6"/><path d="M12 5l5 2.5-3 3z"/><path class="d" d="M12 9l-5.5 2 2.5 2.8z"/><path class="d" d="M14 10.5L18 16"/>',
  /** Lamp Choir: a pointed roof over a row of lamps. */
  lampchoir: '<path d="M5 20.5v-9L12 4l7 7.5v9"/><circle class="f" cx="9" cy="15" r="1.1"/><circle class="f" cx="12" cy="15" r="1.1"/><circle class="f" cx="15" cy="15" r="1.1"/><path d="M3 20.5h18"/>',
  /** Harbour Beacon: a lighthouse throwing a beam. */
  beacon: '<path d="M9.5 20.5l1-12h3l1 12z"/><path d="M10 8.5l2-3 2 3"/><path class="d" d="M14.5 6.5l7-2.5M14.5 7.5l7 1.5"/><path d="M5 20.5h14"/>',
  /** Arc Arena: an oval bowl with floodlights. */
  arena: '<ellipse cx="12" cy="15" rx="9" ry="4"/><ellipse class="d" cx="12" cy="14.5" rx="5" ry="1.8"/><path d="M4 13V6M20 13V6"/><path d="M3 6h2M19 6h2"/>',
  /** Halo Lookout: a ring of glass on a tower. */
  halolookout: '<ellipse cx="12" cy="7" rx="7" ry="2.6"/><path d="M10 9.5v11h4v-11"/><path class="d" d="M5 7v1.5M19 7v1.5"/><path d="M6 20.5h12"/>',
  /** Grand Terminal: a vaulted station with lines meeting. */
  terminal: '<path d="M3 20.5V12a9 6 0 0 1 18 0v8.5"/><path d="M3 20.5h18"/><path class="d" d="M7 20.5l3-6M17 20.5l-3-6M12 20.5v-6"/><path d="M8.5 9.5h7"/>',
  /** Foreman's Gantry: a gantry crane over a yard. */
  gantry: '<path d="M4 20.5V6h16v14.5"/><path d="M4 6l4-3h8l4 3"/><path class="d" d="M14 6v6"/><rect x="12" y="12" width="4" height="3"/><path d="M2.5 20.5h19"/>',
  /** The Glass Smile: a sphere on a stem, smiling. */
  glasssmile: '<circle cx="12" cy="8" r="5.5"/><path d="M9.3 9.2c1.4 1.8 4 1.8 5.4 0"/><path d="M12 13.5v7M8.5 20.5h7"/>',
  /** Bread Pier: a long canopy over a pier. */
  breadpier: '<path d="M2.5 9.5L12 5l9.5 4.5"/><path d="M4 9.5v6M20 9.5v6"/><path d="M2.5 15.5h19"/><path class="d" d="M6 15.5v5M10 15.5v5M14 15.5v5M18 15.5v5"/>',
  /** Record Tower: a stone tower with scrolling lines. */
  recordtower: '<path d="M7 20.5V5l5-2.5L17 5v15.5"/><path class="d" d="M9.5 8h5M9.5 11h5M9.5 14h5M9.5 17h3"/><path d="M4 20.5h16"/>',
  /** The Still Square: a balance with level pans. */
  stillsquare: '<path d="M12 4v15"/><path d="M5 7h14"/><path d="M5 7l-2.5 5h5zM19 7l-2.5 5h5z"/><path d="M7.5 20.5h9"/>',

  // ── Road kinds and the Skyway (EXPANSION §7.2) ───────────────────────────
  /** Avenue: a wide boulevard with a planted median. */
  avenue:
    '<path d="M7 3L2 21M17 3l5 18"/><path d="M11.3 3.5l-.5 17M12.7 3.5l.5 17"/><path class="d" d="M8.9 6.5l-.5 2M7.6 12l-.5 2.2M6.2 17.5l-.5 2.3M15.1 6.5l.5 2M16.4 12l.5 2.2M17.8 17.5l.5 2.3"/>',
  /** Highway: lanes running under an overhead sign gantry. */
  highway:
    '<path d="M3 8h18M4.5 8v13M19.5 8v13"/><rect x="8.2" y="3.2" width="7.6" height="4.8" rx=".8"/><path d="M9.2 21l1.4-9.5M14.8 21l-1.4-9.5"/><path class="d" d="M12 13v2M12 17.5v3"/>',
  /** Back Alley: a narrow lane between two walls, one lamp. */
  alley:
    '<path d="M3 21V3.5h5.5V21M15.5 21V6.5H21V21"/><path d="M10.6 21l.6-6.5M13.4 21l-.6-6.5"/><circle class="f" cx="12" cy="10.5" r="1.1"/><path class="d" d="M5 7h2M5 10.5h2M5 14h2M17.5 10h2M17.5 13.5h2"/>',
  /** Skyway: a raised deck on pillars, ramping down to the ground, with headlights. */
  skyway:
    '<path d="M2 20.5L8.6 10H22M4.8 20.5L10.6 13H22"/><path d="M14.5 13v8M19.5 13v8"/><circle class="f" cx="13.5" cy="11.5" r=".85"/><circle class="f" cx="17.8" cy="11.5" r=".85"/><path class="d" d="M1.5 21h21"/>',

  // ── Zones ────────────────────────────────────────────────────────────────
  res: '<path d="M2.5 21h19"/><path d="M4 21V10.5l5-3.8 5 3.8V21"/><path d="M14 21V7l3.2-2.3L20.5 7v14"/><path class="d" d="M7 13.5h4M7 17h4M16.2 10.5h2M16.2 14h2M16.2 17.5h2"/>',
  com: '<path d="M4.5 11v9.5h15V11"/><path d="M3 10.2L5 4h14l2 6.2c0 1.3-1.3 2.1-3 2.1s-3-.8-3-2.1c0 1.3-1.3 2.1-3 2.1s-3-.8-3-2.1c0 1.3-1.3 2.1-3 2.1s-3-.8-3-2.1z"/><path d="M10 20.5V16h4v4.5"/>',
  ind: '<path d="M3 21V11.5l5 3v-3l5 3v-3l5 3V4h3v17z"/><path class="d" d="M6.5 18h2M11 18h2M15.5 18h2"/>',

  // ── Buildings ────────────────────────────────────────────────────────────
  solar: '<path d="M3.5 14l3-8h14l-3 8z"/><path class="d" d="M10.8 6L8.4 14M15.6 6l-2.4 8M5 10h14.3"/><path d="M11.5 14v6M8 20.5h7"/>',
  reactor:
    '<circle class="f" cx="12" cy="12" r="1.9"/><ellipse cx="12" cy="12" rx="9.2" ry="3.5"/><ellipse cx="12" cy="12" rx="9.2" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.2" ry="3.5" transform="rotate(120 12 12)"/>',
  plaza: '<path d="M12 21v-7.5"/><path d="M12 15.5l-2.8-2.3M12 17l2.8-2.3"/><path d="M12 2.8c3.3 0 6 2.4 6 5.4 0 2.6-2.2 4.7-4.8 4.7h-2.4C8.2 12.9 6 10.8 6 8.2c0-3 2.7-5.4 6-5.4z"/><path d="M7 21h10"/>',
  precinct:
    '<path d="M12 2.5l7 3v5c0 5-3 8.6-7 10.5-4-1.9-7-5.5-7-10.5v-5z"/><path d="M12 7.6l1.25 2.55 2.8.4-2.02 1.97.48 2.78L12 14l-2.5 1.3.48-2.78-2.03-1.97 2.8-.4z"/>',
  clinic: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
  datahub:
    '<path d="M12 11v10M8.5 21h7"/><circle cx="12" cy="9" r="1.8"/><path d="M8.4 5.4a5.1 5.1 0 0 0 0 7.2M15.6 5.4a5.1 5.1 0 0 1 0 7.2"/><path class="d" d="M5.5 2.6a9.2 9.2 0 0 0 0 12.8M18.5 2.6a9.2 9.2 0 0 1 0 12.8"/>',
  maglev: '<rect x="6" y="3" width="12" height="14" rx="3.2"/><path d="M6 11h12"/><path d="M9.5 7h5"/><circle class="f" cx="9" cy="14" r="1"/><circle class="f" cx="15" cy="14" r="1"/><path d="M8 21.5l2-4.5M16 21.5l-2-4.5"/>',
  spire: '<path d="M12 1.5l2.4 4.5v15h-4.8V6z"/><path d="M7.5 21V10.5l2.1-1.2M16.5 21V10.5l-2.1-1.2"/><path d="M4.5 21h15"/><path class="d" d="M12 9.5v2M12 14v2"/>',
  arcology: '<path d="M2.5 21L12 3.5 21.5 21z"/><path class="d" d="M7.2 12.4h9.6M4.9 16.7h14.2M12 3.5V21"/>',
  /** Academy: a mortarboard over a hall. */
  academy:
    '<path d="M12 3L2.5 7.6 12 12.2l9.5-4.6z"/><path d="M6.2 9.8v4.4c1.6 1.3 3.6 1.9 5.8 1.9s4.2-.6 5.8-1.9V9.8"/><path d="M21.5 7.6v5.2"/><circle class="f" cx="21.5" cy="13.8" r=".9"/><path class="d" d="M3.5 20.5h17"/>',
  /** Seaport: a gantry crane over a container ship on the water. */
  seaport:
    '<path d="M3 15.5h18l-2.4 4h-13.2z"/><path d="M6.5 15.5v-3h4v3M10.5 15.5v-3h4v3"/><path d="M17 12.5V3.5M17 4.5H8.5M10.5 4.5v4.5"/><path class="d" d="M2 22c1.6 0 1.6-.9 3.3-.9S6.9 22 8.6 22s1.6-.9 3.3-.9 1.6.9 3.3.9 1.6-.9 3.3-.9 1.6.9 3.3.9"/>',
  /** Airport: a jet from above over a runway line. */
  airport:
    '<path d="M12 2.5c.9 0 1.4.9 1.4 2v4.6l7.1 4.1v2l-7.1-2.2v4.3l2.2 1.6v1.6L12 19.6l-3.6.9v-1.6l2.2-1.6V13l-7.1 2.2v-2l7.1-4.1V4.5c0-1.1.5-2 1.4-2z"/><path class="d" d="M3 22h3M10.5 22h3M18 22h3"/>',
  /** Spaceport: a rocket beside its launch tower. */
  spaceport:
    '<path d="M13 2.5c2 1.7 3 4.2 3 7.2V16h-6V9.7c0-3 1-5.5 3-7.2z"/><path d="M10 12.5l-2.2 2.3v3.4L10 16.6M16 12.5l2.2 2.3v3.4L16 16.6"/><circle cx="13" cy="8.6" r="1.2"/><path class="d" d="M11.8 18.6l1.2 3 1.2-3M4 21.5V4.5M4 8h2.6M4 12h2.6M4 16h2.6"/>',

  // ── Overlays ─────────────────────────────────────────────────────────────
  eyeOff:
    '<path d="M3.5 3.5l17 17"/><path d="M10.6 6.1c.5-.1.9-.1 1.4-.1 5 0 8.5 4.5 9.5 6-.5.8-1.6 2.2-3.1 3.5M6.6 7.6C4.6 9 3.1 10.9 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  plug: '<path d="M9 2.5v4.5M15 2.5v4.5"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v4.5"/>',
  gem: '<path d="M6 3.5h12l3.5 5.5L12 20.5 2.5 9z"/><path class="d" d="M2.5 9h19M8.5 3.5L12 20.5l3.5-17"/>',
  siren:
    '<path d="M7 18.5V12a5 5 0 0 1 10 0v6.5"/><path d="M5 18.5h14v3H5z"/><path class="d" d="M12 2v2.2M4.3 5l1.5 1.5M19.7 5l-1.5 1.5M2 12h2.2M19.8 12H22"/>',
  smog: '<path d="M4.5 21v-7h4v7M2.5 21h19"/><path d="M6 10.5c-1.7 0-3-1.1-3-2.6s1.3-2.6 3-2.6c.4-1.6 1.9-2.8 3.7-2.8 1.7 0 3.1 1 3.6 2.4.4-.1.8-.2 1.2-.2 1.9 0 3.5 1.5 3.5 3.4s-1.6 2.4-3.5 2.4z"/>',
  car: '<path d="M5 16v-4.5L7.2 6h9.6l2.2 5.5V16z"/><path d="M5 11.5h14"/><path d="M5.5 16v3h3v-3M15.5 16v3h3v-3"/><circle class="f" cx="8.4" cy="13.8" r=".9"/><circle class="f" cx="15.6" cy="13.8" r=".9"/>',
  rings: '<circle class="f" cx="12" cy="12" r="2.2"/><circle cx="12" cy="12" r="5.6"/><circle class="d" cx="12" cy="12" r="9.2"/>',
  /** Wealth view: three rising blocks under a glint. */
  tiers: '<path d="M3.5 20.5v-5h4.5v5M9.8 20.5v-9h4.4v9M16 20.5V8h4.5v12.5"/><path class="d" d="M2 20.5h20"/><path d="M18.25 1.8l.75 1.7 1.7.75-1.7.75-.75 1.7-.75-1.7-1.7-.75 1.7-.75z"/>',
  /** Noise view: a source with spreading rings, louder to one side. */
  noise: '<circle class="f" cx="5.5" cy="12" r="2.2"/><path d="M9.5 8a5.6 5.6 0 0 1 0 8M13 5.2a9.6 9.6 0 0 1 0 13.6"/><path class="d" d="M16.6 2.6a13.2 13.2 0 0 1 0 18.8M20 4.8a16 16 0 0 1 0 14.4"/>',

  // ── HUD / chrome ─────────────────────────────────────────────────────────
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  pause: '<rect class="f" x="6.2" y="5" width="3.8" height="14" rx="1"/><rect class="f" x="14" y="5" width="3.8" height="14" rx="1"/>',
  play: '<path class="f" d="M8 5l11 7-11 7z"/>',
  fast: '<path class="f" d="M3.5 6l8 6-8 6zM12 6l8 6-8 6z"/>',
  faster: '<path class="f" d="M1.8 7l6.4 5-6.4 5zM8.8 7l6.4 5-6.4 5zM15.8 7l6.4 5-6.4 5z"/>',
  coin: `<path d="${HEX}"/><path d="M14.6 9.3a3 3 0 1 0 0 5.4M12 7v1.5M12 15.5V17"/>`,
  pop: '<circle cx="12" cy="7.5" r="3.6"/><path d="M4.8 21c0-4 3.2-7.1 7.2-7.1s7.2 3.1 7.2 7.1"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  undo: '<path d="M8.5 4L4 8.5 8.5 13"/><path d="M4.5 8.5h9.5a5.5 5.5 0 0 1 0 11H9"/>',
  warn: '<path d="M12 3.2l9.5 17.3h-19z"/><path d="M12 10v4.8M12 17.6v.1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  save: '<path d="M5 3.5h11l3 3v14H5z"/><path d="M8 3.5v5h7v-5M8 20.5V14h8v6.5"/>',
  load: '<path d="M12 3.5v11.5M7.5 10.5L12 15l4.5-4.5"/><path d="M4 16.5v4h16v-4"/>',
  newCity: `<path d="${HEX}"/><path d="M12 8v8M8 12h8"/>`,
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle class="d" cx="12" cy="12" r="6.6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17.4v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.1"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  music: '<path d="M9 18V5.5l11-2v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  rain: '<path d="M7 14a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 5.5a4.25 4.25 0 0 1 .5 8.5z"/><path class="d" d="M8 17l-1 3.5M12 17l-1 3.5M16 17l-1 3.5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/><path class="d" d="M17 3.5v3M15.5 5h3"/>',
  broadcast: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/><path class="d" d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  sparkle: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/><path class="d" d="M7 13.5h.1M12 9.5h.1M17 13.5h.1"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path class="d" d="M10 11v6M14 11v6"/>',
  news: '<path d="M4 5h13v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v10a2 2 0 0 1-2 2"/><path class="d" d="M7.5 9h6M7.5 12.5h6M7.5 16h4"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle class="f" cx="9" cy="9" r="1.2"/><circle class="f" cx="15" cy="15" r="1.2"/><circle class="f" cx="15" cy="9" r="1.2"/><circle class="f" cx="9" cy="15" r="1.2"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
  logo: `<path d="${HEX}"/><path d="M8 16.5v-5h2v5M11 16.5V7.5h2v9M14 16.5v-3h2v3"/>`,
  pinch: '<circle cx="8" cy="12" r="2.3"/><circle cx="16" cy="12" r="2.3"/><path d="M8 7.5V3M6.4 4.6L8 3l1.6 1.6M16 16.5V21M14.4 19.4L16 21l1.6-1.6"/>',
  drag: '<path d="M5 19L18 6"/><circle class="f" cx="5" cy="19" r="2"/><path d="M13 5.5h5.5V11"/>',
  chart: '<path d="M3.5 20.5h17"/><path d="M5 16l4.5-5 3.5 3 6-7.5"/><path class="d" d="M15.5 6.5H19V10"/>',
  bolt: '<path class="f" d="M13.2 2.5L5 13.6h6.2L10.3 21.5 19 10.2h-6.3z"/>',
  approval: '<circle cx="12" cy="12" r="9"/><path d="M8 14.2c1 1.4 2.4 2.1 4 2.1s3-.7 4-2.1"/><path d="M9 9.5h.1M15 9.5h.1"/>',

  // ── Story layer ──────────────────────────────────────────────────────────
  /** Sky group: two towers joined by a span. */
  sky: '<path d="M3 21V6.5h5V21M16 21V4h5v17"/><path d="M8 10h8M8 12.6h8"/><path class="d" d="M2 21h20M5.5 9v1M18.5 7v1M5.5 13v1M18.5 11v1"/>',
  /** Deals group: two hands meeting over a seal. */
  deals: '<path d="M2.5 12.5l4-4 3 1.5 2.5-1.5 2.5 1.5 3-1.5 4 4"/><path d="M6.5 8.5l5.5 6 5.5-6"/><path d="M9 12.2l2 2M12 15l1.6-1.6"/><circle class="d" cx="12" cy="19.5" r="1.6"/>',
  stack: '<path d="M3.5 21V15h17v6"/><path d="M6 15V8.5h12V15"/><path d="M8.5 8.5V3.5h7v5"/><path class="d" d="M2 21h20M8 18h2M14 18h2M9 11.5h1.5M13.5 11.5H15M11 6h2"/>',
  skybridge: '<path d="M3 21V5h4v16M17 21V5h4v16"/><path d="M7 9.5h10v3H7z"/><path class="d" d="M9.5 11h1M13.5 11h1M2 21h20"/>',
  rail: '<path d="M2.5 9.5h19v2.5h-19z"/><path d="M6 12v9M18 12v9"/><path class="d" d="M4.5 21h3M16.5 21h3"/><path d="M7 6.5h6l1.5 3h-9z"/>',
  foundry: '<path d="M9 21V6.5l3-3 3 3V21"/><path d="M5 21v-7h4M15 14h4v7"/><path class="d" d="M10.5 9.5h3M10.5 13h3M10.5 16.5h3"/><path d="M3 21h18"/>',
  glarewall: '<path d="M10 21V3h4v18"/><path d="M14 5l6-1.5v9L14 11"/><path class="d" d="M15.5 6.4l3-.6M15.5 9l3 .2"/><path d="M7 21h10"/>',
  tidemarket: '<path d="M3 11l3-5h12l3 5"/><path d="M3 11h18"/><path d="M5 11v9h14v-9"/><path class="d" d="M2 18c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4 2-1.4 4-1.4"/><path d="M10 20v-5h4v5"/>',
  roost: '<path d="M12 21V9"/><path d="M12 2.5l4 4-4 4-4-4z"/><path class="d" d="M12 10.5c-1 2.5 1.5 4 0 6.5"/><path d="M8 21h8M9.5 14l2.5-1.5 2.5 1.5"/>',
  commons: '<path d="M3 9.5L12 4l9 5.5"/><path d="M4.5 9.5h15"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/><path d="M3 20.5h18"/>',
  memorial: '<path d="M9.5 20V5l2.5-2 2.5 2v15"/><path class="d" d="M11 8h2M11 10.5h2M11 13h2M11 15.5h2"/><path d="M4 20.5h16"/><path class="d" d="M6.5 18.5c0-1 .6-1.6 1.2-1.6M16.3 16.9c.6 0 1.2.6 1.2 1.6"/>',
  turf: '<path d="M3 3h8v8H3z"/><path class="d" d="M3 7l4-4M3 11l8-8M7 11l4-4"/><path d="M13 13h8v8h-8z"/><circle class="f" cx="15.5" cy="15.5" r=".9"/><circle class="f" cx="18.5" cy="15.5" r=".9"/><circle class="f" cx="15.5" cy="18.5" r=".9"/><circle class="f" cx="18.5" cy="18.5" r=".9"/><path class="d" d="M13 3h8v8M3 13v8h8"/>',
  comms: '<path d="M3 6h18v12H3z"/><path d="M3 6.5l9 6.5 9-6.5"/><path class="d" d="M3 18l6.5-6M21 18l-6.5-6"/>',
  eye: '<path d="M2.5 12c1.8-3.6 5.3-6 9.5-6s7.7 2.4 9.5 6c-1.8 3.6-5.3 6-9.5 6s-7.7-2.4-9.5-6z"/><circle cx="12" cy="12" r="2.8"/><circle class="f" cx="12" cy="12" r="1"/>',
  key: '<circle cx="7.5" cy="12" r="3.8"/><path d="M11.3 12H21M17.5 12v3.5M20.5 12v2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2.1"/>',
  flag: '<path d="M5 21V3.5"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  goal: '<circle cx="12" cy="12" r="8.5"/><circle class="d" cx="12" cy="12" r="5"/><circle class="f" cx="12" cy="12" r="1.6"/>',
  shield: '<path d="M12 3l7.5 3v5.6c0 4.6-3.2 8.1-7.5 9.4-4.3-1.3-7.5-4.8-7.5-9.4V6z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/>',
  hand: '<path d="M7 13V6.5a1.5 1.5 0 0 1 3 0V12M10 11V4.5a1.5 1.5 0 0 1 3 0V11M13 11V5.5a1.5 1.5 0 0 1 3 0V12M16 12V8.5a1.5 1.5 0 0 1 3 0V14c0 4-2.6 7-6.5 7-2.6 0-4.2-1.2-5.6-3.3L4.3 13.6a1.5 1.5 0 0 1 2.5-1.6L7 12.4"/>',
  salt: '<path d="M8.5 9h7l1.5 11.5h-10z"/><path d="M9.5 9V6.5a2.5 2.5 0 0 1 5 0V9"/><path class="d" d="M11 4h.1M13.4 3.6h.1M12.2 2.6h.1"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** SVG markup for an icon. `cls` adds classes on the <svg>. */
export function icon(name: IconName, cls = ''): string {
  return `<svg class="cc-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
