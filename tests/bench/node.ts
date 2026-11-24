// Node reference for the device check (docs/MEGACITY.md §12 Step 0b, §11.6): the same scenarios as bench.html.
// Build and run: node tests/bench/build.mjs --node && node <out>/bench-node.mjs [ids…] [--quick]
import { FULL, QUICK, SCENARIOS, measureMicro, runScenario, type ScenarioResult } from './scenarios';

/** Node's process (no @types/node in this repo). */
const proc = (globalThis as unknown as { process: { argv: string[]; version: string } }).process;
const args: string[] = proc.argv.slice(2);
const quick = args.includes('--quick');
const ids = args.filter((a) => !a.startsWith('--'));
const now = () => performance.now();

async function main(): Promise<void> {
  const micro = [measureMicro(now), measureMicro(now), measureMicro(now)];
  const results: ScenarioResult[] = [];
  for (const spec of SCENARIOS) {
    if (ids.length && !ids.includes(spec.id)) continue;
    results.push(await runScenario(spec, quick ? QUICK : FULL, { now, storage: null, log: (s) => console.error(s) }));
  }
  console.log(JSON.stringify({ env: 'node', version: proc.version, quick, micro, results }));
}
void main();
