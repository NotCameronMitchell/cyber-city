// Story content lint (docs/STORY.md §13). Fails the build on any copy, id,
// reference or vocabulary problem in src/game/story/content/*. Each check
// collects every offender, so one run lists them all. The Megacity section
// (docs/MEGACITY.md §8, §3.7) adds the eleven district and landmark cards, the
// lobby lines, the neighbourhood naming lint and the §8.6 spoiler guard.

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_ORDER, CROWNS, DISTRICTS, FACTION_IDS, FACTION_LABELS, MILESTONES, POWER_WEIGHTS, UNLOCK_FALLBACK_POP } from '../../src/game/config';
import { RENAMED_NEIGHBOURHOODS, VARIANT_NEIGHBOURHOODS, neighbourhoodsOf } from '../../src/game/districts/names';
import { DISTRICTS as START_NEIGHBOURHOODS } from '../../src/game/news';
import { MARK_NAMES } from '../../src/game/story/content/epilogue';
import { Rng } from '../../src/game/rng';
import { EMPTY_CONTENT, metric, useStoryContent, type StoryContent } from '../../src/game/story/conditions';
import * as C from '../../src/game/story/content';
import {
  BUILDING_TYPE_SET,
  EFFECT_KINDS,
  FACTION_REFS,
  METRICS,
  SPOT_RULES,
  TARGETS,
  UNLOCKABLES,
} from '../../src/game/story/content/vocab';
import { DISTRICT_VERBS, districtVerb, findSpot, spotAvailable } from '../../src/game/story/effects';
import { powerWeight } from '../../src/game/story/factions';
import { lobbyName } from '../../src/game/story/vertical';
import { DEFAULT_MODS } from '../../src/game/story/mods';
import type { Card, Condition, Effect, FactionId, FlagValue, ModPatch, SpotRule } from '../../src/game/story/types';
import { RoadKind, Terrain, ZoneType, type BuildingType, type DistrictKind, type DistrictVariant } from '../../src/game/types';
import type { World } from '../../src/game/world';
import { flatWorld } from '../helpers';

/**
 * Which way is good for the player, per modifier key (+1 higher is better, −1 lower is
 * better). A `perm` modifier may only hold keys listed here, each moved the good way:
 * every penalty is timed (STORY.md §2.3 rule 3). `taxCap`, `cardRateMul` and
 * `favorMonthly` are never permanent.
 */
const BONUS_DIR: Partial<Record<keyof ModPatch, 1 | -1>> = {
  demandRes: 1,
  demandCom: 1,
  demandInd: 1,
  landValueAdd: 1,
  approvalAdd: 1,
  crimeAdd: -1,
  traceMonthly: -1,
  outageChance: -1,
  crimeMul: -1,
  turfCrimeMul: -1,
  pollutionMul: -1,
  trafficMul: -1,
  securityMul: 1,
  taxIncomeMul: 1,
  taxDemandMul: -1,
  upkeepMul: -1,
  buildCostMul: -1,
  powerSupplyMul: 1,
  powerDemandMul: -1,
  growthMul: 1,
  abandonMul: -1,
  eventRateMul: -1,
  turfSpreadMul: -1,
  costMul: -1,
  upkeepMulType: -1,
};

/** Keys of a patch that would hurt the player if they lasted for good. */
function penaltyKeys(p: ModPatch): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(p) as [keyof ModPatch, unknown][]) {
    const dir = BONUS_DIR[k];
    if (!dir) {
      out.push(k);
      continue;
    }
    const mul = k.endsWith('Mul') || k === 'costMul' || k === 'upkeepMulType';
    const vals = typeof v === 'object' && v !== null ? Object.values(v as Record<string, number>) : [v as number];
    for (const x of vals) {
      const delta = mul ? x - 1 : x;
      if (delta * dir < 0) {
        out.push(k);
        break;
      }
    }
  }
  return out;
}

const { CARD_TOKEN_MAX, COPY_LIMITS, LINE_TOKEN_MAX, NOTE_TOKEN_MAX, worstCase, tokensIn } = C;

// ── Gather everything ───────────────────────────────────────────────────────

const CARDS = C.CARD_LIST;
const CARD_BY_ID = new Map<string, Card>(CARDS.map((c) => [c.id, c]));

interface FxSite {
  where: string;
  card?: Card;
  fx: readonly Effect[];
}
interface CondSite {
  where: string;
  c: Condition;
}

/** Every effect list in the content, with where it lives. */
function effectSites(): FxSite[] {
  const out: FxSite[] = [];
  for (const card of CARDS) {
    if (card.onShow) out.push({ where: `${card.id} onShow`, card, fx: card.onShow });
    card.choices.forEach((ch, i) => out.push({ where: `${card.id} choice ${i} "${ch.label}"`, card, fx: ch.fx }));
  }
  for (const f of C.FACTION_LIST) {
    if (f.deal) out.push({ where: `${f.id} deal`, fx: f.deal.fx });
    if (f.hostile.pulse) out.push({ where: `${f.id} pulse`, fx: f.hostile.pulse });
  }
  for (const ch of C.CHAPTERS) {
    if (ch.onStart) out.push({ where: `chapter ${ch.n} onStart`, fx: ch.onStart });
    out.push({ where: `chapter ${ch.n} reward`, fx: ch.reward });
  }
  return out;
}

/** Visit every effect (recursing into `if`). */
function eachEffect(visit: (e: Effect, site: FxSite, inIf: boolean) => void): void {
  const walk = (fx: readonly Effect[], site: FxSite, inIf: boolean) => {
    for (const e of fx) {
      visit(e, site, inIf);
      if (e.t === 'if') {
        walk(e.then, site, true);
        if (e.else) walk(e.else, site, true);
      }
    }
  };
  for (const site of effectSites()) walk(site.fx, site, false);
}

/** Every top-level condition in the content. */
function conditionSites(): CondSite[] {
  const out: CondSite[] = [];
  for (const card of CARDS) {
    if (card.when) out.push({ where: `${card.id} when`, c: card.when });
    card.choices.forEach((ch, i) => ch.requires && out.push({ where: `${card.id} choice ${i} requires`, c: ch.requires }));
  }
  eachEffect((e, site) => e.t === 'if' && out.push({ where: `${site.where} if`, c: e.c }));
  for (const f of C.FACTION_LIST) {
    out.push({ where: `${f.id} visible`, c: f.visible });
    if (f.teaser) out.push({ where: `${f.id} teaser`, c: f.teaser });
    for (const d of f.mood) if ('when' in d) out.push({ where: `${f.id} mood "${d.label}"`, c: d.when });
  }
  for (const ch of C.CHAPTERS) {
    out.push({ where: `chapter ${ch.n} trigger`, c: ch.trigger }, { where: `chapter ${ch.n} fallback`, c: ch.fallback });
    for (const b of ch.beats) if (typeof b.after === 'object' && 'cond' in b.after) out.push({ where: `beat ${b.card}`, c: b.after.cond });
    for (const g of ch.goals) out.push({ where: `goal ${g.id}`, c: g.cond });
  }
  for (const e of C.ENDING_LIST) {
    e.claims.forEach((cl) => out.push({ where: `ending ${e.id} claim "${cl.label}"`, c: cl.cond }));
    if (e.rules.variant) out.push({ where: `ending ${e.id} variant`, c: e.rules.variant.when });
  }
  C.MOTH_NOTES.forEach((n, i) => n.when && out.push({ where: `note ${i}`, c: n.when }));
  return out;
}

/** Visit every condition node. */
function eachCondNode(visit: (c: Condition, where: string) => void): void {
  const walk = (c: Condition, where: string) => {
    visit(c, where);
    if ('all' in c) c.all.forEach((k) => walk(k, where));
    else if ('any' in c) c.any.forEach((k) => walk(k, where));
    else if ('not' in c) walk(c.not, where);
    else if ('hold' in c) walk(c.hold, where);
  };
  for (const s of conditionSites()) walk(s.c, s.where);
}

/** Every string inside a value (deep), with a path. */
function eachString(v: unknown, path: string, visit: (s: string, path: string) => void): void {
  if (typeof v === 'string') visit(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => eachString(x, `${path}[${i}]`, visit));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) eachString(x, `${path}.${k}`, visit);
}

/** Every content export that holds game text, except cards and whispers (checked on their own). */
const OTHER_TEXT: Record<string, unknown> = {
  FACTIONS: C.FACTIONS,
  CHAPTERS: C.CHAPTERS,
  EPILOGUE: C.EPILOGUE,
  GLOSSARY: C.GLOSSARY,
  ENDINGS: C.ENDINGS,
  CHARTER_NIGHT_TEXT: C.CHARTER_NIGHT_TEXT,
  CHARTER_CONFIRM: C.CHARTER_CONFIRM,
  SILT_LOGS: C.SILT_LOGS,
  MOTH_NOTES: C.MOTH_NOTES,
  SYSTEM_LINES: C.SYSTEM_LINES,
  UNLOCK_NEWS: C.UNLOCK_NEWS,
  UNLOCK_SOURCES: C.UNLOCK_SOURCES,
  LEXICON: C.LEXICON,
  VOICE: C.VOICE,
  CALLS_YOU: C.CALLS_YOU,
  TIER_TEXT: C.TIER_TEXT,
  LEADER_TITLES: C.LEADER_TITLES,
  TUNING_TEASER: C.TUNING_TEASER,
  NO_SALT_REASON: C.NO_SALT_REASON,
  WAIVED_TEXT: C.WAIVED_TEXT,
};

/** Text fields a player reads on a card. */
function cardTexts(c: Card): { field: string; text: string }[] {
  const out = [
    { field: 'title', text: c.title },
    { field: 'body', text: c.body },
  ];
  if (c.name) out.push({ field: 'name', text: c.name });
  if (c.sys) out.push({ field: 'sys', text: c.sys });
  if (c.brief) out.push({ field: 'brief', text: c.brief });
  c.choices.forEach((ch, i) => {
    out.push({ field: `label ${i}`, text: ch.label });
    if (ch.lockedHint) out.push({ field: `lockedHint ${i}`, text: ch.lockedHint });
  });
  return out;
}

/** Flags any effect can set, with the values they can take (`true` for a bare flag). */
function flagsSet(): Map<string, Set<FlagValue>> {
  const out = new Map<string, Set<FlagValue>>();
  const add = (k: string, v: FlagValue) => (out.get(k) ?? out.set(k, new Set()).get(k)!).add(v);
  eachEffect((e) => {
    if (e.t !== 'flag') return;
    if (e.v === '$patron') {
      add(e.key, 'basalt');
      add(e.key, 'nacre');
    } else if (e.v === '+1') add(e.key, 1);
    else add(e.key, e.v);
  });
  // Set by the director: `revealed` mirrors story.revealed, `tuningActive` also at Trace ≥ 40,
  // `migrated` on a v1 save.
  add('revealed', true);
  add('tuningActive', true);
  add('migrated', true);
  // Set by Game.annex when it annexes Tarmac Reach itself, the only Tarmac district with apron families (ds.tarmac).
  add('apronFamilies', true);
  return out;
}

// ── Checks ──────────────────────────────────────────────────────────────────

