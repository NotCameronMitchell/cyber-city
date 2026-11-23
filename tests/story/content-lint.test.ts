// Story content lint (docs/STORY.md §13). Fails the build on any copy, id,
// reference or vocabulary problem in src/game/story/content/*. Each check
// collects every offender, so one run lists them all.

import { describe, expect, it } from 'vitest';
import { BUILDINGS, FACTION_IDS, FACTION_LABELS, UNLOCK_FALLBACK_POP } from '../../src/game/config';
import { EMPTY_CONTENT, useStoryContent, type StoryContent } from '../../src/game/story/conditions';
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
import { DEFAULT_MODS } from '../../src/game/story/mods';
import type { Card, Condition, Effect, FactionId, FlagValue, ModPatch } from '../../src/game/story/types';

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
    const longestBuilding = Math.max(...Object.values(BUILDINGS).map((b) => b.name.length));
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
    eachEffect((e, site) => {
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
          // Every penalty is timed (§2.3 rule 3).
          if (e.days === 'perm' || e.days <= 0) bad.push(`${w}: mod ${e.id} must be timed`);
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
          if ((e.op === 'clear' || e.op === 'flip') && e.at !== 'city' && !e.r) bad.push(`${w}: turf ${e.op} needs r`);
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

  it('holds the 43-card deck as specified (§7.8)', () => {
    const per = Object.fromEntries(Object.entries(C.FACTION_DECKS).map(([f, cards]) => [f, cards.length]));
    expect(per).toEqual({ board: 6, basalt: 6, nacre: 7, undertow: 7, kites: 7, tuning: 6 });
    expect(C.MULTI_CARDS.length).toBe(2);
    expect(C.SYSTEM_CARDS.length).toBe(2);
    expect(C.DECK.length).toBe(43);
    for (const [f, cards] of Object.entries(C.FACTION_DECKS)) for (const c of cards) expect(c.speaker, c.id).toBe(f);
    for (const c of C.DECK) expect(['faction', 'hostile', 'system'], c.id).toContain(c.kind);
    // 83 cards in the review log (20 beats + 43 deck + 12 logs + 6 ending cards + review + coda),
    // plus 3 whisper callbacks.
    expect(C.BEAT_CARDS.length).toBe(20);
    expect(CARDS.length).toBe(86);
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

  it('keeps a glossary of 12–20 unique terms, each within its limit, covering the story vocabulary', () => {
    const g = C.GLOSSARY;
    expect(g.length).toBeGreaterThanOrEqual(12);
    expect(g.length).toBeLessThanOrEqual(20);
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
    for (const t of must) if (!g.some((e) => e.term.toLowerCase().includes(t.toLowerCase()))) bad.push(`missing term ${t}`);
    expect(bad).toEqual([]);
  });

  it('runs the banned-term and "!" scans over every clarity text', () => {
    const texts = clarityTexts();
    // 86 briefs, 6 summaries, 6 recaps, the epilogue, 6 faction lines and the glossary.
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
