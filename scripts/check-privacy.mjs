/* Behavioural checks against a real browser.
 *
 * The static guardrails prove the source doesn't mention a third party. These
 * prove the running page doesn't contact one, which is the claim the privacy
 * policy actually makes. Two regressions this would have caught:
 *
 *   1. PostHog's loader being fetched before consent — the snippet pulls
 *      array.js from PostHog's CDN even while opted out, disclosing the
 *      visitor's IP before they agreed to anything.
 *   2. The home page rendering blank when a CDN is unreachable, which the
 *      accessibility page once claimed could not happen.
 */
import puppeteer from 'puppeteer';
import { start } from './serve.mjs';

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
const CONSENT_KEY = 'celadora-analytics-consent';

const THIRD_PARTY = [/posthog/i, /unpkg\.com/i, /fonts\.googleapis\.com/i, /fonts\.gstatic\.com/i];
const PAGES = ['/', '/privacy.html', '/terms.html', '/accessibility.html'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
};

/**
 * Loads a page in an ISOLATED browser context and returns every third-party
 * host it contacted.
 *
 * The isolation is load-bearing, not tidiness: localStorage is shared across
 * pages of one browser, so a check that seeds consent would silently decide
 * the outcome of every check after it — which is exactly how the
 * banner-shown-when-undecided assertion first went green against a browser
 * that had already been told "granted".
 */
async function visit(browser, url, { consent = null, block = null } = {}) {
  const context = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  const page = await context.newPage();
  page.__context = context;
  const seen = [];

  if (block) {
    await page.setRequestInterception(true);
    page.on('request', (r) => (block.test(r.url()) ? r.abort() : r.continue()));
  }
  page.on('request', (r) => {
    const u = r.url();
    if (THIRD_PARTY.some((re) => re.test(u))) seen.push(u);
  });

  if (consent !== null) {
    await page.evaluateOnNewDocument((key, state) => {
      localStorage.setItem(key, JSON.stringify({ state, ts: Date.now(), version: '2026-08-08' }));
    }, CONSENT_KEY, consent);
  }

  await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 30000 });
  return { page, seen };
}

const server = await start(PORT);
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  // 1. No third party is contacted on a first visit to any page.
  for (const url of PAGES) {
    const { page, seen } = await visit(browser, url);
    check(`no third-party contact on first visit to ${url}`, seen.length === 0, seen.slice(0, 3).join(', '));
    await page.close(); await page.__context.close();
  }

  // 2. Declining keeps it that way.
  {
    const { page, seen } = await visit(browser, '/', { consent: 'denied' });
    check('declined consent contacts nobody', seen.length === 0, seen.slice(0, 3).join(', '));
    await page.close(); await page.__context.close();
  }

  // 3. Granting consent actually enables PostHog — the gate has to work in
  //    both directions, or "granted" silently means nothing.
  {
    const { page, seen } = await visit(browser, '/', { consent: 'granted' });
    check('granted consent loads PostHog', seen.some((u) => /posthog/i.test(u)));
    await page.close(); await page.__context.close();
  }

  // 4. The consent banner appears when undecided, and not once decided.
  {
    const { page } = await visit(browser, '/');
    check('banner shown when undecided', (await page.$('.consent-banner')) !== null);
    await page.close(); await page.__context.close();

    const decided = await visit(browser, '/', { consent: 'denied' });
    check('banner hidden once decided', (await decided.page.$('.consent-banner')) === null);
    await decided.page.close(); await decided.page.__context.close();
  }

  // 5. Every page renders real content. Catches the blank-page failure.
  for (const url of PAGES) {
    const { page } = await visit(browser, url);
    const heading = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => '');
    check(`${url} renders an h1`, heading.length > 0, heading.slice(0, 40));
    await page.close(); await page.__context.close();
  }

  // 6. The home page still renders with a CDN blocked. It is self-hosted now,
  //    so nothing external should be load-bearing.
  {
    const { page } = await visit(browser, '/', { block: /unpkg\.com|fonts\.g/i });
    const heading = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => '');
    check('home page renders with external CDNs blocked', heading.length > 0, heading.slice(0, 40));
    await page.close(); await page.__context.close();
  }

  // 7. The contact address must survive with JavaScript disabled — it is the
  //    channel for GDPR and CCPA rights requests.
  {
    const ctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
    const page = await ctx.newPage();
    page.__context = ctx;
    await page.setJavaScriptEnabled(false);
    await page.goto(BASE + '/privacy.html', { waitUntil: 'domcontentloaded' });
    const text = await page.$eval('[data-contact-email]', (el) => el.textContent.trim()).catch(() => '');
    check('contact address readable without JS', /celadora\.net/.test(text), text);
    await page.close(); await page.__context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nprivacy: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
