// ─────────────────────────────────────────────────────────────────────────────
// City report: population, approval, RCI demand explained, jobs, power grid
// load and city-wide averages. Opened from the population / demand HUD items.
// ─────────────────────────────────────────────────────────────────────────────

import { CURRENCY, EDGE_LINKS, ROAD_KINDS, ZONES } from '../game/config';
import { RoadKind } from '../game/types';
import { buildDialog, type UIContext } from './context';
import { h, setClass, setHidden, setStyle, setText } from './dom';
import { MINUS, groupInt, pct } from './format';
import { icon } from './icons';
import { TIER_SWATCHES } from './tools';

interface Meter {
  row: HTMLElement;
  value: HTMLElement;
  fill: HTMLElement;
}

function meterRow(label: string, cls = ''): Meter {
  const value = h('span', { class: 'cc-rep-v' });
  const fill = h('i');
  const row = h('div', { class: `cc-rep-row ${cls}` }, h('span', { class: 'cc-rep-l', text: label }), h('span', { class: 'cc-meter' }, fill), value);
  return { row, value, fill };
}

export class CityReport {
  readonly el: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly peak: HTMLElement;
  private readonly approval: Meter;
  private readonly demand: { row: HTMLElement; up: HTMLElement; down: HTMLElement; word: HTMLElement }[] = [];
  private readonly jobs: HTMLElement;
  private readonly power: Meter;
  private readonly powerNote: HTMLElement;
  private readonly avgs: Meter[];
  /** Wealth split ($ / $$ / $$$) and what tiers change (EXPANSION §4.4, §7.6). */
  private readonly wealthBox: HTMLElement;
  private readonly wealthBar: HTMLElement[];
  private readonly wealthKey: HTMLElement;
  private readonly tierNote: HTMLElement;

