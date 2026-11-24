// ─────────────────────────────────────────────────────────────────────────────
// Story UI root (docs/STORY.md §8): builds every story surface, keeps them in
// step with game.story.view() and the story events, and makes sure only one
// modal surface shows at a time.
//
//   rail          always visible above the toolbar (dock slot)
//   card          beats, faction / ⚑ / system cards, logs, ending cards
//   banner        a message arrived: a COMMS card or a story message (one at a
//                 time, never over a card); repeats gently while a story
//                 message waits unread (docs/PACING.md)
//   title         chapter title card (over everything; longer with a summary).
//                 While it shows, the director holds story and urgent cards
//                 (holdTitle) and a card already open waits behind it unshown
//   sheets        goal drawer · faction sheet · COMMS (one at a time)
//   charter       Charter Night (and its read-only preview)
//   ending        ending screen, after the final card and its log close
//
// Sync model: the view is cached by the director and rebuilt on change, so a
// per-frame identity check is enough to notice every update; events only
// trigger the one-shot surfaces (title card, banner, Charter Night, ending).
// Reading budget (§8.11): nothing here queues extra modals; a banner that
// arrives under a card waits until the card closes, then shows once.
// ─────────────────────────────────────────────────────────────────────────────

import type { StoryView } from '../../game/story/types';
import type { UIContext } from '../context';
import { h, setClass } from '../dom';
import { clock } from '../format';
import { CharterNight } from './charterNight';
import { ChapterTitle } from './chapterTitle';
import { Comms } from './comms';
import { EndingScreen } from './endingScreen';
import { FactionSheet } from './factionSheet';
import { GoalDrawer } from './goalDrawer';
import { IncomingBanner, type BannerMessage } from './incoming';
import { StoryCard } from './storyCard';
import { StoryRail } from './storyRail';

type Sheet = 'goals' | 'factions' | 'comms';

/** Real seconds between gentle repeats of the banner while a story message waits unread. */
const RECUE_SEC = 150;

export class StoryUI {
  readonly el: HTMLElement;
  readonly rail: StoryRail;
  private readonly scrim: HTMLElement;
  private readonly card: StoryCard;
  private readonly banner: IncomingBanner;
  private readonly title: ChapterTitle;
  private readonly goals = new GoalDrawer();
  private readonly factions: FactionSheet;
  private readonly comms: Comms;
  private readonly charter: CharterNight;
  private readonly ending: EndingScreen;
  private sheet: Sheet | null = null;
  private lastView: StoryView | null = null;
  private lastStory: unknown = null;
  private bannerWaiting: string | null = null;
  private charterWaiting = false;
  private endingWaiting = false;
  private endingDelay = 0;
  private seenTick = -1;
  private resumeTimer = 0;
  /** Real seconds since the last banner for the waiting story message (gentle re-cue). */
  private cueAge = 0;
  private offs: (() => void)[] = [];
  /** Called when a surface opens or closes (the root collapses the coach / tray). */
  onChange: (() => void) | null = null;
  /** Called whenever the StoryView changes (the root re-checks story-gated tool groups). */
  onView: (() => void) | null = null;

