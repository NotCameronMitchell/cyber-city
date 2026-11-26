// Choices that last, the copy lint (docs/MEGACITY.md §9.6 item 6, §8.5, §8.6): every Charter Review line, every
// epilogue card, the three epilogue tokens, the marks' names and plaques and the Sunk's taglines pass the spoiler
// guard, the banned-term list, the length limits and the voice rules (lowercase lark, Brine's "little light",
// Marrow's minutes, no "!" outside Nacre). Plus the shape of the epilogue deck: Chapter VII only, once, weight 10,
// cooldown 720, exactly one default, a brief, no ⚑, no beat, no queue.

import { describe, expect, it } from 'vitest';
import * as C from '../../src/game/story/content';
import { EPILOGUE_DECK, LANDMARK_CARD_ENDING } from '../../src/game/story/content/cards/epilogue';
import {
  GENERIC_REVIEW_LINE,
  LOGS_PAST,
  MARK_COPY,
  MARK_NAMES,
  REVIEW_LINES,
  REVIEW_LINE_MAX,
  SEAM_PAST,
  SUNK_TAGLINES,
  VOTE_PAST,
} from '../../src/game/story/content/epilogue';
import type { Card, Condition, Effect } from '../../src/game/story/types';

const { CARD_TOKEN_MAX, COPY_LIMITS, worstCase, tokensIn, BANNED_RE } = C;

/** §8.6: one rule for all new copy, the epilogue included. */
const SPOILER = /\bgates?\b|\bseal(ed|s|ing)?\b|complying|eleven thousand|11,000/i;
/** Plaques are short brass lines (§9.3, the Mark type's limit). */
const PLAQUE_MAX = 90;
/** Every `{district}` value (CARD_TOKEN_MAX.district). */
const NAME_MAX = 15;
const TAGLINE_MAX = 60;

/** Every string of §9's copy, with where it lives. */
function lastingTexts(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const l of REVIEW_LINES) out.push({ where: l.id, text: l.text });
  for (const [k, v] of Object.entries({ ...SEAM_PAST, ...VOTE_PAST, ...LOGS_PAST })) out.push({ where: `token ${k}`, text: v });
  for (const [id, c] of Object.entries(MARK_COPY)) {
    out.push({ where: `${id} title`, text: c.title });
    if (c.plaque) out.push({ where: `${id} plaque`, text: c.plaque });
  }
  for (const [k, v] of Object.entries(SUNK_TAGLINES)) out.push({ where: `tagline ${k}`, text: v });
  for (const [k, v] of Object.entries(MARK_NAMES)) out.push({ where: `name ${k}`, text: v });
  // The ending landmarks' plaque templates (marks.ts), at their longest.
  out.push({ where: 'landmark plaque', text: 'Built under The Quiet Hand. Dormant while another ending holds.' });
  for (const c of EPILOGUE_DECK) for (const f of cardTexts(c)) out.push(f);
  return out;
}

function cardTexts(c: Card): { where: string; text: string }[] {
  const out = [
    { where: `${c.id} title`, text: c.title },
    { where: `${c.id} body`, text: c.body },
  ];
  if (c.brief) out.push({ where: `${c.id} brief`, text: c.brief });
  if (c.sys) out.push({ where: `${c.id} sys`, text: c.sys });
  for (const ch of c.choices) out.push({ where: `${c.id} "${ch.label}"`, text: ch.label });
  return out;
}

function condMentions(c: Condition | undefined, pred: (c: Condition) => boolean): boolean {
  if (!c) return false;
  if (pred(c)) return true;
  if ('all' in c) return c.all.some((k) => condMentions(k, pred));
  if ('any' in c) return c.any.some((k) => condMentions(k, pred));
  if ('not' in c) return condMentions(c.not, pred);
  return false;
}

function effects(fx: readonly Effect[]): Effect[] {
  const out: Effect[] = [];
  for (const e of fx) {
    out.push(e);
    if (e.t === 'if') out.push(...effects(e.then), ...effects(e.else ?? []));
  }
  return out;
}

