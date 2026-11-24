// Build the device-check page (docs/MEGACITY.md §12 Step 0b "Device check", §11.6). Not part of the game build.
//
//   node tests/bench/build.mjs [--out dir] [--single] [--node] [--proto name=dir …]
//
// Writes <out>/bench.html + bench.js (today's code, the §2.8 scenarios on real regions); --single also writes
// bench-single.html with the script inlined (open it from anywhere, e.g. on a phone); --node also writes
// bench-node.mjs (the Node reference, `node <out>/bench-node.mjs [ids…] [--quick]`); each --proto name=dir bundles
// tests/bench/proto.js against a scratch prototype tree (<dir>/src, MAP_SIZE patched) as proto-<name>.html/.js and
// proto-<name>-node.mjs. Serve <out> with any static server (e.g. `npx vite preview --outDir <out>`) and open
// bench.html?auto=1 (add &quick=1 for a short run, &quota=1 for the storage quota probe).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = resolve(opt('--out', join(here, '..', '..', 'dist-bench')));
mkdirSync(out, { recursive: true });

// es2020: the game's own build target (vite.config.ts), so the page runs the sim as the game ships it.
const base = { bundle: true, logLevel: 'warning', target: 'es2020', define: { 'import.meta.env.DEV': 'false' } };
const common = base;
await build({ ...common, entryPoints: [join(here, 'page.ts')], outfile: join(out, 'bench.js'), format: 'iife', platform: 'browser' });
copyFileSync(join(here, 'bench.html'), join(out, 'bench.html'));
if (args.includes('--single')) {
  const js = readFileSync(join(out, 'bench.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const html = readFileSync(join(here, 'bench.html'), 'utf8').replace('<script src="./bench.js"></script>', () => `<script>${js}</script>`);
  writeFileSync(join(out, 'bench-single.html'), html);
}
if (args.includes('--node'))
  await build({ ...common, entryPoints: [join(here, 'node.ts')], outfile: join(out, 'bench-node.mjs'), format: 'esm', platform: 'node' });
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--proto') continue;
  const [name, dir] = args[i + 1].split('=');
  // es2022 keeps class fields native: lowered to defineProperty (es2020, the game's own target) the prototype's sim
  // ran ≈ 1.7× slower in Node (today's code is unaffected; see MEGACITY §11.6), and §2.8 measured it unlowered.
  const alias = { '@proto': resolve(dir, 'src') };
  const common = { ...base, target: 'es2022' };
  await build({ ...common, alias, entryPoints: [join(here, 'proto.js')], outfile: join(out, `proto-${name}.js`), format: 'iife', platform: 'browser' });
  await build({ ...common, alias, entryPoints: [join(here, 'proto.js')], outfile: join(out, `proto-${name}-node.mjs`), format: 'esm', platform: 'node' });
  const html = readFileSync(join(here, 'bench.html'), 'utf8').replace('./bench.js', `./proto-${name}.js`).replace('<h1>Cyber City device bench</h1>', `<h1>Cyber City prototype bench (${name})</h1>`);
  writeFileSync(join(out, `proto-${name}.html`), html);
}
console.log(`bench written to ${out}`);
