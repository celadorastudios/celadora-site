/* Behavioural checks against a real browser.
 *
 * The static guardrails prove the source doesn't mention a third party. These
 * prove the running page doesn't contact one, which is the claim the privacy
 * policy actually makes. Two regressions this would have caught:
 *
 *   1. PostHog's loader being fetched before consent. The snippet pulls
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
const PAGES = ['/', '/claude-o-meter.html', '/partsbin.html', '/privacy.html', '/terms.html', '/accessibility.html'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ': ' + detail : ''}`);
};

/**
 * Loads a page in an ISOLATED browser context and returns every third-party
 * host it contacted.
 *
 * The isolation is load-bearing, not tidiness: localStorage is shared across
 * pages of one browser, so a check that seeds consent would silently decide
 * the outcome of every check after it, which is exactly how the
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

  // 3. Granting consent actually enables PostHog. The gate has to work in
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

  // 7. A decision made on ONE page must be honoured on ALL of them.
  //
  //    This is the check that matters on a static multi-page site. Every page
  //    load is a fresh document that re-reads the stored choice, so a bug here
  //    means a visitor who declined gets asked again on the next page, or
  //    worse, gets tracked after saying no. Earlier checks SEED the choice;
  //    these two make it the way a person would, by clicking, then navigate.
  for (const [answer, label] of [['No thanks', 'declined'], ['Sure', 'granted']]) {
    const context = browser.createBrowserContext
      ? await browser.createBrowserContext()
      : await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    const seen = [];
    page.on('request', (r) => { if (/posthog/i.test(r.url())) seen.push(r.url()); });

    await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('.consent-banner', { timeout: 5000 });
    await page.evaluate((want) => {
      const b = [...document.querySelectorAll('.consent-banner button')]
        .find((x) => x.textContent.trim() === want);
      b.click();
    }, answer);
    await new Promise((r) => setTimeout(r, 400));

    // Now walk the rest of the site as a real visitor would.
    let reappeared = false;
    for (const url of PAGES.slice(1)) {
      await page.goto(BASE + url, { waitUntil: 'networkidle2' });
      if (await page.$('.consent-banner')) reappeared = true;
    }

    check(`${label} on the home page is remembered across every other page`, !reappeared);

    if (label === 'declined') {
      check('declined: PostHog never contacted while browsing the whole site',
            seen.length === 0, seen.slice(0, 2).join(', '));
    } else {
      check('granted: PostHog is active on later pages too', seen.length > 0);
    }

    // And the footer control must be able to reopen the choice anywhere.
    await page.goto(BASE + '/terms.html', { waitUntil: 'networkidle2' });
    await page.click('[data-consent-settings]');
    await new Promise((r) => setTimeout(r, 300));
    check(`${label}: cookie settings reopens the choice on a deep page`,
          (await page.$('.consent-banner')) !== null);

    await page.close();
    await context.close();
  }

  // 8. Cloudflare's cookieless beacon is centralised in analytics.js, so
  //    confirm every page still actually loads it.
  for (const url of PAGES) {
    const context = browser.createBrowserContext
      ? await browser.createBrowserContext()
      : await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    let beacon = false;
    page.on('request', (r) => { if (/cloudflareinsights/i.test(r.url())) beacon = true; });
    await page.goto(BASE + url, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    check(`Cloudflare beacon loads on ${url}`, beacon);
    await page.close();
    await context.close();
  }

  // 9. The header must not move between pages.
  //
  //    It used to: the product page inherited the design system's .nav with
  //    8.4px of vertical padding against the studio pages' 20px, and carried
  //    an extra button, while the legal pages sat in the 760px prose column
  //    instead of the 1200px one, shifting the logo sideways by 188px. Every
  //    page now renders the same nav markup, and this measures it rather than
  //    trusting that it stays that way.
  {
    const context = browser.createBrowserContext
      ? await browser.createBrowserContext()
      : await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const shots = [];
    for (const url of PAGES) {
      await page.goto(BASE + url, { waitUntil: 'networkidle2' });
      shots.push(await page.evaluate(() => {
        const nav = document.querySelector('nav.site-nav');
        if (!nav) return null;
        const brand = nav.querySelector('.brand');
        const nb = nav.getBoundingClientRect(), bb = brand.getBoundingClientRect();
        return {
          navH: nb.height.toFixed(1),
          brandX: bb.x.toFixed(1),
          brandY: bb.y.toFixed(1),
          labels: [...nav.querySelectorAll('a')].map((a) => a.textContent.trim()).join('|')
        };
      }));
    }

    check('every page has the shared nav', shots.every(Boolean));
    if (shots.every(Boolean)) {
      for (const key of ['navH', 'brandX', 'brandY', 'labels']) {
        const values = [...new Set(shots.map((s) => s[key]))];
        check(`nav ${key} is identical on all pages`, values.length === 1,
              values.length === 1 ? String(values[0]).slice(0, 48) : values.join(' vs '));
      }
    }
    await page.close();
    await context.close();
  }

  // 10. The contact address must survive with JavaScript disabled, because it is the
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