describe('choices that last: the copy (§9.6 item 6)', () => {
  it('never names the secret: every §9 string passes the §8.6 spoiler guard', () => {
    const bad = lastingTexts().filter((t) => SPOILER.test(t.text)).map((t) => `${t.where}: ${t.text}`);
    expect(bad).toEqual([]);
  });

  it('uses no banned term and no "!" outside Nacre', () => {
    const bad: string[] = [];
    for (const t of lastingTexts()) {
      const hit = BANNED_RE.exec(t.text);
      if (hit) bad.push(`${t.where}: "${hit[0]}"`);
    }
    for (const l of REVIEW_LINES) if (l.text.includes('!')) bad.push(`${l.id}: '!'`);
    for (const c of EPILOGUE_DECK) if (c.speaker !== 'nacre') for (const t of cardTexts(c)) if (t.text.includes('!')) bad.push(`${t.where}: '!'`);
    expect(bad).toEqual([]);
  });

  it('keeps every review line within 140 characters with {patron} at its longest, in narrator voice', () => {
    const bad: string[] = [];
    for (const l of REVIEW_LINES) {
      const n = worstCase(l.text, CARD_TOKEN_MAX).length;
      if (n > REVIEW_LINE_MAX) bad.push(`${l.id}: ${n}`);
      for (const t of tokensIn(l.text)) if (!(t in CARD_TOKEN_MAX)) bad.push(`${l.id}: {${t}}`);
      if (!/[.]$/.test(l.text)) bad.push(`${l.id}: ends without a period`);
    }
    expect(bad).toEqual([]);
    expect(REVIEW_LINES[REVIEW_LINES.length - 1].id).toBe(GENERIC_REVIEW_LINE);
    expect(new Set(REVIEW_LINES.map((l) => l.id)).size).toBe(REVIEW_LINES.length);
    // §9.4's table: 18 callbacks and the generic line.
    expect(REVIEW_LINES.length).toBe(19);
  });

  it('fits the tokens, names, plaques and taglines into their limits', () => {
    expect(Math.max(...Object.values(SEAM_PAST).map((s) => s.length))).toBeLessThanOrEqual(CARD_TOKEN_MAX.seamPast);
    expect(Math.max(...Object.values(VOTE_PAST).map((s) => s.length))).toBeLessThanOrEqual(CARD_TOKEN_MAX.votePast);
    expect(Math.max(...Object.values(LOGS_PAST).map((s) => s.length))).toBeLessThanOrEqual(CARD_TOKEN_MAX.logsPast);
    // Each token's limit is its longest value (no slack hides a longer string).
    expect(CARD_TOKEN_MAX.seamPast).toBe(Math.max(...Object.values(SEAM_PAST).map((s) => s.length)));
    const bad: string[] = [];
    for (const [k, v] of Object.entries(MARK_NAMES)) if (v.length > NAME_MAX) bad.push(`name ${k}: ${v.length}`);
    for (const [k, v] of Object.entries(MARK_COPY)) if (v.plaque.length > PLAQUE_MAX) bad.push(`plaque ${k}: ${v.plaque.length}`);
    for (const [k, v] of Object.entries(SUNK_TAGLINES)) if (v.length > TAGLINE_MAX) bad.push(`tagline ${k}: ${v.length}`);
    // The names are original: none clashes with a start-map neighbourhood.
    for (const v of Object.values(MARK_NAMES)) if ((C as unknown as { DISTRICTS?: readonly string[] }).DISTRICTS?.includes(v)) bad.push(`name ${v} clashes`);
    expect(bad).toEqual([]);
  });

  it('writes the epilogue cards in voice: lark in lowercase, Brine says "little light", Marrow speaks in minutes', () => {
    const bad: string[] = [];
    for (const c of EPILOGUE_DECK) {
      // Every quoted line of lark's is lowercase.
      for (const mt of c.body.matchAll(/lark: '([^']*)'/g)) if (mt[1] !== mt[1].toLowerCase()) bad.push(`${c.id}: lark capitalises "${mt[1]}"`);
      if (/Brine:/.test(c.body) && !c.body.includes('little light')) bad.push(`${c.id}: Brine without "little light"`);
      if (/Marrow:/.test(c.body) && !c.body.includes("Marrow: 'Minutes.")) bad.push(`${c.id}: Marrow without her minutes`);
      if (c.speaker === 'basalt' && !c.body.includes('Operations')) bad.push(`${c.id}: Sallow without "Operations"`);
    }
    expect(bad).toEqual([]);
  });
});

