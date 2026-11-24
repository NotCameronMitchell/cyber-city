// The device class and the region default (docs/MEGACITY.md §3.11, §11.2 item 15).

import { afterEach, describe, expect, it } from 'vitest';
import { BENCH_MIN_RUN_MS, defaultRegion, deviceClass, deviceProfile, measureBench, readProfile, resetDeviceProfile, type DeviceProfile } from '../src/game/device';
import { Game } from '../src/game/game';

type Env = { fine: boolean; ua?: string; platform?: string; uaPlatform?: string; touch?: number; w: number; h: number; cores?: number; mem?: number };

function stub(e: Env) {
  const g = globalThis as Record<string, unknown>;
  const fine = { v: e.fine };
  g.matchMedia = (q: string) => ({ matches: q.includes('pointer: fine') ? fine.v : false });
  Object.defineProperty(g, 'navigator', {
    configurable: true,
    value: {
      userAgent: e.ua ?? '',
      platform: e.platform ?? '',
      maxTouchPoints: e.touch ?? 0,
      hardwareConcurrency: e.cores,
      deviceMemory: e.mem,
      userAgentData: e.uaPlatform ? { platform: e.uaPlatform } : undefined,
    },
  });
  g.screen = { width: e.w, height: e.h };
  resetDeviceProfile();
  return fine;
}

const saved = { nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.matchMedia;
  delete g.screen;
  if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav);
  delete (globalThis as { localStorage?: unknown }).localStorage;
  resetDeviceProfile();
});

const PHONE: Env = { fine: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', touch: 5, w: 390, h: 844, cores: 6 };
const TABLET: Env = { fine: false, ua: 'Mozilla/5.0 (Linux; Android 14; Tab)', uaPlatform: 'Android', touch: 10, w: 800, h: 1280, cores: 8, mem: 8 };
const IPAD_TRACKPAD: Env = { fine: true, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', touch: 5, w: 1024, h: 1366, cores: 8 };
const ANDROID_MOUSE: Env = { fine: true, ua: 'Mozilla/5.0 (Linux; Android 13)', uaPlatform: 'Android', touch: 10, w: 1200, h: 1920, cores: 8, mem: 8 };
const DESKTOP: Env = { fine: true, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', uaPlatform: 'Windows', w: 1920, h: 1080, cores: 4, mem: 8 };
const TOUCH_LAPTOP: Env = { ...DESKTOP, touch: 10 };
const CHROMEBOOK: Env = { fine: true, ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', uaPlatform: 'Chrome OS', w: 1366, h: 768, cores: 4, mem: 4 };

describe('device class and region default (§3.11)', () => {
  it('phones, tablets, an iPad with a trackpad and an Android tablet with a mouse are handheld and default to 3', () => {
    for (const e of [PHONE, TABLET, IPAD_TRACKPAD, ANDROID_MOUSE]) {
      stub(e);
      expect(deviceClass(), e.ua).toBe('handheld');
      expect(defaultRegion(), e.ua).toBe(3);
    }
  });
  it('a 4-core desktop, a touchscreen laptop and a Chromebook are PCs and default to 5', () => {
    for (const e of [DESKTOP, TOUCH_LAPTOP, CHROMEBOOK]) {
      stub(e);
      expect(deviceClass(), e.ua).toBe('pc');
      expect(defaultRegion(), e.ua).toBe(5);
    }
  });
  it('2 cores, 2 GB or a bench factor of 2.5 default to 3', () => {
    stub({ ...DESKTOP, cores: 2 });
    expect(defaultRegion()).toBe(3);
    stub({ ...DESKTOP, mem: 2 });
    expect(defaultRegion()).toBe(3);
    stub(DESKTOP);
    const p: DeviceProfile = { ...readProfile(), benchFactor: 2.5 };
    expect(defaultRegion(p)).toBe(3);
    expect(defaultRegion({ ...p, benchFactor: 1.2 })).toBe(5);
  });
  it('a mouse connected or removed mid-session changes neither the class nor game.lowerDetail', () => {
    const fine = stub(PHONE);
    expect(deviceClass()).toBe('handheld');
    fine.v = true;
    expect(deviceClass()).toBe('handheld');
    expect(deviceProfile().finePointer).toBe(false);
    const g = new Game();
    g.newCity('Five', 1, 5);
    const before = g.lowerDetail;
    fine.v = false;
    expect(g.lowerDetail).toBe(before);
  });
  it('the first 5×5 load writes settings.lowerDetail once from the class; the player\'s value wins; 3×3 is never lower detail', () => {
    const m = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    stub(PHONE);
    const g = new Game();
    g.newCity('Three', 1, 3);
    expect(g.lowerDetail).toBe(false);
    expect(g.settings.lowerDetail).toBeUndefined();
    g.newCity('Five', 2, 5);
    expect(g.settings.lowerDetail).toBe(true);
    expect(g.lowerDetail).toBe(true);
    g.updateSettings({ lowerDetail: false });
    g.newCity('Five again', 3, 5);
    expect(g.lowerDetail).toBe(false);
    g.updateSettings({ lowerDetail: true });
    g.newCity('Three again', 4, 3);
    expect(g.lowerDetail).toBe(false);
    // A PC writes it off.
    m.clear();
    stub(DESKTOP);
    const pc = new Game();
    pc.newCity('PC Five', 5, 5);
    expect(pc.settings.lowerDetail).toBe(false);
  });
  it('the lower-detail notice shows once per city per device', () => {
    const m = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    stub(PHONE);
    const g = new Game();
    const toasts: string[] = [];
    g.events.on('toast', (t) => toasts.push(t.text));
    g.newCity('Five', 77, 5);
    g.update(0.1);
    expect(toasts.filter((t) => t.startsWith('Big city, small screen'))).toHaveLength(1);
    g.save();
    const g2 = new Game();
    const t2: string[] = [];
    g2.events.on('toast', (t) => t2.push(t.text));
    g2.update(0.1);
    expect(t2.filter((t) => t.startsWith('Big city, small screen'))).toHaveLength(0);
  });
});

describe('the micro-benchmark (§3.11)', () => {
  it('returns null with a 16 ms timer and a factor within 5% of the truth with a 1 ms one', () => {
    // A fake clock: each `work` call costs 3 ms of fake time (half the 6 ms Node reference: factor 0.5).
    const make = (step: number) => {
      let t = 0;
      let real = 0;
      const now = () => Math.floor((t += 0.0001) / step) * step + Math.floor(real / step) * step;
      const work = () => void (real += 3);
      return { now, work };
    };
    const coarse = make(16);
    expect(measureBench(coarse.now, coarse.work)).toBeNull();
    const fine = make(1);
    const f = measureBench(fine.now, fine.work)!;
    expect(Math.abs(f - 0.5) / 0.5).toBeLessThan(0.05);
    expect(BENCH_MIN_RUN_MS).toBe(50);
  });
});