  constructor(private readonly ctx: UIContext) {
    const d = buildDialog({ id: 'cc-report', title: 'City report', icon: icon('chart') });
    this.el = d.el;
    this.sub = d.sub;
    d.el.classList.add('cc-report');

    this.pop = h('span', { class: 'cc-rep-pop' });
    this.peak = h('span', { class: 'cc-rep-peak' });
    this.approval = meterRow('Approval', 'is-approval');

    const demandBox = h('div', { class: 'cc-rep-demand' });
    for (const z of [ZONES.res, ZONES.com, ZONES.ind]) {
      const up = h('i', { class: 'cc-dem-up' });
      const down = h('i', { class: 'cc-dem-down' });
      const word = h('span', { class: 'cc-dem-word' });
      const row = h(
        'div',
        { class: 'cc-dem-row' },
        h('span', { class: 'cc-dem-badge', text: z.short }),
        h('span', { class: 'cc-dem-name', text: z.name }),
        h('span', { class: 'cc-dem-track' }, down, up),
        word,
      );
      setStyle(row, '--accent', z.color);
      demandBox.append(row);
      this.demand.push({ row, up, down, word });
    }

    this.jobs = h('dl', { class: 'cc-rep-grid' });
    this.power = meterRow('Grid load', 'is-power');
    this.powerNote = h('p', { class: 'cc-rep-note' });
    this.avgs = [meterRow('Land value', 'is-goodhigh'), meterRow('Crime'), meterRow('Pollution'), meterRow('Traffic')];

    this.wealthBar = TIER_SWATCHES.map((t) => {
      const seg = h('i');
      seg.style.setProperty('--sw', t.color);
      return seg;
    });
    this.wealthKey = h('div', { class: 'cc-rep-tierkey' });
    this.tierNote = h('p', { class: 'cc-rep-note' });
    this.wealthBox = h(
      'section',
      { class: 'cc-subpanel cc-rep-wealth', hidden: true },
      h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: 'Wealth' }), h('span', { class: 'cc-rep-hint', text: 'Data → Wealth' })),
      h('div', { class: 'cc-rep-tierbar', 'aria-hidden': 'true' }, ...this.wealthBar),
      this.wealthKey,
      this.tierNote,
    );

    d.body.append(
      h('div', { class: 'cc-rep-hero' }, h('span', { class: 'cc-rep-ico', html: icon('pop') }), h('div', null, this.pop, this.peak)),
      h('section', { class: 'cc-subpanel' }, this.approval.row),
      h(
        'section',
        { class: 'cc-subpanel' },
        h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: 'Demand' }), h('span', { class: 'cc-rep-hint', text: 'Build what is rising' })),
        demandBox,
      ),
      h('section', { class: 'cc-subpanel' }, h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: 'Work' })), this.jobs),
      this.wealthBox,
      h('section', { class: 'cc-subpanel' }, h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: 'Power' })), this.power.row, this.powerNote),
      h(
        'section',
        { class: 'cc-subpanel' },
        h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: 'Citywide averages' })),
        ...this.avgs.map((m) => m.row),
      ),
    );
    d.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) ctx.modals.close(this.el);
    });
  }

  get isOpen(): boolean {
    return this.ctx.modals.isOpen(this.el);
  }

  open(): void {
    this.ctx.modals.open(this.el);
    this.refresh();
  }

  refresh(): void {
    if (!this.isOpen) return;
    const w = this.ctx.game.world;
    const s = w.stats;
    setText(this.sub, `${w.cityName} · ${w.dateLabel()}`);
    setText(this.pop, groupInt(s.population));
    setText(this.peak, `residents · peak ${groupInt(w.maxPopulation)}`);

    const ap = Math.max(0, Math.min(100, s.approval));
    setText(this.approval.value, `${Math.round(ap)}% · ${ap >= 75 ? 'Thrilled' : ap >= 55 ? 'Content' : ap >= 35 ? 'Uneasy' : 'Furious'}`);
    setStyle(this.approval.fill, 'transform', `scaleX(${(ap / 100).toFixed(3)})`);
    this.approval.row.dataset.tone = ap >= 55 ? 'good' : ap >= 35 ? 'mid' : 'bad';

    const dv = [s.demand.res, s.demand.com, s.demand.ind];
    for (let i = 0; i < 3; i++) {
      const v = Math.max(-1, Math.min(1, dv[i]));
      const r = this.demand[i];
      setStyle(r.up, 'transform', `scaleX(${v > 0 ? v.toFixed(3) : 0})`);
      setStyle(r.down, 'transform', `scaleX(${v < 0 ? (-v).toFixed(3) : 0})`);
      setText(r.word, v > 0.5 ? 'Booming' : v > 0.15 ? 'Wanted' : v > -0.15 ? 'Steady' : v > -0.5 ? 'Weak' : 'Glut');
      setClass(r.row, 'is-neg', v < -0.15);
    }

    const jobs = s.jobsCom + s.jobsInd;
    const html =
      `<div><dt>${ZONES.com.name} jobs</dt><dd>${groupInt(s.jobsCom)}</dd></div>` +
      `<div><dt>${ZONES.ind.name} jobs</dt><dd>${groupInt(s.jobsInd)}</dd></div>` +
      `<div><dt>Employed</dt><dd>${groupInt(s.employed)} / ${groupInt(jobs)}</dd></div>` +
      `<div><dt>Unemployment</dt><dd class="${s.unemployment > 0.12 ? 'is-down' : 'is-up'}">${pct(s.unemployment)}</dd></div>` +
      `<div class="is-wide"><dt>Developed</dt><dd>${s.developed.res} R · ${s.developed.com} C · ${s.developed.ind} I</dd></div>` +
      `<div><dt>Abandoned</dt><dd class="${s.abandonedTiles > 0 ? 'is-down' : ''}">${s.abandonedTiles}</dd></div>` +
      // Ports and regional links (EXPANSION §6.2, §6.3): shown once they matter.
      (s.visitors > 0 ? `<div><dt>Visitors</dt><dd>${groupInt(s.visitors)}/mo</dd></div>` : '') +
      (s.edgeLinks > 0 || w.maxPopulation >= ROAD_KINDS[RoadKind.Highway].unlockPop
        ? `<div><dt>Regional links</dt><dd>${s.edgeLinks}/${EDGE_LINKS.cap}</dd></div>`
        : '');
    if (this.jobs.dataset.html !== html) {
      this.jobs.dataset.html = html;
      this.jobs.innerHTML = html;
    }

    // Wealth split over developed zone tiles, and the tiers' effect against an all-$ city.
    const tiers = s.wealth;
    const dev = tiers[0] + tiers[1] + tiers[2];
    setHidden(this.wealthBox, dev === 0);
    if (dev > 0) {
      let key = '';
      for (let i = 0; i < 3; i++) {
        const share = tiers[i] / dev;
        setStyle(this.wealthBar[i], 'flex-grow', share.toFixed(4));
        key += `<span class="cc-lg-sw" style="--sw:${TIER_SWATCHES[i].color}">${TIER_SWATCHES[i].label} ${pct(share)}</span>`;
      }
      if (this.wealthKey.dataset.html !== key) {
        this.wealthKey.dataset.html = key;
        this.wealthKey.innerHTML = key;
      }
      const te = s.tierEffect;
      const sign = (n: number) => (n < 0 ? MINUS : '+') + groupInt(Math.abs(n));
      setText(
        this.tierNote,
        tiers[1] + tiers[2] === 0
          ? 'Every block is $ so far. Schools, transit, parks and quiet lift them.'
          : `Tiers: ${sign(te.residents)} residents · ${sign(te.tax)} ${CURRENCY}/mo`,
      );
    }

    const load = s.powerSupply > 0 ? s.powerDemand / s.powerSupply : s.powerDemand > 0 ? 1.5 : 0;
    setText(this.power.value, `${groupInt(s.powerDemand)} / ${groupInt(s.powerSupply)} MW`);
    setStyle(this.power.fill, 'transform', `scaleX(${Math.min(1, load).toFixed(3)})`);
    this.power.row.dataset.tone = load > 1 ? 'bad' : load > 0.85 ? 'mid' : 'good';
    setText(
      this.powerNote,
      s.powerSupply === 0
        ? 'No power plants yet. Nothing develops without power.'
        : load > 1
          ? `Brownout: demand exceeds supply. ${s.unpoweredTiles} blocks are dark.`
          : s.unpoweredTiles > 0
            ? `${s.unpoweredTiles} developed blocks are off the grid. Connect them with roads or zones.`
            : `Grid healthy · ${pct(Math.max(0, 1 - load))} headroom.`,
    );

    const av = [s.avgLandValue, s.avgCrime, s.avgPollution, s.avgTraffic];
    for (let i = 0; i < 4; i++) {
      const v = Math.max(0, Math.min(1, av[i]));
      const m = this.avgs[i];
      setText(m.value, pct(v));
      setStyle(m.fill, 'transform', `scaleX(${v.toFixed(3)})`);
      const good = i === 0 ? v : 1 - v;
      m.row.dataset.tone = good > 0.62 ? 'good' : good < 0.35 ? 'bad' : 'mid';
    }
  }
}