describe('choices that last: the epilogue deck (§9.4)', () => {
  it('holds the five core cards and the five landmark cards, each in the deck', () => {
    const ids = EPILOGUE_DECK.map((c) => c.id);
    expect(ids.slice(0, 5)).toEqual(['ep.kite', 'ep.seam', 'ep.names', 'ep.fence', 'ep.leash']);
    expect(ids.slice(5).sort()).toEqual(Object.keys(LANDMARK_CARD_ENDING).sort());
    for (const c of EPILOGUE_DECK) expect(C.DECK.includes(c), c.id).toBe(true);
  });

  it('gives every card the deck shape: Chapter VII, once, weight 10, cooldown 720, one default, a brief, no ⚑ / beat / queue', () => {
    const bad: string[] = [];
    for (const c of EPILOGUE_DECK) {
      if (!condMentions(c.when, (k) => 'm' in k && k.m === 'chapter' && k.op === '>=' && k.v === 7)) bad.push(`${c.id}: no chapter >= 7`);
      if (!c.once || c.weight !== 10 || c.cooldown !== 720) bad.push(`${c.id}: once/weight/cooldown`);
      if (c.choices.filter((ch) => ch.default).length !== 1) bad.push(`${c.id}: defaults`);
      if (!c.brief) bad.push(`${c.id}: no brief`);
      if (c.star !== undefined || c.queuedOnly || c.kind === 'beat' || c.kind === 'hostile') bad.push(`${c.id}: kind ${c.kind}`);
      if (!['faction', 'system'].includes(c.kind)) bad.push(`${c.id}: kind ${c.kind}`);
      for (const ch of c.choices) for (const e of effects(ch.fx)) if (e.t === 'queue' || e.t === 'charterNight' || e.t === 'ending' || e.t === 'countdown') bad.push(`${c.id}: ${e.t}`);
    }
    expect(bad).toEqual([]);
  });

  it('fits the copy limits after worst-case token fill, labels end in a period', () => {
    const bad: string[] = [];
    for (const c of EPILOGUE_DECK) {
      const fit = (what: string, s: string, max: number) => {
        const n = worstCase(s, CARD_TOKEN_MAX).length;
        if (n > max) bad.push(`${c.id} ${what}: ${n} > ${max}`);
        for (const t of tokensIn(s)) if (!(t in CARD_TOKEN_MAX)) bad.push(`${c.id} ${what}: {${t}}`);
      };
      fit('title', c.title, COPY_LIMITS.title);
      fit('body', c.body, COPY_LIMITS.body);
      fit('brief', c.brief ?? '', COPY_LIMITS.brief);
      for (const ch of c.choices) {
        fit(`label "${ch.label}"`, ch.label, COPY_LIMITS.label);
        if (!ch.label.endsWith('.')) bad.push(`${c.id}: "${ch.label}" ends without a period`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('only sets new flags: ep.fence and ep.leash leave buried / leashed (and so the ending claims) alone', () => {
    const set = new Set<string>();
    for (const c of EPILOGUE_DECK) for (const ch of c.choices) for (const e of effects(ch.fx)) if (e.t === 'flag') set.add(e.key);
    expect([...set].sort()).toEqual(['hallOpened', 'hallPoured', 'kiteHello', 'namesLit', 'seamFair', 'unleashed']);
  });
});
