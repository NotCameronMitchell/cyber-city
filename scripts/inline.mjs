// Turns the Vite build (dist/) into one self-contained HTML file
// (dist-single/index.html) that runs from file:// or inside a sandboxed iframe.
//
//   • local <script type="module" src> and <link rel="stylesheet" href> are inlined
//   • manifest / icon / apple-touch-icon links are dropped (no files to point at)
//   • the SVG icon is embedded as a data: URI favicon
//   • remote resources (the Google Fonts stylesheet) are left as they are
//
// The service-worker registration in the bundle stays: it only runs on
// https/localhost top-level pages, so it is a no-op for the single file.
//
// Usage: vite build && node scripts/inline.mjs

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'dist-single');
const htmlPath = join(dist, 'index.html');

if (!existsSync(htmlPath)) {
  console.error('dist/index.html not found: run `vite build` first.');
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');

const isLocal = (url) => !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) && !url.startsWith('data:');
const localFile = (url) => {
  const clean = url.split(/[?#]/)[0].replace(/^\.?\//, '');
  const file = join(dist, clean);
  if (!existsSync(file)) throw new Error(`Referenced file missing from dist/: ${url}`);
  return file;
};
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};

/** Keep inlined code from closing the <script>/<style> element early. */
const safeScript = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const safeStyle = (css) => css.replace(/<\/(style)/gi, '<\\/$1');

let scripts = 0;
let styles = 0;

// 1. Local stylesheets → <style>.
html = html.replace(/<link\b[^>]*>/gi, (tag) => {
  const rel = (attr(tag, 'rel') || '').toLowerCase();
  const href = attr(tag, 'href');
  if (rel === 'stylesheet' && href && isLocal(href)) {
    styles++;
    return `<style>\n${safeStyle(readFileSync(localFile(href), 'utf8'))}\n</style>`;
  }
  // 2. Links to files the single file cannot carry.
  if (['manifest', 'icon', 'apple-touch-icon', 'shortcut icon', 'mask-icon', 'modulepreload'].includes(rel) && href && isLocal(href)) {
    return '';
  }
  return tag;
});

// 3. Embedded favicon.
const iconPath = join(dist, 'icon.svg');
if (existsSync(iconPath)) {
  const svg = readFileSync(iconPath, 'utf8');
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  html = html.replace(/<\/title>/i, `</title>\n    <link rel="icon" type="image/svg+xml" href="${uri}" />`);
}

// 4. Tidy blank lines left by removed tags.
html = html.replace(/\n[ \t]*\n(?=[ \t]*<)/g, '\n');

// 5. Module scripts with a local src (last, so no regex above scans bundled code) → inline module scripts.
html = html.replace(/<script\b[^>]*\bsrc\s*=\s*[^>]*>\s*<\/script>/gi, (tag) => {
  const src = attr(tag, 'src');
  if (!src || !isLocal(src)) return tag;
  const type = attr(tag, 'type') || 'module';
  const code = readFileSync(localFile(src), 'utf8');
  scripts++;
  return `<script type="${type}">\n${safeScript(code)}\n</script>`;
});

// Sanity: nothing local may remain referenced.
const leftovers = [...html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=\s*["']?(\.?\/?(?:assets\/)[^"'\s>]+)/gi)].map((m) => m[1]);
if (leftovers.length) {
  console.error('Unresolved local references:', leftovers);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'index.html');
writeFileSync(outPath, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`dist-single/index.html written: ${kb} KB (${scripts} script, ${styles} stylesheet inlined)`);
