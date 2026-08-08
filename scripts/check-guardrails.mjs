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
const PAGES = [
  'index.html',
  'claude-o-meter.html',
  'partsbin.html',
  'privacy.html',
  'terms.html',
  'accessibility.html'
];

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
 * remap in index.html. Those are strings support.js matches against, never
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

      // A window.__resources map lists unpkg URLs as KEYS: strings support.js
      // matches against, never fetched. Valid on any page that loads the
      // runtime, not just whichever page happens to be the home page today.
      const isRemapKey = host === 'unpkg.com'
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

/* rule 1b: every CDN URL support.js could fetch must be remapped to a local
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
const cdnUrls = [...support.matchAll(/var ([A-Z_]+_URL) = "(https:\/\/unpkg\.com\/[^"]+)"/g)]
  .filter(([, name]) => !LAZY_UNUSED.includes(name));

// Checked per page that actually loads the runtime. A new product page that
// pulls in support.js without the remap would otherwise hit unpkg silently.
const runtimePages = PAGES.filter((p) => /<script[^>]+src="\.?\/?support\.js"/.test(read(p)));
if (runtimePages.length === 0) {
  console.log('note: no page loads support.js; the CDN remap rule has nothing to check');
}

for (const page of runtimePages) {
  const src = read(page);
  for (const [, name, url] of cdnUrls) {
    const remap = src.match(new RegExp(`"${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"(/vendor/[^"]+)"`));
    if (!remap) {
      fail('cdn-remapped', `${page} loads support.js but has no window.__resources entry for ${name}`);
    } else if (!exists(remap[1].replace(/^\//, ''))) {
      fail('cdn-remapped', `${page} remaps ${name} to ${remap[1]}, which does not exist`);
    }
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

/* ---------------------------------------------------------------- rule 4b
 * Analytics is per-page. This is a static multi-page site, so nothing carries
 * between page loads: a page that forgets analytics.js is a page with no
 * consent gate AND no traffic counted. The Cloudflare beacon now lives in
 * analytics.js so there is one token, and pasting it back into a page would
 * double-count and reintroduce the drift.
 */
for (const page of PAGES) {
  if (/cloudflareinsights/.test(read(page))) {
    fail('cf-beacon-centralised', `${page} inlines the Cloudflare beacon; it belongs in analytics.js`);
  }
}
if (!/cloudflareinsights/.test(read('analytics.js'))) {
  fail('cf-beacon-centralised', 'analytics.js no longer loads the Cloudflare beacon, so no page does');
}

/* ---------------------------------------------------------------- rule 4c
 * SEO basics, which are easy to add once and easy to forget on page seven.
 */
const SITE = 'https://celadora.net';
const sitemap = read('sitemap.xml');
for (const page of PAGES) {
  const src = read(page);
  const url = page === 'index.html' ? '/' : '/' + page;

  if (!src.includes(`<link rel="canonical" href="${SITE}${url}">`)) {
    fail('seo-canonical', `${page} has no canonical pointing at ${SITE}${url}`);
  }
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card']) {
    if (!src.includes(tag)) fail('seo-social', `${page} is missing ${tag}`);
  }
  if (!sitemap.includes(`<loc>${SITE}${url}</loc>`)) {
    fail('seo-sitemap', `${page} is not listed in sitemap.xml`);
  }
  const desc = src.match(/<meta name="description" content="([^"]*)"/);
  if (!desc) fail('seo-description', `${page} has no meta description`);
  else if (desc[1].length < 50 || desc[1].length > 200) {
    fail('seo-description', `${page} description is ${desc[1].length} chars (want 50-200)`);
  }

  /* Link previews. A share card is the first thing most people see of this
   * site, and it fails silently: the page looks fine, the preview is blank,
   * and nobody tells you. So the image has to exist on disk, not merely be
   * named, and it needs alt text because previews are read aloud too. */
  const og = src.match(/<meta property="og:image" content="https:\/\/celadora\.net(\/[^"]+)"/);
  if (!og) fail('og-image', `${page} has no absolute og:image on celadora.net`);
  else if (!exists(og[1].replace(/^\//, ''))) {
    fail('og-image', `${page} points og:image at ${og[1]}, which is not in the repo`);
  }
  if (!/<meta property="og:image:alt" content="[^"]{20,}"/.test(src)) {
    fail('og-image', `${page} has no meaningful og:image:alt`);
  }
  for (const tag of ['apple-touch-icon', 'theme-color']) {
    if (!src.includes(tag)) fail('og-icons', `${page} is missing ${tag}`);
  }
}
if (!exists('robots.txt')) fail('seo-robots', 'robots.txt is missing');
else if (!read('robots.txt').includes(`Sitemap: ${SITE}/sitemap.xml`)) {
  fail('seo-robots', 'robots.txt does not point at the sitemap');
}

/* ---------------------------------------------------------------- rule 4d
 * Everything the site links to now lives under celadorastudios: the studio
 * profile and every repo. NOT_YET_MOVED is the escape hatch for a repo that
 * is still hosted elsewhere; it is empty because the migration is complete,
 * and it should only ever be non-empty while a move is in flight.
 *
 * A link that is neither the profile nor a celadorastudios repo is almost
 * certainly a copy-paste that will rot, so it fails rather than being
 * quietly tolerated.
 */
const GITHUB_PROFILE = 'https://github.com/celadorastudios';
const NOT_YET_MOVED = [];

for (const file of FILES) {
  read(file).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/https:\/\/github\.com\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?)/g)) {
      const target = m[1];
      if (m[0] === GITHUB_PROFILE) continue;              // the studio profile
      if (NOT_YET_MOVED.includes(target)) continue;       // still hosted there
      if (target.startsWith('celadorastudios/')) continue; // already moved
      fail('github-account',
           `${file}:${i + 1} links github.com/${target}; expected the celadorastudios profile, ` +
           'a celadorastudios repo, or a repo listed in NOT_YET_MOVED');
    }
  });
}

/* ---------------------------------------------------------------- rule 4e
 * The catalogue counter is prose, so nothing stops it drifting from the cards
 * it counts. "2 tools" beside three cards is the kind of small lie a visitor
 * notices immediately.
 */
{
  const home = read('index.html');
  const cards = (home.match(/<article class="product-card">/g) || []).length;
  const counter = home.match(/<span class="count">\s*(\d+)\s+tools?/);
  if (!counter) {
    fail('product-count', 'index.html has no "<n> tools" counter to check against the cards');
  } else if (Number(counter[1]) !== cards) {
    fail('product-count', `index.html says ${counter[1]} tools but renders ${cards} product cards`);
  }

  // Each card needs a status, and only from the set site.css can actually style.
  const STATUSES = ['status-available', 'status-beta', 'status-building'];
  const chips = home.match(/class="status ([a-z-]+)"/g) || [];
  if (chips.length !== cards) {
    fail('product-status', `${cards} product cards but ${chips.length} status chips`);
  }
  for (const chip of chips) {
    const cls = chip.match(/status ([a-z-]+)/)[1];
    if (!STATUSES.includes(cls)) fail('product-status', `unknown status chip "${cls}"`);
    if (!read('site.css').includes('.' + cls)) fail('product-status', `.${cls} has no style in site.css`);
  }
}

/* PostHog must never be initialised outside the consent gate. */
for (const file of FILES.filter((f) => f !== 'analytics.js')) {
  if (/posthog\.init\s*\(/.test(read(file))) {
    fail('posthog-gated', `${file} calls posthog.init outside analytics.js`);
  }
}

/* ---------------------------------------------------------------- rule 5
 * Vendored assets must actually be present, because a broken path here is the blank
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
