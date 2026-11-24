// bench.html's script (docs/MEGACITY.md §12 Step 0b "Device check", §11.6 owner checklist rows 1–2): runs the
// scenarios on this device and shows a JSON report to copy. Not part of the game build.
//
// Query: ?auto=1 runs everything at once; ?quick=1 uses the short sizes; ?only=r3-9,r5-25 picks scenarios;
// ?quota=1 also probes the localStorage quota (it fills and then clears this page's storage).
import { PINNED, SEEDS, terrainHash } from '../terrain-hash';
import { FULL, QUICK, SCENARIOS, measureMicro, measureSetItem, runScenario, type ScenarioResult } from './scenarios';

const out = document.getElementById('out') as HTMLPreElement;
const status = document.getElementById('status') as HTMLElement;
const q = new URLSearchParams(location.search);
const now = () => performance.now();
const pause = () => new Promise<void>((r) => setTimeout(r, 0));
const log = (s: string) => {
  status.textContent = s;
};

/** Fill localStorage with 256 K-character strings until it refuses; return the characters stored. Clears them after. */
function quotaProbe(): { chars: number; note: string } {
  const keys: string[] = [];
  let chars = 0;
  let size = 256 * 1024;
  const chunk = 'x'.repeat(size);
  let note = 'ok';
  try {
    for (let i = 0; i < 400; i++) {
      const k = `cybercity.bench.quota.${i}`;
      try {
        localStorage.setItem(k, chunk.slice(0, size));
        keys.push(k);
        chars += size;
      } catch {
        if (size <= 1024) break;
        size = size >> 1; // narrow down to the last 1 K
        i--;
      }
    }
  } catch (e) {
    note = String(e);
  }
  for (const k of keys) localStorage.removeItem(k);
  return { chars, note };
}

interface Report {
  env: 'browser';
  ua: string;
  cores: number | null;
  memoryGB: number | null;
  quick: boolean;
  micro: ReturnType<typeof measureMicro>[];
  setItem: ReturnType<typeof measureSetItem>;
  quota: { chars: number; note: string } | null;
  /** §11.2 item 17: the terrain golden hashes on this engine, and whether they equal the ones pinned in Node. */
  terrain: { hashes: string[][]; match: boolean } | null;
  results: ScenarioResult[];
  done: boolean;
  error?: string;
}

async function run(): Promise<void> {
  const quick = q.get('quick') === '1';
  const only = (q.get('only') ?? '').split(',').filter(Boolean);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const report: Report = {
    env: 'browser',
    ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGB: nav.deviceMemory ?? null,
    quick,
    micro: [],
    setItem: {},
    quota: null,
    terrain: null,
    results: [],
    done: false,
  };
  (window as unknown as { benchReport: Report }).benchReport = report;
  const show = () => {
    out.textContent = JSON.stringify(report, null, 1);
  };
  try {
    log('micro-benchmark…');
    await pause();
    for (let i = 0; i < 3; i++) report.micro.push(measureMicro(now));
    show();
    log('terrain hashes…');
    await pause();
    const hashes = SEEDS.map((sd) => [terrainHash(sd, 3), terrainHash(sd, 5)]);
    report.terrain = { hashes, match: JSON.stringify(hashes) === JSON.stringify(PINNED) };
    show();
    log('localStorage.setItem…');
    await pause();
    const env = { now, storage: localStorage, pause, log };
    report.setItem = measureSetItem(env);
    show();
    for (const spec of SCENARIOS) {
      if (only.length && !only.includes(spec.id)) continue;
      log(`${spec.id}…`);
      await pause();
      report.results.push(await runScenario(spec, quick ? QUICK : FULL, env));
      show();
    }
    if (q.get('quota') === '1') {
      log('quota probe…');
      await pause();
      report.quota = quotaProbe();
    }
    report.done = true;
    log('done: copy the report below');
  } catch (e) {
    report.error = String((e as Error)?.stack ?? e);
    log(`failed: ${report.error}`);
  }
  show();
}

(document.getElementById('run') as HTMLButtonElement).onclick = () => void run();
if (q.get('auto') === '1') void run();