  constructor(private readonly ctx: UIContext) {
    this.rail = new StoryRail(ctx, {
      goals: () => this.toggleSheet('goals'),
      factions: () => this.toggleSheet('factions'),
      comms: () => this.toggleSheet('comms'),
    });
    this.scrim = h('div', { class: 'cc-st-scrim', hidden: true });
    this.card = new StoryCard(ctx);
    this.banner = new IncomingBanner(ctx, () => this.dockTop());
    this.title = new ChapterTitle();
    this.factions = new FactionSheet(ctx);
    this.comms = new Comms(ctx);
    this.charter = new CharterNight(ctx);
    this.ending = new EndingScreen(ctx);
    this.el = h(
      'div',
      { class: 'cc-story' },
      this.scrim,
      this.goals.sheet.el,
      this.factions.sheet.el,
      this.comms.el,
      this.card.el,
      this.banner.el,
      this.charter.el,
      this.ending.el,
      this.title.el,
    );

    this.scrim.addEventListener('click', () => {
      if (this.sheet) this.closeSheets();
    });
    this.card.onPeek = (on) => setClass(this.scrim, 'is-peek', on);
    const closed = () => {
      this.sheet = null;
      this.layout();
    };
    this.goals.sheet.onClosed = closed;
    const prevFac = this.factions.sheet.onClosed;
    this.factions.sheet.onClosed = () => {
      prevFac?.();
      closed();
    };
    this.comms.onClosed = () => {
      this.markSeen();
      closed();
    };
    this.goals.onPreview = () => {
      const v = this.view();
      this.closeSheets();
      if (v.claims.length) this.charter.open(v, true);
      this.layout();
    };
    this.goals.onRead = (slot) => this.openMessage(slot);
    this.goals.onPace = () => {
      this.closeSheets();
      this.layout();
      this.ctx.actions.openMenu('settings');
    };
    this.comms.onWaiting = () => this.openMessage('story');
    this.charter.onClosed = () => this.layout();
    this.ending.onClosed = () => this.layout();
    this.title.onClose = () => {
      // Story cards waited behind the title (director.holdTitle): show whatever is open now.
      this.ctx.game.story.holdTitle(false);
      this.lastView = null;
      this.layout();
    };

    this.wire();
    this.onWorld();
  }

  /**
   * Top edge (viewport px) of whatever the bottom dock shows above the toolbar: the
   * rail, the tool chip and its hint, the coach, the legend, an in-flow inspect sheet
   * or the tray. The incoming banner sits above all of it. Null = nothing showing.
   */
  private dockTop(): number | null {
    let top = this.rail.topEdge();
    const dock = this.ctx.root.querySelector('.cc-dock');
    if (!dock) return top;
    for (const el of dock.querySelectorAll<HTMLElement>('.cc-dock-stack > *, .cc-chiprow > *, .cc-sheet-slot > *, .cc-tray')) {
      if (el.hidden || el.classList.contains('cc-chiprow')) continue;
      const r = el.getBoundingClientRect();
      if (r.height <= 0 || getComputedStyle(el).position === 'fixed') continue; // landscape side cards
      if (top === null || r.top < top) top = r.top;
    }
    return top;
  }

  private view(): StoryView {
    return this.ctx.game.story.view();
  }

  // ── Events ───────────────────────────────────────────────────────────────

  private wire(): void {
    const ev = this.ctx.game.events;
    const on: typeof ev.on = (t, fn) => {
      const off = ev.on(t, fn);
      this.offs.push(off);
      return off;
    };
    on('chapter', (c) => {
      const v = this.view();
      const t = v.titleCard;
      this.closeSheets();
      this.title.show({
        numeral: t?.numeral || v.chapter.numeral,
        title: t?.title || c.title || v.chapter.title,
        epigraph: t?.epigraph ?? '',
        question: t?.question || v.chapter.question,
        coherence: t?.coherence ?? v.coherence,
        summary: t?.summary ?? v.chapter.summary ?? '',
      });
      // One modal at a time: the chapter's first card waits until the title closes.
      this.ctx.game.story.holdTitle(true);
      this.layout();
    });
    on('incoming', (e) => this.queueBanner(e.id));
    on('charterNight', () => {
      this.charterWaiting = true;
    });
    on('ending', () => {
      this.endingWaiting = true;
      this.endingDelay = 0.6;
    });
    on('world', () => this.onWorld());
  }

  private onWorld(): void {
    this.title.hide();
    this.card.hide();
    this.banner.hide(true);
    this.closeSheets();
    this.charter.close();
    this.ending.close();
    this.bannerWaiting = null;
    this.charterWaiting = false;
    this.endingWaiting = false;
    this.lastView = null;
    this.lastStory = null;
    const v = this.view();
    this.seenTick = v.comms.reduce((m, r) => Math.max(m, r.tick), -1);
    window.clearTimeout(this.resumeTimer);
    this.resumeTimer = window.setTimeout(() => this.resumeToast(), 1600);
  }

