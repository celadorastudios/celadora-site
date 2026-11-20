# celadora-site

Static site for celadora.net: plain HTML, CSS and JS served verbatim by GitHub Pages behind Cloudflare. No build step, so a push is a publish.

## Before you push (required)

1. **After editing `site.css`, `legal.css`, `analytics.js`, `contact.js` or `gallery.js`, or adding or replacing any image in `assets/`, run `npm run assets:version`** and commit the result. It stamps a content hash into every link to those files (`site.css?v=8c075dae`, `regleur-measure.jpg?v=0032cc28`).
   - Why: Cloudflare caches CSS, JS and images for hours while HTML refreshes in minutes. New HTML with an old cached stylesheet renders unstyled (for example, images at full intrinsic size), and a replaced image keeps showing the old one. A changed hash is a new URL, so every cache is bypassed.
   - CI fails the PR (Guardrails job) if any hash is missing or stale. Never hand-type a `?v=` value.
   - New CSS or JS files must be added to `CODE_ASSETS` in `scripts/asset-versions.mjs`; images in `assets/` are picked up automatically.
2. Run `npm run check` (secrets, guardrails, asset versions, HTML, privacy, gallery, accessibility). Browser-based checks need Chrome: set `PUPPETEER_EXECUTABLE_PATH` to your Chrome binary if puppeteer's own download is missing.
3. Preview locally with `npm run serve` (http://localhost:8791) and look at the page, not just the checks. Check the home page and the Régleur page at 1280 and 390 pixels wide.

## Conventions

- Every page must load `analytics.js` (consent banner) and use the shared nav and footer. `scripts/check-guardrails.mjs` enforces the rules; read it before restructuring.
- No em dashes in any text. Use two sentences, a comma, a colon or parentheses.
- Legal pages (`privacy.html`, `terms.html`, `accessibility.html`, `regleur/*`): keep "Last updated" dates current when the text changes, and keep claims true to the code. The Régleur policy must be checked against the app's code before it changes.
- Do not hand-edit `support.js` (generated) or `_ds/` and `vendor/` (vendored).
- Never put secrets or personal data in the repo; a commit here is a public disclosure.

## Git

- The live repo is `celadorastudios/celadora-site` (remote `live` in older clones). Branch from `main`, open a PR, wait for the six CI checks, then squash-merge.
- Commit messages: `type: description`.
