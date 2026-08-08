import puppeteer from 'puppeteer';
import { start } from './serve.mjs';

const server = await start(8797);
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
let bad = 0;
const chk = (n, v, d = '') => { if (!v) bad++; console.log(`${v ? '  ok  ' : ' FAIL '} ${n}${d ? ': ' + d : ''}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const at = (p) => p.$eval('.gallery-viewport', v => v.scrollLeft);

try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto('http://localhost:8797/partsbin.html', { waitUntil: 'networkidle2' });
  await wait(800);

  chk('4 slides', (await p.$$('.gallery-slide')).length === 4);
  chk('scrollbar hidden', await p.$eval('.gallery-viewport', v => getComputedStyle(v).scrollbarWidth === 'none'));
  chk('pause button present', (await p.$('.gallery-play')) !== null);
  chk('starts playing (labelled Pause)',
      /pause/i.test(await p.$eval('.gallery-play', b => b.getAttribute('aria-label'))));

  // Auto-advance: move the mouse away first, since hover holds it.
  await p.mouse.move(5, 5);
  const a = await at(p);
  await wait(7000);
  const b = await at(p);
  chk('auto-advances on its own', b !== a, `${a} -> ${b}`);

  // Pause must actually stop it.
  await p.click('.gallery-play');
  await p.mouse.move(5, 5);
  chk('now labelled Play', /play/i.test(await p.$eval('.gallery-play', x => x.getAttribute('aria-label'))));
  const c = await at(p);
  await wait(7000);
  chk('paused: does not move', (await at(p)) === c);

  // Hover holds it even while playing.
  await p.click('.gallery-play');            // resume
  await p.hover('.gallery-viewport');
  const d = await at(p);
  await wait(7000);
  chk('hover holds it', (await at(p)) === d);
  await p.close();

  // Reduced motion: never auto-advances.
  const rm = await browser.newPage();
  await rm.setViewport({ width: 1280, height: 900 });
  await rm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await rm.goto('http://localhost:8797/partsbin.html', { waitUntil: 'networkidle2' });
  await wait(800);
  await rm.mouse.move(5, 5);
  chk('reduced motion starts paused',
      /play/i.test(await rm.$eval('.gallery-play', x => x.getAttribute('aria-label'))));
  const e = await at(rm);
  await wait(7000);
  chk('reduced motion never moves', (await at(rm)) === e);
  await rm.close();

  // No JS: still usable, no dead controls.
  const n = await browser.newPage();
  await n.setJavaScriptEnabled(false);
  await n.goto('http://localhost:8797/partsbin.html', { waitUntil: 'domcontentloaded' });
  chk('no-JS: 4 slides in DOM', (await n.$$('.gallery-slide')).length === 4);
  chk('no-JS: no dead buttons', (await n.$('.gallery-nav')) === null);
  chk('no-JS: still scrollable', await n.$eval('.gallery-viewport', v => getComputedStyle(v).overflowX === 'auto'));
  await n.close();
} finally {
  await browser.close();
  server.close();
}
console.log(bad === 0 ? '\ngallery: all passed' : `\ngallery: ${bad} FAILED`);
process.exit(bad ? 1 : 0);
