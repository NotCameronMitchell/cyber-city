// Turn dist-single/index.html into a page body for a claude.ai Artifact.
// The Artifact host supplies its own <!doctype>/<html>/<head>/<body> skeleton,
// so we emit only the title, font links, styles, markup and inline script.
// Usage: node scripts/artifact.mjs [out.html]
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('dist-single/index.html', 'utf8');
const out = process.argv[2] || 'dist-single/artifact.html';

const title = (src.match(/<title>[\s\S]*?<\/title>/) || ['<title>Cyber City</title>'])[0];
const fontLinks = [...src.matchAll(/<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]);
const styles = [...src.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...src.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
const body = (src.match(/<body[^>]*>([\s\S]*?)<\/body>/) || ['', ''])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').trim();

const page = [
  title,
  ...fontLinks,
  // A single deliberate dark look: pin the colour scheme and background for the host frame.
  '<style>:root{color-scheme:dark;background:#07060d}html,body{height:100%;background:#07060d}</style>',
  ...styles,
  body,
  ...scripts,
].join('\n');

writeFileSync(out, page);
console.log(`${out} written: ${(page.length / 1024).toFixed(1)} KB`);