  /** On load: pulse the goal chip and toast where the chapter stands (§8.10). */
  private resumeToast(): void {
    const v = this.view();
    // Never over a card, sheet, title, Charter Night or the ending screen (they carry their own context).
    if (!StoryRail.hasStory(v) || this.busy) return;
    this.rail.pulse();
    if (v.countdownDays !== null) {
      this.ctx.game.toast(`Charter Night in ${Math.ceil(v.countdownDays)} days`, 'info');
      return;
    }
    if (!v.goals.length) return;
    const done = v.goals.filter((g) => g.done || g.waived).length;
    const next = v.goals.find((g) => !g.done && !g.waived);
    const closes = v.chapter.closesInSec;
    const waiting = v.messages.some((m) => m.slot === 'story');
    const tail = waiting
      ? ' · a message is waiting'
      : next
        ? ` · ${next.label}${next.now && next.need ? ` · now ${next.now}` : ''}`
        : closes !== undefined
          ? ` · closes in ${clock(closes)}`
          : '';
    this.ctx.game.toast(`Chapter ${v.chapter.numeral} · ${done}/${v.goals.length}${tail}`, 'info');
  }

  /** Open a waiting message from the drawer, COMMS or the banner. */
  private openMessage(slot: 'story' | 'comms'): void {
    this.closeSheets();
    this.banner.hide(true);
    this.layout();
    if (slot === 'story') this.ctx.game.openWaiting();
    else this.ctx.game.openPending();
  }

  private queueBanner(id: string): void {
    if (this.card.isOpen || this.title.isOpen || this.sheet === 'comms' || this.charter.isOpen || this.ending.isOpen) {
      this.bannerWaiting = id;
      return;
    }
    this.showBanner(id);
  }

  /** The banner for a message still waiting (from the director's banner, or the message list). */
  private bannerFor(v: StoryView, id: string): BannerMessage | null {
    const m = v.messages.find((x) => x.id === id);
    if (!m) return null;
    const b = v.banner && v.banner.id === id ? v.banner : null;
    return { id, title: b?.title ?? m.title, faction: m.faction, kind: m.kind, from: m.from, slot: m.slot };
  }

  private showBanner(id: string): void {
    const b = this.bannerFor(this.view(), id);
    if (!b) return;
    if (b.slot === 'story') this.cueAge = 0;
    this.banner.show(b);
  }

  // ── Sheets ───────────────────────────────────────────────────────────────

  private toggleSheet(s: Sheet): void {
    if (this.sheet === s) {
      this.closeSheets();
      return;
    }
    this.closeSheets();
    this.banner.hide(true);
    const v = this.view();
    this.sheet = s;
    if (s === 'goals') {
      this.goals.sync(v);
      this.goals.sheet.open();
    } else if (s === 'factions') {
      this.factions.sync(v, true);
      this.factions.open();
    } else {
      this.comms.sync(v, true);
      this.comms.open('log');
    }
    this.layout();
  }

  /** Open COMMS on the Silt Logs tab (e.g. from a log notice). */
  openLogs(): void {
    this.closeSheets();
    this.sheet = 'comms';
    this.comms.sync(this.view(), true);
    this.comms.open('silt');
    this.layout();
  }

  private closeSheets(): void {
    const s = this.sheet;
    this.sheet = null;
    if (s === 'goals') this.goals.sheet.close();
    else if (s === 'factions') this.factions.sheet.close();
    else if (s === 'comms') this.comms.close();
  }

  private markSeen(): void {
    const v = this.view();
    this.seenTick = v.comms.reduce((m, r) => Math.max(m, r.tick), this.seenTick);
  }

