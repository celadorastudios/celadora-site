/* Cache-busting for the site's own CSS and JS.
 *
 * GitHub Pages serves this repo verbatim behind Cloudflare, which caches
 * stylesheets and scripts for hours while HTML refreshes in minutes. Ship
 * new HTML that depends on new CSS and, until the edge copy expires,
 * visitors get the new markup with the OLD stylesheet: unstyled elements,
 * images at full intrinsic size. The fix is to put a short content hash in
 * every link (site.css?v=1a2b3c4d), so a changed file is a new URL and
 * bypasses every cache at once.
 *
 *   node scripts/asset-versions.mjs           rewrite every ?v= to match the file
 *   node scripts/asset-versions.mjs --check   fail if any ?v= is missing or stale
 *
 * Run the first after editing any file in ASSETS. CI runs the second.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/* Own, editable assets. Not vendor/ or _ds/ (pinned, versioned by path) and
   not support.js (generated, rarely changes; add it here if that stops being true). */
const ASSETS = ['site.css', 'legal.css', 'analytics.js', 'contact.js', 'gallery.js'];

const hashOf = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 8);

const hashes = new Map(ASSETS.map((a) => [a, hashOf(a)]));

const pages = [
  ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')),
  ...fs.readdirSync(path.join(ROOT, 'regleur')).filter((f) => f.endsWith('.html')).map((f) => `regleur/${f}`),
];

/* (href|src)="/?name[?v=anything]" for each tracked asset */
const names = ASSETS.map((a) => a.replace('.', '\\.')).join('|');
const LINK = new RegExp(`((?:href|src)=")(/?)(${names})(?:\\?v=[^"]*)?(")`, 'g');

const problems = [];
let rewritten = 0;

for (const page of pages) {
  const file = path.join(ROOT, page);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(LINK, (_m, attr, slash, name, close) => `${attr}${slash}${name}?v=${hashes.get(name)}${close}`);
  if (after === before) continue;
  if (CHECK) {
    problems.push(page);
  } else {
    fs.writeFileSync(file, after);
    rewritten += 1;
  }
}

if (CHECK) {
  if (problems.length) {
    console.error(`asset-versions: FAIL. ${problems.length} page(s) link a CSS or JS file with a missing or stale ?v= hash:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('Run `npm run assets:version` and commit the result.');
    process.exit(1);
  }
  console.log(`asset-versions: OK (${pages.length} pages, ${ASSETS.length} assets)`);
} else {
  console.log(`asset-versions: updated ${rewritten} page(s)`);
}