describe('story content lint (§13)', () => {
  it('copy fits its limits after worst-case token fill', () => {
    const bad: string[] = [];
    const limit: Record<string, number> = {
      title: COPY_LIMITS.title,
      body: COPY_LIMITS.body,
      sys: COPY_LIMITS.sys,
      name: COPY_LIMITS.title,
      brief: COPY_LIMITS.brief,
    };
    for (const c of CARDS) {
      for (const { field, text } of cardTexts(c)) {
        const max = field.startsWith('label') ? COPY_LIMITS.label : field.startsWith('lockedHint') ? COPY_LIMITS.lockedHint : limit[field];
        const len = worstCase(text, CARD_TOKEN_MAX).length;
        if (len > max) bad.push(`${c.id} ${field}: ${len} > ${max}`);
      }
      if (c.kind === 'whisper' && c.body.length > COPY_LIMITS.ticker) bad.push(`${c.id} whisper body > ${COPY_LIMITS.ticker}`);
    }
    for (const ch of C.CHAPTERS) {
      if (worstCase(ch.rewardSys, CARD_TOKEN_MAX).length > COPY_LIMITS.rewardSys) bad.push(`chapter ${ch.n} rewardSys`);
      if (ch.title.length > COPY_LIMITS.title) bad.push(`chapter ${ch.n} title`);
      if (ch.question.length > COPY_LIMITS.sys) bad.push(`chapter ${ch.n} question`);
      for (const g of ch.goals) if (g.label.length > COPY_LIMITS.label) bad.push(`goal ${g.id} label`);
    }
    for (const e of C.ENDING_LIST) for (const cl of e.claims) if (cl.label.length > COPY_LIMITS.label) bad.push(`${e.id} claim ${cl.label}`);
    for (const f of C.FACTION_LIST) if (f.deal && f.deal.blurb.length > COPY_LIMITS.dealBlurb) bad.push(`${f.id} deal blurb`);
    for (const [f, lines] of Object.entries(C.WHISPERS))
      for (const [mood, line] of Object.entries(lines)) if (line.length > COPY_LIMITS.ticker) bad.push(`whisper ${f}.${mood}`);
    for (const n of C.MOTH_NOTES) {
      if (worstCase(n.text, NOTE_TOKEN_MAX).length > COPY_LIMITS.note) bad.push(`note "${n.text}"`);
      if (!n.text.startsWith('> ')) bad.push(`note "${n.text}" must start with '> '`);
    }
    for (const [id, l] of Object.entries(C.SYSTEM_LINES))
      if (worstCase(l.text, LINE_TOKEN_MAX).length > COPY_LIMITS.ticker) bad.push(`system line ${id}`);
    for (const [u, line] of Object.entries(C.UNLOCK_NEWS)) if ((line ?? '').length > COPY_LIMITS.ticker) bad.push(`unlock news ${u}`);
    expect(bad).toEqual([]);
  });

  it('token worst cases cover the real values', () => {
    // Megacity types Step 0b added hidden never reach a line until their package shows them (WP-7 raises the token max then).
    const longestBuilding = Math.max(...Object.values(BUILDINGS).filter((b) => !b.hidden).map((b) => b.name.length));
    const longestFaction = Math.max(...Object.values(FACTION_LABELS).map((f) => f.name.length));
    const longestCorp = Math.max(FACTION_LABELS.basalt.name.length, FACTION_LABELS.nacre.name.length);
    expect(LINE_TOKEN_MAX.building).toBeGreaterThanOrEqual(longestBuilding);
    expect(LINE_TOKEN_MAX.plant).toBeGreaterThanOrEqual(longestBuilding);
    expect(LINE_TOKEN_MAX.faction).toBeGreaterThanOrEqual(longestFaction);
    expect(CARD_TOKEN_MAX.patron).toBeGreaterThanOrEqual(longestCorp);
    expect(CARD_TOKEN_MAX.rival).toBeGreaterThanOrEqual(longestCorp);
  });

  it('uses only known tokens, and {district} only on cards with a spot', () => {
    const bad: string[] = [];
    const known = (t: string, max: Record<string, number>) => t in max;
    for (const c of CARDS) {
      for (const { field, text } of cardTexts(c)) {
        for (const t of tokensIn(text)) {
          if (!known(t, CARD_TOKEN_MAX)) bad.push(`${c.id} ${field}: {${t}}`);
          if (t === 'district' && !c.spot && c.kind !== 'beat') bad.push(`${c.id}: {district} without a spot rule`);
        }
      }
    }
    for (const ch of C.CHAPTERS) for (const t of tokensIn(ch.rewardSys)) if (!known(t, CARD_TOKEN_MAX)) bad.push(`chapter ${ch.n}: {${t}}`);
    for (const n of C.MOTH_NOTES) for (const t of tokensIn(n.text)) if (!known(t, NOTE_TOKEN_MAX)) bad.push(`note: {${t}}`);
    for (const [id, l] of Object.entries(C.SYSTEM_LINES)) for (const t of tokensIn(l.text)) if (!known(t, LINE_TOKEN_MAX)) bad.push(`${id}: {${t}}`);
    for (const [f, lines] of Object.entries(C.WHISPERS)) for (const line of Object.values(lines)) if (tokensIn(line).length) bad.push(`whisper ${f}`);
    expect(bad).toEqual([]);
  });

  it('has no duplicate ids', () => {
    const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes(CARDS.map((c) => c.id))).toEqual([]);
    expect(dupes(C.CHAPTERS.flatMap((ch) => ch.goals.map((g) => g.id)))).toEqual([]);
    expect(dupes(C.FACTION_LIST.flatMap((f) => (f.deal ? [f.deal.id] : [])))).toEqual([]);
    expect(C.CHAPTERS.map((ch) => ch.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Object.entries(C.ENDINGS).every(([k, e]) => k === e.id)).toBe(true);
    expect(Object.entries(C.FACTIONS).every(([k, f]) => k === f.id)).toBe(true);
    // Effect ids (story.mods / incomes / locals keys) are set and unique.
    const fxIds: string[] = [];
    const missing: string[] = [];
    eachEffect((e, site) => {
      if (e.t === 'mod' || e.t === 'income' || e.t === 'local') {
        if (!e.id) missing.push(site.where);
        else fxIds.push(e.id);
        if ((e.t === 'mod' || e.t === 'income') && !e.label) missing.push(`${site.where} label`);
      }
    });
    expect(missing).toEqual([]);
    expect(dupes(fxIds)).toEqual([]);
  });

  it('has no dangling references', () => {
    const bad: string[] = [];
    const optionalBeats = new Set(C.CHAPTERS.flatMap((ch) => ch.beats.filter((b) => b.optional).map((b) => b.card)));
    eachEffect((e, site) => {
      if (e.t === 'queue') {
        const q = CARD_BY_ID.get(e.card);
        if (!q) bad.push(`${site.where}: queue ${e.card} (missing card)`);
        else if (e.card.startsWith('wh.') && q.kind !== 'whisper') bad.push(`${site.where}: queue ${e.card} is not a whisper card`);
        else if (q.kind === 'beat' ? !optionalBeats.has(q.id) : !q.queuedOnly)
          bad.push(`${site.where}: queue ${e.card} must be an optional beat or a queued-only card`);
        if (e.days < 0) bad.push(`${site.where}: queue ${e.card} negative delay`);
      }
      if (e.t === 'log' && !CARD_BY_ID.has(C.logCardId(e.n))) bad.push(`${site.where}: Log ${e.n} has no log card`);
    });
    const beatUse = new Map<string, number>();
    for (const ch of C.CHAPTERS) {
      for (const b of ch.beats) {
        const c = CARD_BY_ID.get(b.card);
        if (!c) bad.push(`chapter ${ch.n}: beat ${b.card} missing`);
        else if (c.kind !== 'beat') bad.push(`chapter ${ch.n}: ${b.card} is not a beat card`);
        beatUse.set(b.card, (beatUse.get(b.card) ?? 0) + 1);
      }
      if (!CARD_BY_ID.has(C.logCardId(ch.log))) bad.push(`chapter ${ch.n}: log card ${ch.log} missing`);
    }
    for (const c of CARDS) if (c.kind === 'beat' && beatUse.get(c.id) !== 1) bad.push(`beat ${c.id} used ${beatUse.get(c.id) ?? 0} times`);
    for (const f of C.FACTION_LIST) {
      const h = CARD_BY_ID.get(f.hostile.card);
      if (!h || h.kind !== 'hostile' || h.speaker !== f.id) bad.push(`${f.id}: hostile card ${f.hostile.card}`);
      if (f.exclusive && !BUILDING_TYPE_SET.has(f.exclusive)) bad.push(`${f.id}: exclusive ${f.exclusive}`);
    }
    for (const e of C.ENDING_LIST) {
      if (CARD_BY_ID.get(e.card)?.kind !== 'ending') bad.push(`ending ${e.id}: card ${e.card}`);
      const v = e.rules.variant;
      if (v && CARD_BY_ID.get(v.card)?.kind !== 'ending') bad.push(`ending ${e.id}: variant card ${v.card}`);
    }
    for (const id of C.KEY_CHOICE_CARDS) if (CARD_BY_ID.get(id)?.kind !== 'beat') bad.push(`key choice ${id}`);
    expect(bad).toEqual([]);
  });

  it('gives every faction card exactly one default, and no card more than one', () => {
    const bad: string[] = [];
    for (const c of CARDS) {
      const n = c.choices.filter((ch) => ch.default).length;
      if ((c.kind === 'faction' || c.kind === 'hostile') && n !== 1) bad.push(`${c.id}: ${n} defaults`);
      if (n > 1) bad.push(`${c.id}: ${n} defaults`);
      if (n === 1 && c.choices.find((ch) => ch.default)?.requires) bad.push(`${c.id}: the default must not be locked`);
    }
    expect(bad).toEqual([]);
  });

  it('gives every ⚑ card a make-good choice of at least +15 favor for its faction', () => {
    const bad: string[] = [];
    const covers = (ref: string, f: FactionId) =>
      ref === f || (ref === 'gangs' && (f === 'undertow' || f === 'kites')) || (ref === 'corps' && (f === 'basalt' || f === 'nacre'));
    for (const c of CARDS.filter((x) => x.kind === 'hostile')) {
      const f = c.speaker as FactionId;
      const ok = c.choices.some((ch) => !ch.requires && ch.fx.some((e) => e.t === 'favor' && covers(e.f, f) && e.v >= 15));
      if (!ok) bad.push(c.id);
      // ⚑ cards fire on Hostile standing.
      const w = c.when;
      if (!w || !('m' in w) || w.m !== `standing.${f}` || w.op !== '<=' || w.v !== -60) bad.push(`${c.id}: when must be standing.${f} <= -60`);
    }
    expect(bad).toEqual([]);
  });

  it('keeps choice counts in range', () => {
    const bad: string[] = [];
    for (const c of CARDS) {
      const n = c.choices.length;
      if (n > 4) bad.push(`${c.id}: ${n} choices`);
      const none = c.kind === 'whisper' || c.kind === 'log' || c.kind === 'ending';
      if (none && n !== 0) bad.push(`${c.id}: ${c.kind} cards take no choices`);
      if (!none && n < 1) bad.push(`${c.id}: needs a choice`);
    }
    expect(bad).toEqual([]);
  });

  it('owns Silt Logs correctly: 1–6 by chapters, 7–12 by exactly one ★ card each', () => {
    expect(C.CHAPTERS.map((ch) => ch.log)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(C.SILT_LOGS.map((l) => l.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const bad: string[] = [];
    for (let n = 7; n <= 12; n++) {
      const stars = CARDS.filter((c) => c.star === n);
      if (stars.length !== 1) {
        bad.push(`Log ${n}: ${stars.length} ★ cards`);
        continue;
      }
      const s = stars[0];
      const from = C.SILT_LOGS[n - 1].from;
      if (s.kind !== 'faction' || !('faction' in from) || from.faction !== s.speaker || from.card !== s.id) bad.push(`Log ${n}: ★ ${s.id} mismatch`);
      if (!s.choices.some((ch) => ch.fx.some((e) => e.t === 'log' && e.n === n))) bad.push(`Log ${n}: ★ ${s.id} never grants it`);
      if (!s.choices.some((ch) => !ch.fx.some((e) => e.t === 'log'))) bad.push(`Log ${n}: ★ ${s.id} has no decline`);
    }
    for (const c of CARDS) if (c.star !== undefined && (c.star < 7 || c.star > 12)) bad.push(`${c.id}: star ${c.star}`);
    eachEffect((e, site) => {
      if (e.t !== 'log') return;
      if (e.n < 7 || e.n > 12) bad.push(`${site.where}: Log ${e.n} is a chapter log`);
      else if (site.card?.star !== e.n) bad.push(`${site.where}: Log ${e.n} outside its ★ card`);
    });
    expect(bad).toEqual([]);
  });

  it('only references flags that something sets', () => {
    const known = flagsSet();
    const bad: string[] = [];
    eachCondNode((c, where) => {
      if (!('flag' in c)) return;
      const vals = known.get(c.flag);
      if (!vals) bad.push(`${where}: unknown flag ${c.flag}`);
      else if (c.eq !== undefined && !vals.has(c.eq)) bad.push(`${where}: flag ${c.flag}=${String(c.eq)} is never set`);
    });
    // Power-share flag terms too.
    for (const terms of Object.values(C.POWER_TERMS))
      for (const t of terms) {
        const key = 'flag' in t ? t.flag : 'flagCount' in t ? t.flagCount : null;
        if (key && !known.has(key)) bad.push(`power term: unknown flag ${key}`);
        if ('flag' in t && t.eq !== undefined && !known.get(t.flag)?.has(t.eq)) bad.push(`power term: ${t.flag}=${String(t.eq)}`);
      }
    expect(bad).toEqual([]);
  });

  it('contains no banned terms (§1.4)', () => {
    const bad: string[] = [];
    const check = (s: string, path: string) => {
      const hit = C.BANNED_RE.exec(s);
      if (hit) bad.push(`${path}: "${hit[0]}"`);
    };
    for (const c of CARDS) eachString(c, `card ${c.id}`, check);
    eachString(C.WHISPERS, 'WHISPERS', check);
    for (const [k, v] of Object.entries(OTHER_TEXT)) eachString(v, k, check);
    expect(bad).toEqual([]);
    // The regex itself works.
    expect(C.BANNED_RE.test('a Netrunner jacks the grid')).toBe(true);
    expect(C.BANNED_RE.test('JACK  IN')).toBe(true);
    expect(C.BANNED_RE.test('police construction ahead')).toBe(false);
  });

  it("keeps '!' to Nacre's lines", () => {
    const bad: string[] = [];
    for (const c of CARDS) {
      if (c.speaker === 'nacre') continue;
      for (const { field, text } of cardTexts(c)) if (text.includes('!')) bad.push(`${c.id} ${field}`);
    }
    for (const [f, lines] of Object.entries(C.WHISPERS)) {
      if (f === 'nacre') continue;
      for (const [mood, line] of Object.entries(lines)) if (line.includes('!')) bad.push(`whisper ${f}.${mood}`);
    }
    for (const [k, v] of Object.entries(OTHER_TEXT)) eachString(v, k, (s, p) => s.includes('!') && bad.push(p));
    expect(bad).toEqual([]);
  });

  it('ends every choice label in a period (a closing quote may follow)', () => {
    const bad: string[] = [];
    for (const c of CARDS) for (const ch of c.choices) if (!/\.['"’”]?$/.test(ch.label)) bad.push(`${c.id}: "${ch.label}"`);
    for (const c of CARDS) for (const ch of c.choices) if (ch.requires && !ch.lockedHint) bad.push(`${c.id}: "${ch.label}" needs a lockedHint`);
    expect(bad).toEqual([]);
  });

  it('uses only the closed effect vocabulary, with resolvable targets', () => {
    const bad: string[] = [];
    const modKeys = new Set(Object.keys(DEFAULT_MODS));
    const checkPatch = (p: ModPatch, where: string) => {
      for (const [k, v] of Object.entries(p)) {
        if (!modKeys.has(k)) bad.push(`${where}: mod key ${k}`);
        else if (k === 'costMul' || k === 'upkeepMulType') {
          for (const t of Object.keys(v as object)) if (!BUILDING_TYPE_SET.has(t)) bad.push(`${where}: ${k}.${t}`);
        } else if (k === 'favorMonthly') {
          for (const f of Object.keys(v as object)) if (!(FACTION_IDS as readonly string[]).includes(f)) bad.push(`${where}: favorMonthly.${f}`);
        } else if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(`${where}: ${k} = ${String(v)}`);
      }
    };
    eachEffect((e, site, inIf) => {
      const w = site.where;
      if (!EFFECT_KINDS.has(e.t)) bad.push(`${w}: effect ${e.t}`);
      // A bare strongestTurf target only means something inside a turf effect (§10.1).
      if ('at' in e && e.at !== undefined) {
        if (!TARGETS.has(e.at)) bad.push(`${w}: target ${e.at}`);
        if (e.at === 'strongestTurf' && e.t !== 'turf') bad.push(`${w}: bare strongestTurf outside a turf effect`);
        if (e.at === 'spot' && !site.card?.spot) bad.push(`${w}: target spot on a card with no spot rule`);
      }
      switch (e.t) {
        case 'favor':
          if (!FACTION_REFS.has(e.f)) bad.push(`${w}: favor ${e.f}`);
          break;
        case 'floor':
        case 'ceil':
          if (!(FACTION_IDS as readonly string[]).includes(e.f)) bad.push(`${w}: ${e.t} ${e.f}`);
          break;
        case 'mod':
          checkPatch(e.mods, w);
          // Every penalty is timed (§2.3 rule 3). A permanent modifier is a pure bonus, and only
          // on a `once` card: a lasting choice about one physical decision (EXPANSION §8.3).
          if (e.days === 'perm') {
            if (!site.card?.once || inIf) bad.push(`${w}: perm mod ${e.id} outside a once card's choice`);
            const pen = penaltyKeys(e.mods);
            if (pen.length) bad.push(`${w}: perm mod ${e.id} holds a penalty (${pen.join(', ')}) and must be timed`);
          } else if (e.days <= 0) bad.push(`${w}: mod ${e.id} must be timed`);
          break;
        case 'income':
          if (e.months <= 0) bad.push(`${w}: income months`);
          break;
        case 'local':
          if (e.days <= 0 || e.r <= 0 || (e.crimeAdd === undefined && e.lvAdd === undefined)) bad.push(`${w}: local ${e.id}`);
          break;
        case 'turf':
          if ((e.op === 'seed' || e.op === 'str') && e.v === undefined) bad.push(`${w}: turf ${e.op} needs v`);
          if (e.op === 'freeze' && !e.days) bad.push(`${w}: turf freeze needs days`);
          if (e.op === 'flip' && (!e.to || e.gang === 'all' || e.to === e.gang)) bad.push(`${w}: turf flip`);
          if (e.op === 'seed' && e.gang === 'all') bad.push(`${w}: turf seed needs one gang`);
          // A `slot:<kind>` target is a whole district, so it takes no radius (MEGACITY §8.4).
          if ((e.op === 'clear' || e.op === 'flip') && e.at !== 'city' && !e.at.startsWith('slot:') && !e.r) bad.push(`${w}: turf ${e.op} needs r`);
          break;
        case 'offline':
          // No effect deletes a building; offline lasts at most 30 d (§2.3 rule 4).
          if (e.days > 30 || e.days <= 0) bad.push(`${w}: offline ${e.days}d`);
          if (Array.isArray(e.what)) for (const t of e.what) if (!BUILDING_TYPE_SET.has(t)) bad.push(`${w}: offline ${t}`);
          if (e.what === 'district' && (!e.at || !e.r)) bad.push(`${w}: offline district needs at and r`);
          if (e.what === 'nearTurf' && !e.gang) bad.push(`${w}: offline nearTurf needs gang`);
          break;
        case 'abandon':
          if (e.n <= 0 || e.r <= 0) bad.push(`${w}: abandon`);
          break;
        case 'unlock':
          if (!UNLOCKABLES.has(e.what)) bad.push(`${w}: unlock ${e.what}`);
          break;
        case 'credit':
          if (e.what !== 'patronExclusive' && !BUILDING_TYPE_SET.has(e.what)) bad.push(`${w}: credit ${e.what}`);
          if (e.n < 1 || e.mul < 0) bad.push(`${w}: credit amounts`);
          break;
        case 'flag':
          if (!e.key) bad.push(`${w}: empty flag key`);
          break;
        case 'pact':
          if (e.months <= 0) bad.push(`${w}: pact months`);
          break;
      }
    });
    for (const f of C.FACTION_LIST) {
      checkPatch(f.perk, `${f.id} perk`);
      checkPatch(f.cold, `${f.id} cold`);
      checkPatch(f.hostile.mods, `${f.id} hostile`);
    }
    for (const e of C.ENDING_LIST) {
      checkPatch(e.post, `ending ${e.id}`);
      if (e.rules.variant) checkPatch(e.rules.variant.post, `ending ${e.id} variant`);
    }
    expect(bad).toEqual([]);
  });

  it('uses only valid card metadata', () => {
    const speakers = new Set<string>([...FACTION_IDS, 'moth', 'system', 'lure', 'patron', 'rival']);
    const bad: string[] = [];
    for (const c of CARDS) {
      if (!speakers.has(c.speaker)) bad.push(`${c.id}: speaker ${c.speaker}`);
      if (c.spot && !SPOT_RULES.has(c.spot)) bad.push(`${c.id}: spot ${c.spot}`);
      if (c.with && (!(FACTION_IDS as readonly string[]).includes(c.with) || c.with === c.speaker)) bad.push(`${c.id}: with ${c.with}`);
      if (c.weight !== undefined && c.weight < 0) bad.push(`${c.id}: weight`);
      if (c.cooldown !== undefined && c.cooldown <= 0) bad.push(`${c.id}: cooldown`);
      if ((c.kind === 'faction' || c.kind === 'hostile') && !c.queuedOnly && !c.when) bad.push(`${c.id}: a drawable card needs a when`);
    }
    expect(bad).toEqual([]);
  });

  it('gives every Unlockable a fallback row (§5.0)', () => {
    const bad: string[] = [];
    const rows = C.UNLOCK_SOURCES as Record<string, { fallback: number | string }>;
    eachEffect((e, site) => e.t === 'unlock' && !rows[e.what] && bad.push(`${site.where}: unlock ${e.what} has no fallback row`));
    for (const [t, def] of Object.entries(BUILDINGS)) {
      const u = def.gate?.unlock;
      if (u && !rows[u]) bad.push(`building ${t}: gate unlock ${u} has no fallback row`);
    }
    for (const [u, popFallback] of Object.entries(UNLOCK_FALLBACK_POP)) {
      if (!rows[u]) bad.push(`${u}: in UNLOCK_FALLBACK_POP but no row`);
      else if (rows[u].fallback !== popFallback) bad.push(`${u}: fallback ${String(rows[u].fallback)} ≠ config ${popFallback}`);
    }
    for (const [u, r] of Object.entries(rows)) {
      if (!UNLOCKABLES.has(u)) bad.push(`${u}: not an Unlockable`);
      if (typeof r.fallback === 'number' && (UNLOCK_FALLBACK_POP as Record<string, number>)[u] !== r.fallback) bad.push(`${u}: not in config`);
      if (!C.UNLOCK_NEWS[u as keyof typeof C.UNLOCK_NEWS]) bad.push(`${u}: no unlock news line`);
    }
    expect(bad).toEqual([]);
  });

  it('uses only §10.2 metrics in goals, claims and every other condition', () => {
    const bad: string[] = [];
    const check = (m: string | readonly string[], where: string) => {
      for (const k of typeof m === 'string' ? [m] : m) if (!METRICS.has(k)) bad.push(`${where}: metric ${k}`);
    };
    eachCondNode((c, where) => 'm' in c && check(c.m, where));
    for (const ch of C.CHAPTERS) for (const g of ch.goals) if (g.show) check(g.show.m, `goal ${g.id} show`);
    for (const e of C.ENDING_LIST) for (const cl of e.claims) if (cl.show) check(cl.show.m, `ending ${e.id} show`);
    for (const f of C.FACTION_LIST) for (const d of f.mood) if ('m' in d) check(d.m, `${f.id} mood ${d.label}`);
    for (const [f, terms] of Object.entries(C.POWER_TERMS)) for (const t of terms) if ('m' in t) check(t.m, `power ${f}`);
    // Hold goals need their goal id as key.
    for (const ch of C.CHAPTERS)
      for (const g of ch.goals) if ('hold' in g.cond && g.cond.key !== g.id) bad.push(`goal ${g.id}: hold key ${g.cond.key}`);
    expect(bad).toEqual([]);
  });

  it('holds the 43-card deck as specified (§7.8), plus the 11 expansion cards (EXPANSION §8.3) and the 11 megacity cards (MEGACITY §8.3)', () => {
    const per = Object.fromEntries(Object.entries(C.FACTION_DECKS).map(([f, cards]) => [f, cards.length]));
    expect(per).toEqual({ board: 6, basalt: 6, nacre: 7, undertow: 7, kites: 7, tuning: 6 });
    expect(C.MULTI_CARDS.length).toBe(2);
    expect(C.SYSTEM_CARDS.length).toBe(2);
    expect(C.EXPANSION_CARDS.length).toBe(11);
    expect(C.MEGACITY_CARDS.length).toBe(11);
    // The epilogue deck (MEGACITY §9.4) is WP-8's: counted by whatever it holds.
    expect(C.DECK.length).toBe(43 + 11 + 11 + C.EPILOGUE_DECK.length);
    for (const [f, cards] of Object.entries(C.FACTION_DECKS)) for (const c of cards) expect(c.speaker, c.id).toBe(f);
    for (const c of C.DECK) expect(['faction', 'hostile', 'system'], c.id).toContain(c.kind);
    // 83 cards in the review log (20 beats + 43 deck + 12 logs + 6 ending cards + review + coda),
    // plus 3 whisper callbacks, plus the 11 expansion cards, the 11 megacity cards and the epilogue deck.
    expect(C.BEAT_CARDS.length).toBe(20);
    expect(CARDS.length).toBe(86 + 11 + 11 + C.EPILOGUE_DECK.length);
    expect(CARDS.filter((c) => c.kind === 'whisper').length).toBe(3);
  });

  it('keeps faction sheets complete and consistent with config', () => {
    const bad: string[] = [];
    for (const id of FACTION_IDS) {
      const f = C.FACTIONS[id];
      if (f.name !== FACTION_LABELS[id].name || f.color !== FACTION_LABELS[id].color) bad.push(`${id}: label/colour drift`);
      if (f.callsYou !== C.CALLS_YOU[id]) bad.push(`${id}: callsYou`);
      if (f.mood.length < 4 || f.mood.length > 6) bad.push(`${id}: ${f.mood.length} mood drivers`);
      for (const d of f.mood) if ('m' in d && d.min > d.max) bad.push(`${id}: driver ${d.label} range`);
      if (!f.deal) bad.push(`${id}: no deal`);
      else if (f.deal.minTier !== 'friendly') bad.push(`${id}: deal tier`);
      if (f.salt !== (id !== 'tuning')) bad.push(`${id}: salt`);
      if ((f.hostile.pulse === undefined) !== (f.hostile.pulseEvery === undefined)) bad.push(`${id}: pulse needs pulseEvery`);
    }
    expect(bad).toEqual([]);
    expect(FACTION_IDS.filter((f) => C.FACTIONS[f].inPowerBar)).toEqual(['board', 'basalt', 'nacre', 'undertow', 'kites']);
    expect(Object.keys(C.POWER_TERMS).sort()).toEqual(['basalt', 'board', 'kites', 'nacre', 'undertow']);
  });

  it('keeps the Quiet Hand always selectable', () => {
    const q = C.ENDINGS.quiet;
    expect(q.claims.every((cl) => 'all' in cl.cond && cl.cond.all.length === 0)).toBe(true);
    expect(C.ENDING_ORDER[C.ENDING_ORDER.length - 1]).toBe('quiet');
  });

  it("matches the director's StoryContent registry", () => {
    const sc: StoryContent = C.STORY_CONTENT;
    const idx = useStoryContent(sc);
    try {
      expect(idx.cards.size).toBe(CARDS.length);
      expect(idx.chapters.size).toBe(6);
      expect(idx.endings.map((e) => e.id)).toEqual(C.ENDING_ORDER);
      expect([...idx.logCards.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect([...idx.starCards.keys()].sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12]);
      expect(Object.keys(idx.hostile).sort()).toEqual([...FACTION_IDS].sort());
      expect(idx.optionalBeats).toEqual(new Set(['ch2.tiebreak', 'ch3.winner', 'ch5.kept', 'ch5.hidden']));
    } finally {
      useStoryContent(EMPTY_CONTENT);
    }
  });
});

// ── Clarity pass: briefs, chapter intros, faction intros, glossary ──────────
//
// Plain-language text that explains the story to a first-time player. It has to
// fit its limit, read clean (no '!', no chip numbers, no copy of the body) and
// never spoil a secret before the story itself tells it.

/**
 * The Night of the Gates truth (what MOTH did in 2084), as it would be written.
 * `ch4.logs` tells it; nothing a player can read earlier may.
 */
const GATES_SECRET =
  /\bcomply(?:ing)?\b|\bcomplied\b|\bobeyed\b|\bseal(?:ed|ing)?\s+the\b|\bsealed\b|\bgate order\b|\bstorm order\b|\beleven thousand\b|\b11,000\b|\baldo\b|\byou drowned\b|\bcarried (?:it )?out\b|\bbelow the gates\b/i;
/** Beats and logs shown at or after `ch4.logs` (Ch4's chain, Ch5–Ch6, Logs 4–6, the epilogue). */
const AFTER_GATES = new Set([
  'ch4.logs',
  'ch4.brine',
  'ch5.install',
  'ch5.lure',
  'ch5.choice',
  'ch5.kept',
  'ch5.hidden',
  'ch6.eve',
  'ch6.count',
  'log.04',
  'log.05',
  'log.06',
  'ep.review',
  'coda.recall',
]);

/** The hidden faction (§2.2): nothing may name it before it shows itself. */
const TUNING_WORDS = /\btuning\b|\btuners?\b|\bohm\b|\bthe hum\b/i;
/**
 * Cards that only show once the Tuning is active: its own (the hidden Tuning draws
 * nothing), `ch5.hidden` (after Show yourself), `sys.revealed` (its onShow activates
 * it), Lamplight (Tuning ≥ 50), and Log 12 / the coda (Log 12 comes from `tu.letter`).
 */
const AFTER_TUNING = new Set(['ch5.hidden', 'sys.revealed', 'end.lamplight', 'log.12', 'coda.recall']);

/** Sister Ohm is Ada Ohmura: `tu.letter` reveals it, so only it and what follows may join the names. */
const OHM = /\bohm\b/i;
const OHMURA = /\bohmura\b|\bada\b/i;
const AFTER_OHM = new Set(['tu.letter', 'log.12', 'coda.recall']);

/** Exact effect numbers belong on the choice chips, not in the brief. */
const CHIP_NUMBER = /[+±−]\s?\d|\d,\d{3}|\d\s?%|\bCR\b/;
/** A brief explains the body; it may not lift a run of this many words from it. */
const BODY_RUN = 6;

/** Highest `chapter >= n` (or `> n−1`) bound at a condition's top level or in a top-level `all`. */
function minChapter(c: Condition | undefined): number {
  if (!c) return 0;
  let n = 0;
  for (const t of 'all' in c ? c.all : [c]) {
    if (!('m' in t) || t.m !== 'chapter') continue;
    if (t.op === '>=' || t.op === '==') n = Math.max(n, t.v);
    else if (t.op === '>') n = Math.max(n, t.v + 1);
  }
  return n;
}

/** Flags only `ch4.brine` sets (after Brine names the signer). */
const BRINE_FLAGS = new Set(['published', 'buried', 'leashed']);

/** A condition that needs a flag only `ch4.brine` sets: at its top level, in a top-level `all`, or an `any` of them. */
function needsBrine(c: Condition | undefined): boolean {
  if (!c) return false;
  const isBrine = (t: Condition): boolean => 'flag' in t && t.eq === undefined && BRINE_FLAGS.has(t.flag);
  for (const t of 'all' in c ? c.all : [c]) {
    if (isBrine(t)) return true;
    if ('any' in t && t.any.length > 0 && t.any.every(isBrine)) return true;
  }
  return false;
}

/**
 * Shown no earlier than `ch4.logs`: the explicit list, ending cards, deck cards gated on
 * chapter ≥ 5 (Ch4 only completes after all its beats) or on a flag `ch4.brine` sets.
 * Chapter ≥ 4 alone is not enough: st.chapter is already 4 while Ch4 waits to start
 * and before its chain reaches the logs.
 */
const afterGates = (c: Card): boolean => AFTER_GATES.has(c.id) || c.kind === 'ending' || minChapter(c.when) >= 5 || needsBrine(c.when);
const afterTuning = (c: Card): boolean => c.speaker === 'tuning' || AFTER_TUNING.has(c.id);

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9’']+/g) ?? [];

/** Every clarity-pass string, with where it lives. */
function clarityTexts(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const c of CARDS) if (c.brief) out.push({ where: `${c.id} brief`, text: c.brief });
  for (const ch of C.CHAPTERS) {
    if (ch.summary) out.push({ where: `chapter ${ch.n} summary`, text: ch.summary });
    if (ch.recap) out.push({ where: `chapter ${ch.n} recap`, text: ch.recap });
  }
  out.push({ where: 'epilogue summary', text: C.EPILOGUE.summary });
  for (const f of C.FACTION_LIST) if (f.about) out.push({ where: `${f.id} about`, text: f.about });
  for (const g of C.GLOSSARY) out.push({ where: `glossary ${g.term}`, text: `${g.term} ${g.text}` });
  return out;
}

describe('story clarity pass (briefs, intros, glossary)', () => {
  it('gives every card a player reads a brief within its limit after worst-case token fill', () => {
    const bad: string[] = [];
    for (const c of CARDS) {
      if (!c.brief || !c.brief.trim()) {
        bad.push(`${c.id}: no brief`);
        continue;
      }
      const len = worstCase(c.brief, CARD_TOKEN_MAX).length;
      if (len > COPY_LIMITS.brief) bad.push(`${c.id}: brief ${len} > ${COPY_LIMITS.brief}`);
    }
    expect(bad).toEqual([]);
    // Every kind a player reads is covered: beats, faction, ⚑, system, log, ending, whisper.
    expect(new Set(CARDS.map((c) => c.kind))).toEqual(new Set(['beat', 'faction', 'hostile', 'system', 'log', 'ending', 'whisper']));
  });

  it('writes briefs as plain explanation: a sentence, no chip numbers, no copy of the body', () => {
    const bad: string[] = [];
    for (const c of CARDS) {
      const b = c.brief ?? '';
      if (!/^[A-Z{]/.test(b)) bad.push(`${c.id}: brief should start with a capital or a token`);
      if (!/[.)]$/.test(b)) bad.push(`${c.id}: brief should end in a period`);
      if (/^[a-z]+:/.test(b)) bad.push(`${c.id}: brief is plain narration, not a speaker line`);
      if (b.includes('!')) bad.push(`${c.id}: no '!' in a brief`);
      if (CHIP_NUMBER.test(b)) bad.push(`${c.id}: brief repeats a chip number "${CHIP_NUMBER.exec(b)?.[0]}"`);
      const bw = words(c.body);
      const runs = new Set(bw.slice(0, Math.max(0, bw.length - BODY_RUN + 1)).map((_, i) => bw.slice(i, i + BODY_RUN).join(' ')));
      const own = words(b);
      for (let i = 0; i + BODY_RUN <= own.length; i++) {
        const run = own.slice(i, i + BODY_RUN).join(' ');
        if (runs.has(run)) {
          bad.push(`${c.id}: brief copies the body ("${run}")`);
          break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives every chapter (and the epilogue) a summary and a recap within limits, with no tokens', () => {
    const bad: string[] = [];
    for (const ch of C.CHAPTERS) {
      if (!ch.summary?.trim()) bad.push(`chapter ${ch.n}: no summary`);
      else if (ch.summary.length > COPY_LIMITS.chapterSummary) bad.push(`chapter ${ch.n}: summary ${ch.summary.length}`);
      if (!ch.recap?.trim()) bad.push(`chapter ${ch.n}: no recap`);
      else if (ch.recap.length > COPY_LIMITS.chapterRecap) bad.push(`chapter ${ch.n}: recap ${ch.recap.length}`);
      for (const t of [ch.summary ?? '', ch.recap ?? '']) if (tokensIn(t).length) bad.push(`chapter ${ch.n}: tokens in intro text`);
    }
    const epi = C.EPILOGUE.summary;
    if (!epi.trim() || epi.length > COPY_LIMITS.chapterSummary || tokensIn(epi).length) bad.push('epilogue summary');
    expect(bad).toEqual([]);
  });

  it('gives every faction an "about" line within its limit', () => {
    const bad: string[] = [];
    for (const f of C.FACTION_LIST) {
      if (!f.about?.trim()) bad.push(`${f.id}: no about`);
      else {
        if (f.about.length > COPY_LIMITS.factionAbout) bad.push(`${f.id}: about ${f.about.length} > ${COPY_LIMITS.factionAbout}`);
        if (tokensIn(f.about).length) bad.push(`${f.id}: tokens in about`);
        if (!f.about.includes(f.leader)) bad.push(`${f.id}: about should name the leader, ${f.leader}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps a glossary of 12–22 unique terms, each within its limit, covering the story vocabulary', () => {
    const g = C.GLOSSARY;
    expect(g.length).toBeGreaterThanOrEqual(12);
    // MEGACITY §8.4 raised the cap from 20 to 22 (Sky Lobby, Districts and grants).
    expect(g.length).toBeLessThanOrEqual(22);
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const e of g) {
      const key = e.term.trim().toLowerCase();
      if (!key) bad.push('empty term');
      if (seen.has(key)) bad.push(`duplicate term ${e.term}`);
      seen.add(key);
      if (e.term.length > COPY_LIMITS.title) bad.push(`${e.term}: term too long`);
      if (!e.text.trim()) bad.push(`${e.term}: empty text`);
      if (e.text.length > COPY_LIMITS.glossary) bad.push(`${e.term}: ${e.text.length} > ${COPY_LIMITS.glossary}`);
      if (tokensIn(e.text).length) bad.push(`${e.term}: tokens`);
    }
    // Terms a player meets in the HUD, on cards and in the faction panel.
    const must = ['MOTH', 'Trace', 'Silt Logs', 'standing', 'Salt', 'Deal', 'Patron', 'Turf', 'Seam', 'Crackdown', 'Pact', 'Wasps'];
    must.push('Stratablock', 'Skybridge', 'Ribbon Rail', 'COMMS', 'Charter', 'Charter Night', 'Sunk');
    must.push('Sky Lobby', 'District');
    for (const t of must) if (!g.some((e) => e.term.toLowerCase().includes(t.toLowerCase()))) bad.push(`missing term ${t}`);
    expect(bad).toEqual([]);
  });

  it('runs the banned-term and "!" scans over every clarity text', () => {
    const texts = clarityTexts();
    // Every card's brief (86 + 11 expansion + 11 megacity + the epilogue deck), 6 summaries, 6 recaps, the epilogue,
    // 6 faction lines and the glossary.
    expect(texts.length).toBe(CARDS.length + 6 + 6 + 1 + 6 + C.GLOSSARY.length);
    const bad: string[] = [];
    for (const { where, text } of texts) {
      const hit = C.BANNED_RE.exec(text);
      if (hit) bad.push(`${where}: "${hit[0]}"`);
      if (text.includes('!')) bad.push(`${where}: '!'`);
    }
    expect(bad).toEqual([]);
  });

  it('never explains the Night of the Gates before the story reveals it', () => {
    // The keyword list matches the truth as the story tells it.
    expect(GATES_SECRET.test(CARD_BY_ID.get('ch4.logs')!.body)).toBe(true);
    expect(GATES_SECRET.test(CARD_BY_ID.get('ch4.logs')!.brief ?? '')).toBe(true);
    const bad: string[] = [];
    const check = (where: string, text: string | undefined) => {
      const hit = text && GATES_SECRET.exec(text);
      if (hit) bad.push(`${where}: "${hit[0]}"`);
    };
    for (const c of CARDS) if (!afterGates(c)) check(`${c.id} brief`, c.brief);
    // A chapter's summary shows at its start, its recap once it is done; Ch4's chain tells the truth.
    for (const ch of C.CHAPTERS) {
      if (ch.n <= 4) check(`chapter ${ch.n} summary`, ch.summary);
      if (ch.n <= 3) check(`chapter ${ch.n} recap`, ch.recap);
    }
    for (const f of C.FACTION_LIST) check(`${f.id} about`, f.about);
    for (const e of C.GLOSSARY) check(`glossary ${e.term}`, `${e.term} ${e.text}`);
    expect(bad).toEqual([]);
  });

  it('keeps the Tuning and Sister Ohm a mystery until they show themselves', () => {
    expect(TUNING_WORDS.test(CARD_BY_ID.get('tu.hymn')!.brief ?? '')).toBe(true);
    const letter = CARD_BY_ID.get('tu.letter')!.brief ?? '';
    expect(OHM.test(letter) && OHMURA.test(letter)).toBe(true);
    const bad: string[] = [];
    for (const c of CARDS) {
      const b = c.brief ?? '';
      if (!afterTuning(c) && TUNING_WORDS.test(b)) bad.push(`${c.id} brief names the Tuning ("${TUNING_WORDS.exec(b)?.[0]}")`);
      if (!AFTER_OHM.has(c.id) && OHM.test(b) && OHMURA.test(b)) bad.push(`${c.id} brief links Sister Ohm to Ada Ohmura`);
    }
    // Shown whenever: chapter intros, the glossary and the other factions' lines.
    for (const ch of C.CHAPTERS)
      for (const [k, t] of [['summary', ch.summary], ['recap', ch.recap]] as const) if (t && TUNING_WORDS.test(t)) bad.push(`chapter ${ch.n} ${k}`);
    if (TUNING_WORDS.test(C.EPILOGUE.summary)) bad.push('epilogue summary');
    for (const e of C.GLOSSARY) if (TUNING_WORDS.test(`${e.term} ${e.text}`)) bad.push(`glossary ${e.term}`);
    for (const f of C.FACTION_LIST) if (f.id !== 'tuning' && f.about && TUNING_WORDS.test(f.about)) bad.push(`${f.id} about`);
    // Its own line introduces the movement, not the secret.
    const own = C.FACTIONS.tuning.about ?? '';
    if (OHMURA.test(own) || /\bbuilt you\b|\bengineer\b|\b2084\b/i.test(own)) bad.push('tuning about spoils Sister Ohm');
    expect(bad).toEqual([]);
  });
});

// ── Expansion content (docs/EXPANSION.md §8) ────────────────────────────────
//
// The eleven expansion deck cards, the §8.2 mood and power rows, and the three spot
// rules they use. Copy limits, banned terms, briefs and the rest are covered above.

const EXPANSION_IDS = [
  'ex.manifest',
  'ex.backway',
  'ex.convoy',
  'ex.lounge',
  'ex.glassshore',
  'ex.pricedout',
  'ex.thecut',
  'ex.rights',
  'ex.stringlights',
  'ex.nofly',
  'ex.nightschool',
];
/** The only expansion cards that may ask again (EXPANSION §8.3). */
const EXPANSION_RECURRING = new Set(['ex.manifest', 'ex.backway', 'ex.pricedout']);
/** Values ex.rights may give flag launchRights (Game's Rights row and powerWeight read them). */
const LAUNCH_RIGHTS = ['board', 'basalt', 'nacre', 'kites'];

/** A faction's power weight computed from POWER_TERMS data, the way powerWeight sums it live. */
function termWeight(w: World, terms: readonly C.PowerTerm[]): number {
  let sum = 0;
  for (const t of terms) {
    if ('m' in t) {
      // A term tied to an ending counts only while that ending is current (MEGACITY §9.2).
      if (t.ending !== undefined && w.story.ending !== t.ending) continue;
      let v = 0;
      for (const k of typeof t.m === 'string' ? [t.m] : t.m) v += metric(w, k);
      const x = t.mul * v;
      sum += t.max === undefined ? x : Math.min(x, t.max);
    } else if ('flag' in t) {
      const f = w.story.flags[t.flag];
      if (t.eq === undefined ? !!f : f === t.eq) sum += t.add;
    } else if ('flagCount' in t) {
      const f = w.story.flags[t.flagCount];
      sum += t.mul * (typeof f === 'number' ? f : f ? 1 : 0);
    } else {
      // Corp Spires by sponsor (MEGACITY §6.2): an unsponsored, pre-Megacity Spire counts for Nacre.
      let n = 0;
      for (const b of w.buildings.values()) if (b.type === 'spire' && (b.sponsor ?? 'nacre') === t.spires) n++;
      sum += t.mul * n;
    }
  }
  return sum;
}

describe('expansion story content (EXPANSION §8)', () => {
  const ex = C.EXPANSION_CARDS;

  it('adds the eleven §8.3 cards to the deck only, each a faction card with the listed shape', () => {
    expect(ex.map((c) => c.id)).toEqual(EXPANSION_IDS);
    const bad: string[] = [];
    const inFactionDecks = new Set(Object.values(C.FACTION_DECKS).flatMap((cards) => cards.map((c) => c.id)));
    const deck = new Set(C.DECK.map((c) => c.id));
    for (const c of ex) {
      if (!deck.has(c.id) || !CARD_BY_ID.has(c.id)) bad.push(`${c.id}: not in DECK and CARD_LIST`);
      if (inFactionDecks.has(c.id)) bad.push(`${c.id}: must stay out of FACTION_DECKS`);
      if (c.kind !== 'faction') bad.push(`${c.id}: kind ${c.kind}`);
      if (!c.when) bad.push(`${c.id}: no when`);
      if (!c.brief) bad.push(`${c.id}: no brief`);
      if (c.star || c.queuedOnly || c.seasonal || c.with) bad.push(`${c.id}: no ★, follow-up, seasonal or second faction`);
      if (c.weight !== (c.id === 'ex.rights' ? 30 : 10)) bad.push(`${c.id}: weight ${String(c.weight)}`);
      if (c.cooldown !== 720) bad.push(`${c.id}: cooldown ${String(c.cooldown)}`);
      if (!!c.once === EXPANSION_RECURRING.has(c.id)) bad.push(`${c.id}: once should be ${!EXPANSION_RECURRING.has(c.id)}`);
      if (!!c.onDemand !== (c.id === 'ex.rights')) bad.push(`${c.id}: onDemand`);
      for (const ch of c.choices) for (const e of ch.fx) if (e.t === 'queue') bad.push(`${c.id}: queues ${e.card} (no expansion card queues another)`);
    }
    expect(bad).toEqual([]);
    expect(ex.filter((c) => c.once).length).toBe(8);
    expect(Object.fromEntries(ex.map((c) => [c.id, c.speaker]))).toEqual({
      'ex.manifest': 'undertow',
      'ex.backway': 'undertow',
      'ex.convoy': 'basalt',
      'ex.lounge': 'nacre',
      'ex.glassshore': 'nacre',
      'ex.pricedout': 'board',
      'ex.thecut': 'board',
      'ex.rights': 'board',
      'ex.stringlights': 'kites',
      'ex.nofly': 'kites',
      'ex.nightschool': 'tuning',
    });
    expect(Object.fromEntries(ex.filter((c) => c.spot).map((c) => [c.id, c.spot]))).toEqual({
      'ex.backway': 'alley',
      'ex.glassshore': 'shore',
      'ex.thecut': 'highway',
    });
  });

  it('keeps the $ / $$ / $$$ symbols out of what speakers say (bodies and titles)', () => {
    const bad: string[] = [];
    for (const c of CARDS) for (const [field, text] of [['body', c.body], ['title', c.title]] as const) if (text.includes('$')) bad.push(`${c.id} ${field}`);
    expect(bad).toEqual([]);
  });

  it('opens on demand only for once faction cards, and ex.rights hands the launch rights to exactly one holder', () => {
    const bad: string[] = [];
    for (const c of CARDS) if (c.onDemand && (!c.once || c.kind !== 'faction')) bad.push(`${c.id}: an on-demand card must be a once faction card`);
    expect(bad).toEqual([]);
    const rights = CARD_BY_ID.get('ex.rights')!;
    expect(rights.onDemand).toBe(true);
    // Drawable only while nobody holds the rights, so it can't reopen after an answer.
    const when = rights.when!;
    expect('all' in when && when.all).toEqual([
      { m: 'count.spaceport', op: '>=', v: 1 },
      { not: { flag: 'launchRights' } },
    ]);
    const given = rights.choices.map((ch) => ch.fx.filter((e) => e.t === 'flag' && e.key === 'launchRights').map((e) => (e.t === 'flag' ? e.v : null)));
    expect(given).toEqual([['basalt'], ['nacre'], ['board'], ['kites']]);
    expect(new Set(given.flat())).toEqual(new Set(LAUNCH_RIGHTS));
    expect(rights.choices.find((ch) => ch.default)?.fx).toContainEqual({ t: 'flag', key: 'launchRights', v: 'board' });
    const kites = rights.choices[3];
    expect(kites.requires).toEqual({ m: 'standing.kites', op: '>=', v: 20 });
    expect(kites.lockedHint).toBe('Needs the Kites Friendly');
  });

  it('allows a permanent modifier only as a pure bonus (every penalty is timed, STORY.md §2.3 rule 3)', () => {
    expect(penaltyKeys({ demandInd: 0.06, approvalAdd: -2 })).toEqual(['approvalAdd']);
    expect(penaltyKeys({ landValueAdd: 0.01 })).toEqual([]);
    expect(penaltyKeys({ crimeMul: 1.1, buildCostMul: 0.9, costMul: { stack: 1.2 } })).toEqual(['crimeMul', 'costMul']);
    expect(penaltyKeys({ taxCap: 15 })).toEqual(['taxCap']);
    // The expansion's lasting choices: perm bonuses, timed penalties.
    const perm: string[] = [];
    eachEffect((e, site) => e.t === 'mod' && e.days === 'perm' && perm.push(site.where.split(' ')[0]));
    const expansion = [...new Set(perm)].filter((id) => id.startsWith('ex.')).sort();
    expect(expansion).toEqual(['ex.convoy', 'ex.glassshore', 'ex.lounge', 'ex.nightschool', 'ex.rights', 'ex.stringlights']);
  });

  it('adds the §8.2 mood drivers', () => {
    const row = (f: FactionId, label: string) => C.FACTIONS[f].mood.find((d) => d.label === label);
    expect(row('board', 'Priced out')).toEqual({ label: 'Priced out', m: 'wealth.high', offset: 0.3, mul: -40, min: -8, max: 0 });
    expect(row('basalt', 'Seaports')).toEqual({ label: 'Seaports', m: 'count.seaport', mul: 3, min: 0, max: 6 });
    expect(row('nacre', 'Glass towers')).toEqual({ label: 'Glass towers', m: 'wealth.high', offset: 0.05, mul: 50, min: 0, max: 8 });
    expect(row('undertow', 'Back alleys')).toEqual({ label: 'Back alleys', m: 'roads.alley', mul: 1 / 15, min: 0, max: 5 });
    // Kites (6) and Tuning (5 then; 6 with MEGACITY §8.4's "Lamps on the hill") get cards and power terms instead.
    expect(C.FACTIONS.kites.mood.length).toBe(6);
    expect(C.FACTIONS.tuning.mood.filter((d) => d.label !== 'Lamps on the hill').length).toBe(5);
  });

  it('caps the cheap-tile power terms, and POWER_TERMS sums exactly what powerWeight does live', () => {
    const bad: string[] = [];
    for (const [f, terms] of Object.entries(C.POWER_TERMS))
      for (const t of terms) {
        if ('max' in t && t.max !== undefined && !(t.max > 0)) bad.push(`${f}: max ${t.max}`);
        // Alleys cost 6 CR and power.gangs ≥ 30% is an ending claim: these terms must be capped.
        if ('m' in t && (t.m === 'roads.alley' || t.m === 'skyway.tiles') && t.max === undefined) bad.push(`${f}: ${t.m} uncapped`);
      }
    expect(bad).toEqual([]);
    const capped = Object.values(C.POWER_TERMS).flat().filter((t) => 'm' in t && t.max !== undefined);
    expect(capped).toEqual([
      { m: 'roads.alley', mul: POWER_WEIGHTS.undertow.perAlley, max: POWER_WEIGHTS.undertow.alleyMax },
      { m: 'skyway.tiles', mul: POWER_WEIGHTS.kites.perSkywayTile, max: POWER_WEIGHTS.kites.skywayMax },
    ]);

    const w = flatWorld(77);
    let x = 0;
    for (const t of ['precinct', 'clinic', 'reactor', 'foundry', 'datahub', 'spire', 'glarewall', 'tidemarket', 'roost', 'seaport', 'seaport', 'airport'] as const) {
      expect(w.addBuilding(t, x, 2), t).not.toBeNull();
      x += BUILDINGS[t].size + 1;
    }
    const s = w.stats;
    s.approval = 62;
    s.jobsInd = 800;
    s.jobsCom = 640;
    w.turf.stats.tiles.undertow = 30;
    w.turf.stats.tiles.kites = 18;
    w.story.flags.honestTie = true;
    w.story.flags.branded = 2;
    w.story.flags.oneTide = 'kites';
    const same = () => {
      for (const f of ['board', 'basalt', 'nacre', 'undertow', 'kites'] as const) expect(termWeight(w, C.POWER_TERMS[f]), f).toBeCloseTo(powerWeight(w, f), 6);
    };
    for (const [alley, sky] of [[0, 0], [40, 60], [1000, 400]]) {
      s.roads.alley = alley;
      s.roads.skyway = sky;
      same();
    }
    for (const holder of LAUNCH_RIGHTS) {
      w.story.flags.launchRights = holder;
      same();
    }
    // 1,000 alleys add exactly the cap; 400 sky tiles add exactly theirs.
    expect(termWeight(w, C.POWER_TERMS.undertow.filter((t) => 'm' in t && t.m === 'roads.alley'))).toBe(POWER_WEIGHTS.undertow.alleyMax);
    expect(termWeight(w, C.POWER_TERMS.kites.filter((t) => 'm' in t && t.m === 'skyway.tiles'))).toBe(POWER_WEIGHTS.kites.skywayMax);
  });

  it('resolves the highway, alley and shore spot rules to real places, deterministically', () => {
    const rng = new Rng(1);
    const pick = (w: World, rule: SpotRule) => [spotAvailable(w, rule), findSpot(w, rule, rng)] as const;
    const home = (w: World, x: number, y: number, abandoned = false) => {
      w.setZone(x, y, ZoneType.Residential);
      w.setLevel(x, y, 1, abandoned);
    };

    // highway: the developed Hab Block within 3 of a Highway tile with the highest noise.
    let w = flatWorld(5);
    home(w, 23, 15);
    expect(pick(w, 'highway')).toEqual([false, -1]);
    for (let y = 10; y <= 30; y++) w.setRoad(20, y, RoadKind.Highway);
    expect(pick(w, 'highway')).toEqual([true, w.idx(23, 15)]);
    home(w, 22, 25);
    home(w, 24, 20); // 4 tiles out: too far
    home(w, 21, 12, true); // abandoned
    w.setZone(21, 18, ZoneType.Commercial);
    w.setLevel(21, 18, 2);
    const noise = w.fields.noise;
    noise[w.idx(23, 15)] = 0.4;
    noise[w.idx(22, 25)] = 0.6;
    noise[w.idx(24, 20)] = 0.9;
    noise[w.idx(21, 12)] = 0.95;
    noise[w.idx(21, 18)] = 0.95;
    expect(pick(w, 'highway')).toEqual([true, w.idx(22, 25)]);
    // A street is not a highway.
    for (let y = 10; y <= 30; y++) w.setRoadKind(20, y, RoadKind.Street);
    expect(pick(w, 'highway')).toEqual([false, -1]);

    // alley: the Alley tile with the highest Undertow strength, else the lowest-index one.
    w = flatWorld(6);
    expect(pick(w, 'alley')).toEqual([false, -1]);
    for (const ax of [5, 6, 7]) w.setRoad(ax, 40, RoadKind.Alley);
    w.setRoad(4, 40, RoadKind.Street);
    expect(pick(w, 'alley')).toEqual([true, w.idx(5, 40)]);
    const t = w.turf;
    t.owner[w.idx(6, 40)] = 2; // the Kites, stronger: not Undertow
    t.str[w.idx(6, 40)] = 90;
    t.owner[w.idx(7, 40)] = 1;
    t.str[w.idx(7, 40)] = 40;
    t.owner[w.idx(4, 40)] = 1; // the street beside it
    t.str[w.idx(4, 40)] = 99;
    expect(pick(w, 'alley')).toEqual([true, w.idx(7, 40)]);

    // shore: the developed Hab Block within 2 of water with the highest land value.
    w = flatWorld(7);
    home(w, 42, 10);
    expect(pick(w, 'shore')).toEqual([false, -1]); // no water on a flat map
    for (let y = 0; y < w.N; y++) w.tiles[w.idx(40, y)].terrain = Terrain.Water;
    home(w, 41, 20);
    home(w, 43, 30); // 3 tiles out
    home(w, 41, 40, true); // abandoned
    const lv = w.fields.landValue;
    lv[w.idx(42, 10)] = 0.3;
    lv[w.idx(41, 20)] = 0.5;
    lv[w.idx(43, 30)] = 0.9;
    lv[w.idx(41, 40)] = 0.9;
    expect(pick(w, 'shore')).toEqual([true, w.idx(41, 20)]);
  });
});

// ── Megacity content (docs/MEGACITY.md §8, §3.7) ────────────────────────────
//
// The eleven megacity deck cards (§8.3), the district verbs and the slot target they use (§8.4), the mood and
// power rows (§8.4), the lobby lines (§8.2), the glossary (§8.4), the neighbourhood names of every district and
// variant (§3.7's naming lint) and the spoiler guard over every new player-facing string (§8.6).

const MEGACITY_IDS = ['ds.shoals', 'ds.sunk', 'ds.flats', 'ds.terraces', 'ds.reedmere', 'ds.skeleton', 'ds.tarmac', 'ds.bazaar', 'lm.arena', 'lm.beacon', 'lm.halo'];

/** §8.6: no new text names the gates, the sealing, the reply, the toll (one rule for all new copy, epilogue included). */
const SPOILER_ANY = /\bgates?\b|\bseal(ed|s|ing)?\b|complying|eleven thousand|11,000/i;
/** §8.6: text that can show before `ch4.drain` never names the pump station (only "Old pump hall"). */
const SPOILER_PRE_DRAIN = /pump station|\bPS6\b|02:17/i;

/** The megacity building types (config BUILDING_ORDER, Floodwatch Station .. the old pump hall). */
function megacityTypes(): BuildingType[] {
  const a = BUILDING_ORDER.indexOf('floodwatch');
  const b = BUILDING_ORDER.indexOf('pumphall');
  return BUILDING_ORDER.slice(a, b + 1);
}

/** Sunk-only copy: shows only once the Sunk opens after `ch4.brine` (§3.7), so it may speak to a player who knows. */
const SUNK_BUILDINGS = new Set<BuildingType>(['pumphall', 'hullhouse']);

interface Copy {
  where: string;
  text: string;
  /** Can show before `ch4.drain` (everything except the Sunk's own copy and §9's flag-keyed copy). */
  early: boolean;
}

/** Every new player-facing string this update adds that lives in data (§8.6's list, data part). */
function megacityCopy(): Copy[] {
  const out: Copy[] = [];
  const add = (where: string, text: string | undefined, early = true) => text && out.push({ where, text, early });
  for (const [kind, d] of Object.entries(DISTRICTS)) {
    const early = kind !== 'sunk';
    add(`${kind} name`, d.name, early);
    add(`${kind} short`, d.short, early);
    add(`${kind} tagline`, d.tagline, early);
    d.perks.forEach((p, i) => add(`${kind} perk ${i}`, p, early));
    d.hazards.forEach((p, i) => add(`${kind} hazard ${i}`, p, early));
    for (const [f, q] of Object.entries(d.quote)) add(`${kind} quote ${f}`, q, early);
    d.goals.forEach((g) => add(`${kind} goal ${g.id}`, g.label, early));
    if (d.lease) add(`${kind} lease`, d.lease.prompt, early);
    neighbourhoodsOf(d.kind, 0).forEach((n) => add(`${kind} neighbourhood`, n, early));
    d.variants.forEach((v, i) => {
      add(`${kind}.v${i + 1} name`, v.name);
      add(`${kind}.v${i + 1} short`, v.short);
      add(`${kind}.v${i + 1} tagline`, v.tagline);
      add(`${kind}.v${i + 1} goal`, v.goal.label);
      for (const [f, q] of Object.entries(v.quote ?? {})) add(`${kind}.v${i + 1} quote ${f}`, q);
      neighbourhoodsOf(d.kind, (i + 1) as DistrictVariant).forEach((n) => add(`${kind}.v${i + 1} neighbourhood`, n));
    });
  }
  for (const t of megacityTypes()) {
    const b = BUILDINGS[t];
    const early = !SUNK_BUILDINGS.has(t);
    add(`${t} name`, b.name, early);
    add(`${t} desc`, b.desc, early);
    add(`${t} meta`, b.meta, early);
  }
  for (const id of ['salvage', 'lamp'] as const) {
    add(`crown ${id} name`, CROWNS[id].name);
    add(`crown ${id} summary`, CROWNS[id].summary);
  }
  for (const ms of MILESTONES) add(`milestone ${ms.pop}`, ms.title);
  for (const c of C.MEGACITY_CARDS) eachString(c, `card ${c.id}`, (s, p) => add(p, s, c.id !== 'ds.sunk'));
  for (const e of C.GLOSSARY) if (['Skybridge', 'Sky Lobby', 'Districts and grants'].includes(e.term)) add(`glossary ${e.term}`, `${e.term} ${e.text}`);
  // §9's copy that lives in data: WP-8's epilogue cards (keyed on chapter ≥ 7, so only the universal rule).
  for (const c of C.EPILOGUE_DECK) eachString(c, `card ${c.id}`, (s, p) => add(p, s, false));
  return out;
}

/** Player-facing string literals in a source text (AST: string, template and template-part text; imports skipped). */
function sourceStrings(file: string, source: string): { line: number; text: string }[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: { line: number; text: string }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: n.text });
    else if (ts.isTemplateExpression(n))
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: n.head.text + n.templateSpans.map((sp) => `{x}${sp.literal.text}`).join('') });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Files whose strings §8.6 scans, with whether they may show before `ch4.drain`: the skybridge reasons and news
 * (vertical.ts, actions.ts), inspect notes and toasts (game.ts), advisor lines, district goals and annex copy, City
 * life lines, the City map, tips and the inspect sheet's story rows; and §9's copy (WP-8: the marks, the review
 * lines, the epilogue deck, the Keepsakes list), which is flag-keyed and so only takes the universal rule.
 */
const SCANNED_SOURCES: Record<string, string> = import.meta.glob(
  [
    '../../src/game/story/vertical.ts',
    '../../src/game/actions.ts',
    '../../src/game/game.ts',
    '../../src/game/sim/advisor.ts',
    '../../src/game/cityEvents.ts',
    '../../src/game/districts/goals.ts',
    '../../src/game/districts/annex.ts',
    '../../src/game/districts/daily.ts',
    '../../src/game/districts/names.ts',
    '../../src/ui/citymap.ts',
    '../../src/ui/tips.ts',
    '../../src/ui/inspect.ts',
    '../../src/ui/story/inspectStory.ts',
    '../../src/game/story/content/cards/megacity.ts',
    '../../src/game/marks.ts',
    '../../src/render/art/marks.ts',
    '../../src/game/story/content/epilogue.ts',
    '../../src/game/story/content/cards/epilogue.ts',
    '../../src/ui/story/keepsakes.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);
/** Scanned sources whose copy is flag-keyed or shows only after the reveal: the universal rule only. */
const LATE_SOURCES = ['cards/megacity.ts', 'game/marks.ts', 'art/marks.ts', 'content/epilogue.ts', 'cards/epilogue.ts', 'story/keepsakes.ts'];

/** The neighbourhood names §9.3's marks give an 8×8 cell (WP-8's content/epilogue.ts): no list may reuse one. */
const MARK_CELL_NAMES: readonly string[] = Object.values(MARK_NAMES);
/** Words two district or variant names may share (§3.7). */
const GENERIC_NAME_WORDS = new Set(['the', 'flats', 'marsh', 'isles', 'banks', 'heights', 'fields', 'bazaar', 'towers', 'steps', 'docks', 'row', 'rise', 'fen', 'strip', 'strand', 'grove', 'arcade', 'reach', 'shore', 'shoals', 'terraces']);
const nameWords = (s: string) => s.toLowerCase().split(/[\s-]+/).filter(Boolean);

describe('megacity story content (MEGACITY §8)', () => {
  const mc = C.MEGACITY_CARDS;

  it('adds the eleven §8.3 cards to the deck only, each a once faction card with the listed shape', () => {
    expect(mc.map((c) => c.id)).toEqual(MEGACITY_IDS);
    const bad: string[] = [];
    const inFactionDecks = new Set(Object.values(C.FACTION_DECKS).flatMap((cards) => cards.map((c) => c.id)));
    const deck = new Set(C.DECK.map((c) => c.id));
    for (const c of mc) {
      if (!deck.has(c.id) || !CARD_BY_ID.has(c.id)) bad.push(`${c.id}: not in DECK and CARD_LIST`);
      if (inFactionDecks.has(c.id)) bad.push(`${c.id}: must stay out of FACTION_DECKS`);
      if (c.kind !== 'faction') bad.push(`${c.id}: kind ${c.kind}`);
      if (!c.when) bad.push(`${c.id}: no when`);
      if (!c.brief) bad.push(`${c.id}: no brief`);
      if (c.weight !== 10 || c.cooldown !== 720 || !c.once) bad.push(`${c.id}: weight 10, cooldown 720, once`);
      if (c.star || c.queuedOnly || c.seasonal || c.onDemand || c.spot || c.onShow) bad.push(`${c.id}: no ★, follow-up, seasonal, on-demand, spot or onShow`);
      if (c.choices.filter((ch) => ch.default).length !== 1) bad.push(`${c.id}: exactly one default`);
      for (const ch of c.choices) for (const e of ch.fx) if (e.t === 'queue' || e.t === 'log' || e.t === 'charterNight') bad.push(`${c.id}: ${e.t} (no megacity card queues, logs or opens a beat)`);
    }
    expect(bad).toEqual([]);
    expect(Object.fromEntries(mc.map((c) => [c.id, c.with ? `${c.speaker}+${c.with}` : c.speaker]))).toEqual({
      'ds.shoals': 'nacre',
      'ds.sunk': 'undertow',
      'ds.flats': 'basalt',
      'ds.terraces': 'tuning',
      'ds.reedmere': 'board',
      'ds.skeleton': 'kites',
      'ds.tarmac': 'board',
      'ds.bazaar': 'undertow+kites',
      'lm.arena': 'nacre',
      'lm.beacon': 'undertow',
      'lm.halo': 'kites',
    });
    // Their conditions read what the player annexed and built (§8.3), nothing else.
    const metricsOf = (c: Condition | undefined): string[] => {
      const out: string[] = [];
      const walk = (k: Condition) => {
        if ('m' in k) out.push(...(typeof k.m === 'string' ? [k.m] : k.m));
        else if ('flag' in k) out.push(`flag:${k.flag}`);
        else if ('all' in k) k.all.forEach(walk);
        else if ('any' in k) k.any.forEach(walk);
        else if ('not' in k) walk(k.not);
        else if ('hold' in k) walk(k.hold);
      };
      if (c) walk(c);
      return out;
    };
    expect(Object.fromEntries(mc.map((c) => [c.id, metricsOf(c.when)]))).toEqual({
      'ds.shoals': ['district.shoals'],
      'ds.sunk': ['district.sunk', 'turf.undertow'],
      'ds.flats': ['district.flats'],
      'ds.terraces': ['district.terraces', 'flag:tuningActive'],
      'ds.reedmere': ['district.reedmere'],
      'ds.skeleton': ['district.skeleton', 'turf.kites'],
      'ds.tarmac': ['district.tarmac', 'flag:apronFamilies'],
      'ds.bazaar': ['district.bazaar', 'turf.undertow', 'turf.kites'],
      'lm.arena': ['count.arena'],
      'lm.beacon': ['count.beacon'],
      'lm.halo': ['count.halolookout'],
    });
  });

  it('names only the districts a card is sure of: a 5×5 repeat can be the first of its kind', () => {
    // `district.<kind> >= 1` counts every district of a kind, so on a 5×5 region a ds.* card can come for Halfway
    // Towers before Skeleton Row is owned (16–31% of cities by kind with a random annex order). Its copy names no
    // district of its kind, except the unique Sunk and Tarmac Reach, which ds.tarmac waits for (flag apronFamilies).
    const generic = new Set(['Shoals', 'Terraces', 'Flats', 'Marsh', 'Isles', 'Banks', 'Heights', 'Fields', 'Bazaar', 'Towers', 'Steps', 'Docks']);
    const names = (k: DistrictKind): string[] => {
      const d = DISTRICTS[k];
      return [d.name, d.short, ...d.variants.flatMap((v) => [v.name, v.short])].filter((n) => !generic.has(n));
    };
    const bad: string[] = [];
    for (const c of C.MEGACITY_CARDS.filter((x) => x.id.startsWith('ds.'))) {
      const kind = c.id.slice(3) as DistrictKind;
      if (kind === 'sunk') continue;
      const texts = [c.title, c.body, c.brief ?? '', ...c.choices.map((ch) => ch.label)];
      for (const n of names(kind)) {
        if (kind === 'tarmac' && n === DISTRICTS.tarmac.name) continue;
        const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (texts.some((t) => re.test(t))) bad.push(`${c.id}: names "${n}"`);
      }
    }
    expect(bad).toEqual([]);
    expect(CARD_BY_ID.get('ds.tarmac')!.when).toEqual({ all: [{ m: 'district.tarmac', op: '>=', v: 1 }, { flag: 'apronFamilies' }] });
  });

  it('keeps every physical promise with an effect (§8.4): the district verbs and the slot:skeleton turf target', () => {
    const verbsUsed: string[] = [];
    const bad: string[] = [];
    eachEffect((e, site) => {
      if (e.t === 'flag' && Object.values(DISTRICT_VERBS).some((d) => d.key === e.key)) {
        const verb = districtVerb(e.key, e.v);
        if (!verb) bad.push(`${site.where}: flag ${e.key}=${String(e.v)} is no district verb`);
        else verbsUsed.push(`${site.card?.id} "${site.where.split('"')[1]}" ${e.key}=${String(e.v)}`);
      }
      if ('at' in e && typeof e.at === 'string' && e.at.startsWith('slot:') && site.card?.id !== 'ds.skeleton') bad.push(`${site.where}: slot target outside ds.skeleton`);
    });
    expect(bad).toEqual([]);
    expect(verbsUsed.sort()).toEqual(
      [
        'ds.flats "Clean it first: 9,000." brownfield=cleared',
        'ds.reedmere "Drain the south bank." reeds=drained',
        'ds.sunk "Clear the ruins." ruins=cleared',
        'ds.tarmac "Clear the apron." apron=cleared',
        'ds.tarmac "Rehouse them: 6,000." apron=rehoused',
      ].sort(),
    );
    expect(Object.keys(DISTRICT_VERBS).sort()).toEqual(['apron=cleared', 'apron=rehoused', 'brownfield=cleared', 'reeds=drained', 'ruins=cleared']);
    const skeleton = CARD_BY_ID.get('ds.skeleton')!.choices.find((ch) => ch.label === 'Clear the frames.')!;
    expect(skeleton.fx).toContainEqual({ t: 'turf', gang: 'kites', op: 'str', at: 'slot:skeleton', v: -60 });
  });

  it('adds the §8.4 mood drivers (every faction keeps 4–6)', () => {
    const row = (f: FactionId, label: string) => C.FACTIONS[f].mood.find((d) => d.label === label);
    expect(row('board', 'Green lung')).toEqual({ label: 'Green lung', m: 'district.reedmere', mul: 3, min: 0, max: 3 });
    expect(row('basalt', 'The Flats')).toEqual({ label: 'The Flats', m: 'district.flats', mul: 3, min: 0, max: 3 });
    expect(row('tuning', 'Lamps on the hill')).toEqual({ label: 'Lamps on the hill', m: 'district.terraces', mul: 3, min: 0, max: 3 });
    expect(Object.fromEntries(FACTION_IDS.map((f) => [f, C.FACTIONS[f].mood.length]))).toEqual({ board: 6, basalt: 6, nacre: 6, undertow: 6, kites: 6, tuning: 6 });
  });

  it('adds the §8.4 power terms, and POWER_TERMS still sums exactly what powerWeight does live', () => {
    const W = POWER_WEIGHTS;
    const has = (f: keyof typeof C.POWER_TERMS, t: C.PowerTerm) => expect(C.POWER_TERMS[f], JSON.stringify(t)).toContainEqual(t);
    has('board', { m: 'count.charterhall', mul: W.board.perCharterHall });
    has('basalt', { m: 'count.hexworks', mul: W.basalt.perHexworks });
    has('basalt', { spires: 'basalt', mul: W.basalt.perSpireBasalt });
    has('basalt', { m: 'count.gantry', mul: W.basalt.perGantry, ending: 'ironwork' });
    has('nacre', { spires: 'nacre', mul: W.nacre.perSpire });
    has('nacre', { m: 'count.pearlatrium', mul: W.nacre.perPearlAtrium });
    has('nacre', { m: 'count.glasssmile', mul: W.nacre.perGlassSmile, ending: 'pearl' });
    has('undertow', { m: 'count.hullhouse', mul: W.undertow.perHullhouse });
    has('undertow', { m: 'crowns.salvage', mul: W.undertow.perCrownSalvage });
    has('kites', { m: 'count.kitemast', mul: W.kites.perKiteMast });
    // `count.spire` is gone: Nacre counts its own and the unsponsored Spires only (§6.2).
    expect(Object.values(C.POWER_TERMS).flat().some((t) => 'm' in t && t.m === 'count.spire')).toBe(false);

    const w = flatWorld(78);
    let x = 0;
    const put = (t: BuildingType, y = 2) => {
      const b = w.addBuilding(t, x, y);
      expect(b, t).not.toBeNull();
      x += BUILDINGS[t].size + 1;
      return b!;
    };
    for (const t of ['charterhall', 'hexworks', 'pearlatrium', 'hullhouse', 'kitemast', 'gantry', 'glasssmile'] as const) put(t);
    x = 0;
    const spires = [put('spire', 20), put('spire', 20), put('spire', 20), put('spire', 20)];
    spires[0].sponsor = 'basalt';
    spires[1].sponsor = 'nacre';
    spires[2].sponsor = 'none';
    // spires[3] keeps no sponsor: a pre-Megacity Spire, Nacre's.
    w.vertical.metrics.crowns.salvage = 2;
    w.stats.approval = 58;
    w.stats.jobsInd = 1200;
    w.stats.jobsCom = 900;
    const same = () => {
      for (const f of ['board', 'basalt', 'nacre', 'undertow', 'kites'] as const) expect(termWeight(w, C.POWER_TERMS[f]), f).toBeCloseTo(powerWeight(w, f), 6);
    };
    for (const ending of [null, 'ironwork', 'pearl', 'ledger'] as const) {
      w.story.ending = ending;
      same();
    }
    // The ending terms count only while their ending holds.
    w.story.ending = null;
    const base = termWeight(w, C.POWER_TERMS.basalt);
    w.story.ending = 'ironwork';
    expect(termWeight(w, C.POWER_TERMS.basalt) - base).toBe(W.basalt.perGantry);
  });

  it('pins the §8.2 lobby lines, in voice and within 110 characters, the two variant lines included', () => {
    const lines: Record<string, Partial<Record<FactionId, string>>> = Object.fromEntries(Object.entries(DISTRICTS).map(([k, d]) => [k, d.quote]));
    expect(lines).toEqual({
      shore: {},
      shoals: { nacre: 'Islands, partner! Every window a sea view! I can sell them before you pour the bridges!' },
      sunk: { undertow: 'You know what lies under these streets now, little light. Build on them gently. My people still live here.' },
      flats: { basalt: 'The Flats pay for themselves, Operations. Flat land, a dock, nobody next door to complain.' },
      terraces: {
        tuning: 'On the hill the lamps can see each other, Hum. Let the city climb.',
        board: 'Resolved: homes with a view. Proposed: for once, for everyone.',
      },
      reedmere: { board: 'Minutes: the marsh filters more smog than four plazas. The Board would like to keep it.' },
      skeleton: { kites: "the frames are the best climbing in the city, moth. finish them. we'll mind the roofs." },
      tarmac: {
        nacre: "A runway that's already there, partner! Imagine the terminal!",
        basalt: 'Cargo, Operations. Cargo pays by the tonne. Terminals pay by the smile.',
      },
      bazaar: {
        undertow: 'The night stalls run on tides, little light. I know their tides.',
        kites: 'verdigris is the best market in town. we sell signal there. let us keep selling.',
      },
    });
    const SALLOW_REPEAT = 'Cheap ground and a deep basin, Operations. Two fabs here pay for one anywhere else. I have checked.';
    const LARK_REPEAT = "another market, moth? good. more stalls, more signal. we'll sell there too, if you let us.";
    const variantLines = Object.values(DISTRICTS).flatMap((d) => d.variants.map((v) => [`${d.kind}:${v.name}`, v.quote ?? {}] as const));
    expect(Object.fromEntries(variantLines.filter(([, q]) => Object.keys(q).length))).toEqual({
      'flats:Ironside Docks': { basalt: SALLOW_REPEAT },
      'flats:Cokeworth Flats': { basalt: SALLOW_REPEAT },
      'bazaar:Saffron Arcade': { kites: LARK_REPEAT },
      'bazaar:Moonbrass Bazaar': { kites: LARK_REPEAT },
    });

    // Voice (STORY.md §1.4, MEGACITY §8.5): Marrow in minutes, Sallow calls MOTH "Operations", Oduya alone uses "!",
    // Brine calls MOTH "little light", lark types lowercase, Ohm calls MOTH "the Hum".
    const voice: Record<FactionId, (s: string) => boolean> = {
      board: (s) => /^(Minutes|Resolved|Proposed|Noted|Item)\b/.test(s),
      basalt: (s) => s.includes('Operations'),
      nacre: (s) => s.includes('!') && s.includes('partner'),
      undertow: (s) => s.includes('little light'),
      kites: (s) => s === s.toLowerCase(),
      tuning: (s) => /\bHum\b/.test(s),
    };
    const bad: string[] = [];
    const check = (where: string, kind: string, f: FactionId, s: string) => {
      const def = DISTRICTS[kind as keyof typeof DISTRICTS];
      if (s.length > 110) bad.push(`${where}: ${s.length} > 110`);
      if (!def.lobby.includes(f) && def.lobbyFallback !== f) bad.push(`${where}: ${f} does not lobby for ${kind}`);
      if (!voice[f](s)) bad.push(`${where}: not in ${f}'s voice`);
      if (f !== 'nacre' && s.includes('!')) bad.push(`${where}: '!' outside Nacre`);
      const hit = C.BANNED_RE.exec(s);
      if (hit) bad.push(`${where}: banned "${hit[0]}"`);
    };
    for (const d of Object.values(DISTRICTS)) {
      for (const [f, q] of Object.entries(d.quote)) check(`${d.kind} ${f}`, d.kind, f as FactionId, q ?? '');
      for (const v of d.variants) for (const [f, q] of Object.entries(v.quote ?? {})) check(`${v.name} ${f}`, d.kind, f as FactionId, q ?? '');
    }
    // The hidden Tuning lobbies only for the Terraces, with Marrow speaking until it is active (and never naming it).
    for (const d of Object.values(DISTRICTS)) if (d.kind !== 'terraces' && d.lobby.includes('tuning')) bad.push(`${d.kind}: the Tuning lobbies`);
    expect(DISTRICTS.terraces.lobbyFallback).toBe('board');
    if (TUNING_WORDS.test(DISTRICTS.terraces.quote.board ?? '')) bad.push('terraces: the Board line names the Tuning');
    expect(bad).toEqual([]);
  });

  it('keeps the district copy within §8.5 (taglines 60, perks and hazards 48, goals 40, no banned terms, no "!" outside Nacre)', () => {
    const bad: string[] = [];
    const banned = (where: string, s: string) => {
      const hit = C.BANNED_RE.exec(s);
      if (hit) bad.push(`${where}: banned "${hit[0]}"`);
    };
    for (const d of Object.values(DISTRICTS)) {
      if (d.name.length > 18 || d.short.length > 12) bad.push(`${d.kind}: name or short too long`);
      if (d.tagline.length > 60) bad.push(`${d.kind}: tagline ${d.tagline.length}`);
      for (const l of [...d.perks, ...d.hazards]) if (l.length > 48) bad.push(`${d.kind}: "${l}" ${l.length} > 48`);
      for (const g of d.goals) if (g.label.length > 40) bad.push(`${d.kind}: goal ${g.id} ${g.label.length}`);
      for (const s of [d.name, d.short, d.tagline, ...d.perks, ...d.hazards, ...d.goals.map((g) => g.label), d.lease?.prompt ?? '']) {
        banned(d.kind, s);
        if (s.includes('!')) bad.push(`${d.kind}: '!' in "${s}"`);
      }
      for (const v of d.variants) {
        if (v.name.length > 18 || v.short.length > 12) bad.push(`${v.name}: name or short too long`);
        if (v.tagline.length > 60) bad.push(`${v.name}: tagline ${v.tagline.length}`);
        if (v.goal.label.length > 40) bad.push(`${v.name}: goal ${v.goal.label.length}`);
        for (const s of [v.name, v.short, v.tagline, v.goal.label]) {
          banned(v.name, s);
          if (s.includes('!')) bad.push(`${v.name}: '!' in "${s}"`);
        }
      }
    }
    for (const t of megacityTypes()) for (const s of [BUILDINGS[t].name, BUILDINGS[t].desc, BUILDINGS[t].meta ?? '']) banned(t, s);
    expect(bad).toEqual([]);
    // The Sunk is "the drowned wards", drowned in the official storm; never what the logs said (§8.6).
    expect(DISTRICTS.sunk.tagline).toMatch(/the drowned wards/i);
  });

  it('names every neighbourhood once (§3.7 naming lint): 12 per district, ≤ 15 chars, no district names inside, no banned terms', () => {
    const lists: { where: string; names: readonly string[]; mine: boolean }[] = [{ where: 'Charter Shore', names: START_NEIGHBOURHOODS, mine: false }];
    for (const d of Object.values(DISTRICTS)) {
      if (d.kind === 'shore') continue;
      lists.push({ where: d.name, names: neighbourhoodsOf(d.kind, 0), mine: false });
      d.variants.forEach((v, i) => lists.push({ where: v.name, names: neighbourhoodsOf(d.kind, (i + 1) as DistrictVariant), mine: true }));
    }
    // 1 start list, 8 kinds, 16 variants; every variant has a list of its own (the Step 0b placeholder is filled).
    expect(lists.length).toBe(1 + 8 + 16);
    const bad: string[] = [];
    for (const d of Object.values(DISTRICTS)) {
      const own = VARIANT_NEIGHBOURHOODS[d.kind] ?? [];
      if (own.length !== d.variants.length) bad.push(`${d.kind}: ${own.length} variant lists for ${d.variants.length} variants`);
    }
    const districtNames = Object.values(DISTRICTS).flatMap((d) => [d.name, ...d.variants.map((v) => v.name)]);
    const distinctive = new Set(districtNames.flatMap(nameWords).filter((wd) => !GENERIC_NAME_WORDS.has(wd)));
    const seen = new Map<string, string>(MARK_CELL_NAMES.map((n) => [n.toLowerCase(), 'a §9.3 mark']));
    expect(MARK_CELL_NAMES.length).toBe(7);
    for (const n of MARK_CELL_NAMES) if (n.length > 15) bad.push(`mark cell "${n}" ${n.length} > 15`);
    for (const { where, names, mine } of lists) {
      if (where !== 'Charter Shore' && names.length !== 12) bad.push(`${where}: ${names.length} names`);
      for (const n of names) {
        const key = n.toLowerCase();
        if (n.length > 15) bad.push(`${where}: "${n}" ${n.length} > 15`);
        if (seen.has(key)) bad.push(`${where}: "${n}" also in ${seen.get(key)}`);
        seen.set(key, where);
        for (const dn of districtNames) if (key.includes(dn.toLowerCase())) bad.push(`${where}: "${n}" contains the district name ${dn}`);
        // The new lists also keep every district's own word out ("Gannet", "Kessel"…), so a name never points elsewhere.
        if (mine) for (const wd of nameWords(n)) if (distinctive.has(wd)) bad.push(`${where}: "${n}" uses the district word "${wd}"`);
        const hit = C.BANNED_RE.exec(n);
        if (hit) bad.push(`${where}: "${n}" banned "${hit[0]}"`);
        if (SPOILER_ANY.test(n) || SPOILER_PRE_DRAIN.test(n)) bad.push(`${where}: "${n}" spoils`);
        if (/\blamps?\b|\blanterns?\b/i.test(n) && where !== 'Charter Shore') bad.push(`${where}: "${n}" uses the Tuning's word`);
        if (/[{}$!]/.test(n)) bad.push(`${where}: "${n}" has a token or symbol`);
      }
    }
    // No two district or variant names share a word other than a generic one.
    const owner = new Map<string, string>();
    for (const dn of districtNames)
      for (const wd of nameWords(dn)) {
        if (GENERIC_NAME_WORDS.has(wd)) continue;
        if (owner.has(wd) && owner.get(wd) !== dn) bad.push(`"${dn}" and "${owner.get(wd)}" share "${wd}"`);
        owner.set(wd, dn);
      }
    // A renamed name replaces one that config still holds (Step 9 may move the fix into config and drop the row).
    for (const [from, to] of Object.entries(RENAMED_NEIGHBOURHOODS)) {
      if (!Object.values(DISTRICTS).some((d) => d.neighbourhoods.includes(from))) bad.push(`rename "${from}": no list holds it any more`);
      if (!C.BANNED_RE.test(from)) bad.push(`rename "${from}" → "${to}": only banned names are renamed`);
    }
    expect(bad).toEqual([]);
  });

  it('keeps "Lamp" and "Lantern" for the Tuning in every new name (§3.7): districts, landmarks, milestones, Sky Lobbies, crowns', () => {
    const bad: string[] = [];
    const LAMP = /\blamps?\b|\blanterns?\b/i;
    const tuningTypes = new Set<BuildingType>(['lampchoir']);
    for (const d of Object.values(DISTRICTS)) for (const n of [d.name, d.short, ...d.variants.flatMap((v) => [v.name, v.short])]) if (LAMP.test(n)) bad.push(`district ${n}`);
    for (const t of megacityTypes()) if (LAMP.test(BUILDINGS[t].name) && !tuningTypes.has(t)) bad.push(`building ${BUILDINGS[t].name}`);
    // 'Thousand Lamps' is today's milestone (STORY.md §1.6) and stays.
    for (const ms of MILESTONES) if (LAMP.test(ms.title) && ms.title !== 'Thousand Lamps') bad.push(`milestone ${ms.title}`);
    for (const c of Object.values(CROWNS)) if (LAMP.test(c.name) && c.id !== 'lamp') bad.push(`crown ${c.name}`);
    expect(CROWNS.lamp.favor).toHaveProperty('tuning');
    const fake = { seed: 0 } as World;
    for (let seed = 0; seed < 40; seed++) {
      fake.seed = seed;
      for (let i = 0; i < 400; i += 7) {
        const n = lobbyName(fake, i);
        if (LAMP.test(n)) bad.push(`Sky Lobby ${n}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps the glossary entries of §5.7 and §8.4 verbatim', () => {
    const text = (term: string) => C.GLOSSARY.find((e) => e.term === term)?.text;
    expect(text('Skybridge')).toBe('A walkway for people between two tall towers that line up. Anything lower than the bridge passes under. It cuts car trips and lifts land value. Three linked towers form a Sky Lobby.');
    expect(text('Sky Lobby')).toBe('Three or more towers linked by skybridges. Fewer car trips, higher land value nearby, and visitors who come to walk it.');
    expect(text('Districts and grants')).toBe(
      'A District is one 64×64 part of the region. Each chapter brings a land grant: spend it on the City map to annex a district next to yours. After Charter Night, grants keep coming and credits buy more.',
    );
    expect(text('The Sunk')).toMatch(/built at its edge/);
    expect(C.GLOSSARY.length).toBe(22);
  });

  it('spoiler guard (§8.6): no new copy names the gates, the sealing, the reply or the toll, and nothing before ch4.drain names the pump station', () => {
    // The rules match what they guard against, and not the words the update chose instead.
    for (const s of ['the lower gates', 'Gate', 'sealed', 'Seals', 'sealing', 'Complying.', 'eleven thousand', '11,000']) expect(SPOILER_ANY.test(s), s).toBe(true);
    for (const s of ['Skybridge dark: an anchor dropped below the skyline.', 'Hexgate', 'Old pump hall', 'the drowned wards']) expect(SPOILER_ANY.test(s), s).toBe(false);
    for (const s of ['Pump Station 6', 'the old pump station', 'PS6', '02:17']) expect(SPOILER_PRE_DRAIN.test(s), s).toBe(true);
    expect(SPOILER_PRE_DRAIN.test('Old pump hall') || SPOILER_PRE_DRAIN.test('Pump House')).toBe(false);

    const copy = megacityCopy();
    expect(copy.length).toBeGreaterThan(600);
    const bad: string[] = [];
    for (const { where, text, early } of copy) {
      let hit = SPOILER_ANY.exec(text);
      if (hit) bad.push(`${where}: "${hit[0]}"`);
      if (!early) continue;
      hit = SPOILER_PRE_DRAIN.exec(text) ?? GATES_SECRET.exec(text);
      if (hit) bad.push(`${where} (shows before ch4.drain): "${hit[0]}"`);
    }
    expect(Object.keys(SCANNED_SOURCES).length).toBeGreaterThanOrEqual(15);
    for (const [file, source] of Object.entries(SCANNED_SOURCES)) {
      const early = !LATE_SOURCES.some((f) => file.endsWith(f));
      for (const { line, text } of sourceStrings(file, source)) {
        let hit = SPOILER_ANY.exec(text);
        if (hit) bad.push(`${file}:${line}: "${hit[0]}"`);
        if (!early) continue;
        hit = SPOILER_PRE_DRAIN.exec(text);
        if (hit) bad.push(`${file}:${line} (shows before ch4.drain): "${hit[0]}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives one land grant with every chapter reward I–V and none elsewhere in the content (§8.2)', () => {
    const grants: string[] = [];
    eachEffect((e, site) => e.t === 'grant' && grants.push(`${site.where} ${e.n}`));
    expect(grants).toEqual(['chapter 1 reward 1', 'chapter 2 reward 1', 'chapter 3 reward 1', 'chapter 4 reward 1', 'chapter 5 reward 1']);
    // The ✦ chip shows on any choice that does carry one (none of §8.3's cards does).
    for (const c of C.MEGACITY_CARDS) for (const ch of c.choices) expect(ch.fx.some((e) => e.t === 'grant'), `${c.id} ${ch.label}`).toBe(false);
  });

  it('keeps the noun "grant" on screen for the ✦ land grant only (§0 Words: milestone money is a bonus)', () => {
    // Every source string (class lists, ids and markup aside) and every story text that says "grant" means a land grant.
    const ALL_SOURCES: Record<string, string> = import.meta.glob(['../../src/**/*.ts'], { query: '?raw', import: 'default', eager: true });
    const LAND = /land grants?|✦|annex|next grant|Districts and grants/i;
    const bad: string[] = [];
    const check = (where: string, text: string) => {
      if (!/\bgrants?\b/i.test(text) || LAND.test(text)) return;
      if (/class=|^[a-z0-9 _.:-]+$/.test(text)) return; // a class list, an id or a key, not copy
      bad.push(`${where}: "${text.slice(0, 80)}"`);
    };
    for (const [file, source] of Object.entries(ALL_SOURCES)) for (const { line, text } of sourceStrings(file, source)) check(`${file}:${line}`, text);
    for (const c of CARDS) eachString(c, `card ${c.id}`, (t, p) => !p.endsWith('.id') && check(p, t));
    for (const [k, v] of Object.entries(OTHER_TEXT)) eachString(v, k, check);
    expect(bad).toEqual([]);
    expect(Object.keys(ALL_SOURCES).length).toBeGreaterThan(100);
  });

  it('spoiler guard (§8.6): §9 copy loaded from WP-8\'s modules (review lines, marks, epilogue cards) takes the universal rule', async () => {
    const bad: string[] = [];
    const scan = (where: string, v: unknown) =>
      eachString(v, where, (s, p) => {
        const hit = SPOILER_ANY.exec(s);
        if (hit) bad.push(`${p}: "${hit[0]}"`);
      });
    const mods = import.meta.glob('../../src/game/story/content/epilogue.ts');
    for (const load of Object.values(mods)) {
      const m = (await load()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(m)) if (typeof v !== 'function') scan(`epilogue.${k}`, v);
    }
    for (const c of C.EPILOGUE_DECK) scan(`card ${c.id}`, c);
    expect(bad).toEqual([]);
  });
});