  private unread(v: StoryView): number {
    let n = 0;
    for (const r of v.comms) if (r.tick > this.seenTick) n++;
    return n;
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  /** True while any story surface covers the map. */
  get busy(): boolean {
    return this.card.isOpen || this.sheet !== null || this.title.isOpen || this.charter.isOpen || this.ending.isOpen;
  }

  /** True while a full-screen story surface is up (chapter title, Charter Night, ending). */
  get fullscreen(): boolean {
    return this.title.isOpen || this.charter.isOpen || this.ending.isOpen;
  }

  /**
   * True while toasts must wait: a full-screen surface, or an open story card
   * (a toast printed over the card's header hides who is speaking).
   */
  get holdsToasts(): boolean {
    return this.fullscreen || this.card.isOpen;
  }

  update(dt: number): void {
    const story = this.ctx.game.story;
    const v = story.view();
    if (v !== this.lastView || story !== this.lastStory) {
      this.lastView = v;
      this.lastStory = story;
      this.sync(v);
    }
    this.card.update();
    if (this.sheet === 'comms') this.comms.tick();
    // Deferred one-shots, once the card queue has drained.
    if (!this.card.isOpen && !this.title.isOpen) {
      if (this.charterWaiting && !this.ending.isOpen) {
        this.charterWaiting = false;
        if (v.claims.length) {
          this.closeSheets();
          this.charter.open(v, false);
          this.layout();
        }
      } else if (this.endingWaiting && !this.charter.isOpen) {
        this.endingDelay -= dt;
        if (this.endingDelay <= 0) {
          this.endingWaiting = false;
          if (v.ending) {
            this.closeSheets();
            this.ending.open(v, this.card.lastEndingBody);
            this.layout();
          }
        }
      } else if (this.bannerWaiting && !this.sheet && !this.charter.isOpen && !this.ending.isOpen) {
        const id = this.bannerWaiting;
        this.bannerWaiting = null;
        if (v.messages.some((m) => m.id === id)) this.showBanner(id);
      }
    }
    // Gentle re-cue: while a story message waits unread and nothing else is up, the banner
    // comes back every couple of minutes of play (never while paused or over a surface).
    const msg = v.messages.find((m) => m.slot === 'story');
    if (!msg || this.busy || this.banner.isOpen || this.ctx.game.speed === 0 || this.ctx.modals.depth > 0) {
      if (!msg) this.cueAge = 0;
      return;
    }
    this.cueAge += dt;
    if (this.cueAge >= RECUE_SEC) this.showBanner(msg.id);
  }

  private sync(v: StoryView): void {
    // Card. One modal at a time: a card that opens while the chapter title is up waits
    // for it (the title's close re-syncs), so a first tap never lands on the wrong surface.
    if (v.card) {
      if (!this.title.isOpen) {
        // A beat that opens over Budget / City Report / News (z 50 over the story layer)
        // would sit hidden behind it while the sim waits, so close the dialog.
        if (this.card.card?.id !== v.card.id && this.ctx.modals.depth > 0) this.ctx.modals.closeAll();
        if (this.sheet) this.closeSheets();
        if (this.charter.isOpen && this.charter.isPreview) this.charter.close();
        this.banner.hide(true);
        this.card.show(v.card, v);
      }
    } else if (this.card.isOpen) this.card.hide();
    // Banner whose card was answered or opened elsewhere.
    if (this.banner.isOpen && !v.messages.some((m) => m.id === this.banner.id)) this.banner.hide(false);
    this.rail.sync(v, this.unread(v));
    if (this.sheet === 'goals') this.goals.sync(v);
    else if (this.sheet === 'factions') this.factions.sync(v);
    else if (this.sheet === 'comms') {
      this.comms.sync(v);
      this.markSeen();
    }
    if (this.charter.isOpen) this.charter.sync(v);
    this.layout();
    this.onView?.();
  }

  /** Scrim, rail visibility and body classes for the current surfaces. */
  private layout(): void {
    const card = this.card.isOpen;
    const sheet = this.sheet !== null;
    const full = this.charter.isOpen || this.ending.isOpen;
    this.scrim.hidden = !(card || sheet);
    setClass(this.scrim, 'is-card', card);
    const v = this.lastView ?? this.view();
    this.rail.setVisible(StoryRail.hasStory(v) && !card && !sheet && !full && !this.title.isOpen);
    setClass(this.ctx.root, 'has-story-modal', card || sheet || full || this.title.isOpen);
    this.onChange?.();
  }

  /** Esc: title → charter confirm/preview → sheet → Later on a faction card. Returns whether something closed. */
  closeTop(): boolean {
    if (this.title.isOpen) {
      this.title.hide();
      return true;
    }
    if (this.ending.isOpen) {
      this.ending.close();
      return true;
    }
    if (this.charter.isOpen && this.charter.isPreview) {
      this.charter.close();
      return true;
    }
    if (this.sheet) {
      this.closeSheets();
      return true;
    }
    if (this.card.isOpen && this.card.card?.canLater) {
      this.ctx.game.later();
      return true;
    }
    return false;
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }
}
