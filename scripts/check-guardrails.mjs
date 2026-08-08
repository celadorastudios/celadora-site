/* Static invariants for celadora.net.
 *
 * Every rule here exists because the thing it forbids actually happened, or
 * because a legal page asserts it is true. A privacy policy that promises no
 * third-party CDN is a liability the moment someone pastes a Google Fonts
 * @import back in, and nothing else in the repo would notice.
 *
 * Zero dependencies, so this runs before any npm install and is the fastest
 * signal on a PR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'privacy.html', 'terms.html', 'accessibility.html'];

const failures = [];
const fail = (rule, detail) => failures.push({ rule, detail });
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/* Every file a browser is served, so a rule can't be dodged by moving code. */
function servedFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (['.git', 'node_modules', 'scripts', '.github'].includes(e.name)) continue;
        walk(rel);
      } else if (/\.(html|css|js)$/.test(e.name)) {
        out.push(rel);
      }
    }
  };
  walk('');
  return out;
}

const FILES = servedFiles();

/* ---------------------------------------------------------------- rule 1
 * No third-party CDN. privacy.html and accessibility.html both state that
 * fonts, icons and scripts come from this domain.
 *
 * unpkg.com is allowed to appear ONLY as a key in the window.__resources
 * remap in index.html — those are strings support.js matches against, never
 * fetched. Anywhere else it is a real request.
 */
const BANNED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

for (const file of FILES) {
  const src = read(file);
  for (const host of BANNED_HOSTS) {
    if (!src.includes(host)) continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!line.includes(host)) return;

      // The window.__resources map in index.html lists unpkg URLs as KEYS —
      // strings support.js matches against, never fetched.
      const isRemapKey = file === 'index.html' && host === 'unpkg.com'
        && /^\s*"https:\/\/unpkg\.com\/[^"]+":\s*"\/vendor\//.test(line);
      if (isRemapKey) return;

      // support.js is generated (see its header) and declares the CDN URLs as
      // fallback constants. Banning the string would only force this rule to
      // be weakened, so instead the constants are allowed here and rule 1b
      // below proves each one is actually remapped away.
      const isGeneratedFallback = file === 'support.js'
        && /^\s*var [A-Z_]+_URL = "https:\/\/unpkg\.com\//.test(line);
      if (isGeneratedFallback) return;

      fail('no-third-party-cdn', `${file}:${i + 1} references ${host}`);
    });
  }
}

/* rule 1b — every CDN URL support.js could fetch must be remapped to a local
 * file in index.html, and that file must exist. This is what actually keeps
 * the page off unpkg; deleting the remap is the realistic regression.
 *
 * BABEL_URL is deliberately exempt: it is lazily loaded by ensureBabel() only
 * when a component needs JSX compiled at runtime, which this site never does.
 * check-privacy.mjs asserts at runtime that nothing reaches unpkg, so if that
 * assumption ever breaks, the browser check fails even though this one passes.
 */
const LAZY_UNUSED = ['BABEL_URL'];
const support = read('support.js');
const indexSrc = read('index.html');

for (const m of support.matchAll(/var ([A-Z_]+_URL) = "(https:\/\/unpkg\.com\/[^"]+)"/g)) {
  const [, name, url] = m;
  if (LAZY_UNUSED.includes(name)) continue;
  const remap = indexSrc.match(new RegExp(`"${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"(/vendor/[^"]+)"`));
  if (!remap) {
    fail('cdn-remapped', `${name} (${url}) has no window.__resources entry in index.html`);
  } else if (!exists(remap[1].replace(/^\//, ''))) {
    fail('cdn-remapped', `${name} remaps to ${remap[1]}, which does not exist`);
  }
}

/* Remote @import inside the design system is how Google Fonts got in. */
for (const file of FILES.filter((f) => f.endsWith('.css'))) {
  const m = read(file).match(/@import\s+url\(\s*['"]?https?:/i);
  if (m) fail('no-remote-css-import', `${file} has a remote @import`);
}

/* ---------------------------------------------------------------- rule 2
 * No unfilled placeholders. [FULL LEGAL NAME] and [N] months both nearly
 * shipped.
 */
for (const file of FILES.filter((f) => f.endsWith('.html'))) {
  const m = read(file).match(/\[(?:[A-Z][A-Z ]{2,}|N)\]/g);
  if (m) fail('no-placeholders', `${file} still contains ${[...new Set(m)].join(', ')}`);
}

/* ---------------------------------------------------------------- rule 3
 * Accessibility claims the legal pages make about themselves.
 */
for (const page of PAGES) {
  const src = read(page);
  if (!/<html[^>]+lang=/.test(src)) fail('lang-attribute', `${page} has no lang (WCAG 3.1.1)`);
  if (!/<main[\s>]/.test(src)) fail('main-landmark', `${page} has no <main> landmark`);

  // Decorative icon fonts announce as garbage without aria-hidden.
  const icons = src.match(/<i class="ph[^"]*"(?![^>]*aria-hidden)/g);
  if (icons) fail('icons-aria-hidden', `${page} has ${icons.length} Phosphor <i> without aria-hidden`);
}

/* ---------------------------------------------------------------- rule 4
 * Consent has to be reachable and withdrawable from every page, and the
 * privacy policy says the control is in every footer.
 */
for (const page of PAGES) {
  const src = read(page);
  if (!src.includes('analytics.js')) fail('consent-everywhere', `${page} does not load analytics.js`);
  if (!src.includes('data-consent-settings')) fail('consent-withdrawable', `${page} has no consent-settings control`);
  for (const target of ['privacy.html', 'terms.html', 'accessibility.html']) {
    if (!src.includes(target)) fail('legal-footer', `${page} does not link ${target}`);
  }
}

/* PostHog must never be initialised outside the consent gate. */
for (const file of FILES.filter((f) => f !== 'analytics.js')) {
  if (/posthog\.init\s*\(/.test(read(file))) {
    fail('posthog-gated', `${file} calls posthog.init outside analytics.js`);
  }
}

/* ---------------------------------------------------------------- rule 5
 * Vendored assets must actually be present — a broken path here is the blank
 * home page all over again.
 */
const VENDOR = [
  'vendor/react/react.production.min.js',
  'vendor/react/react-dom.production.min.js',
  'vendor/phosphor/regular/style.css',
  'vendor/phosphor/regular/Phosphor.woff2',
  'vendor/phosphor/fill/style.css',
  'vendor/phosphor/fill/Phosphor-Fill.woff2',
  'vendor/inter/inter.css'
];
for (const v of VENDOR) {
  if (!exists(v)) fail('vendor-present', `missing ${v}`);
  else if (fs.statSync(path.join(ROOT, v)).size === 0) fail('vendor-present', `${v} is empty`);
}

/* ---------------------------------------------------------------- rule 6
 * Internal links resolve. Cheap, and catches a renamed page.
 */
for (const page of PAGES) {
  const src = read(page);
  for (const m of src.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
    const target = m[1] === '/' ? 'index.html' : m[1].replace(/^\//, '');
    if (!exists(target)) fail('internal-links', `${page} links ${m[1]} which does not exist`);
  }
}

/* ------------------------------------------------------------------ report */
const rules = new Set(failures.map((f) => f.rule));
if (failures.length === 0) {
  console.log(`guardrails: OK (${FILES.length} served files checked)`);
  process.exit(0);
}
console.error(`guardrails: ${failures.length} failure(s) across ${rules.size} rule(s)\n`);
for (const rule of rules) {
  console.error(`  [${rule}]`);
  for (const f of failures.filter((x) => x.rule === rule)) console.error(`    - ${f.detail}`);
}
process.exit(1);
