/* Analytics + consent for celadora.net.
 *
 * One file, included by every page, so the consent gate can't be applied to
 * some pages and forgotten on others.
 *
 * The strict part, and the reason this doesn't use PostHog's own
 * `opt_out_capturing_by_default`: that flag stops *events* being sent, but
 * the PostHog snippet still fetches array.js from PostHog's CDN as soon as
 * the page loads, which already discloses the visitor's IP address to a
 * third party before they have agreed to anything. So nothing PostHog-related
 * is loaded here until consent exists: no script tag, no connection, no
 * cookie. Decline, and the visitor's browser never talks to PostHog at all.
 *
 * That means the decision has to live somewhere other than PostHog (it isn't
 * loaded yet to be asked), so it lives in one localStorage key, below.
 *
 * Cloudflare Web Analytics is deliberately NOT gated: it is cookieless, sets
 * no identifier and doesn't fingerprint, so it isn't the kind of tracking
 * this banner asks permission for. It's disclosed in privacy.html.
 */
(function () {
  'use strict';

  var POSTHOG_KEY = 'phc_rG8EyAG2i9JPyBVi7fUqxYpy5ZqqoqjKJXXqL3TZozgt';
  var POSTHOG_HOST = 'https://us.i.posthog.com';
  var CONSENT_KEY = 'celadora-analytics-consent';
  var CF_TOKEN = 'cf54d1f7a85e4f868e264c4f6b7748fd';

  /* Cloudflare Web Analytics, loaded from here rather than pasted into every
     page. This is a static multi-page site: nothing is shared between page
     loads, so each document has to load its own analytics, and six copies of
     a token is six chances for one page to drift or a new page to ship
     without it. One copy, and check-guardrails.mjs fails the build if a page
     inlines its own.

     Ungated on purpose, and the privacy policy says so: it is cookieless,
     sets no identifier and cannot single anyone out, so it is not the kind of
     tracking the consent banner asks about. PostHog is the gated one. */
  function loadCloudflare() {
    if (document.querySelector('script[data-cf-beacon]')) return;
    var s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_TOKEN }));
    document.head.appendChild(s);
  }
  var POLICY_VERSION = '2026-08-08';
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;   // re-ask after a year

  /* GDPR Art. 7(1) requires being able to DEMONSTRATE consent was given, which
     a bare "granted" string cannot do. Store when it was given and against
     which version of the policy, and treat a stale or older-version record as
     no decision at all so the visitor is asked again. */
  function readConsent() {
    var raw;
    try { raw = window.localStorage.getItem(CONSENT_KEY); }
    catch (e) { return null; }   // private mode / storage blocked: undecided
    if (!raw) return null;

    var rec;
    try { rec = JSON.parse(raw); } catch (e) { return null; }
    if (!rec || (rec.state !== 'granted' && rec.state !== 'denied')) return null;
    if (rec.version !== POLICY_VERSION) return null;
    if (!rec.ts || (Date.now() - rec.ts) > MAX_AGE_MS) return null;
    return rec.state;
  }

  function writeConsent(state) {
    try {
      window.localStorage.setItem(CONSENT_KEY, JSON.stringify({
        state: state, ts: Date.now(), version: POLICY_VERSION
      }));
    } catch (e) { /* nothing we can do */ }
  }

  function clearConsent() {
    try { window.localStorage.removeItem(CONSENT_KEY); } catch (e) { /* nothing we can do */ }
  }

  /* Loads PostHog. Only ever called once consent is known to be 'granted'. */
  var loaded = false;
  function loadPostHog() {
    if (loaded) return;
    loaded = true;

    /* PostHog loader snippet (unmodified, from PostHog's install docs). */
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="Fi Di init Ji Xi Tr Ki tn Zi capture calculateEventProperties ln register register_once register_for_session unregister unregister_for_session dn getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync cn identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty un sn createPersonProfile setInternalOrTestUser hn Wi pn opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing rn debug Er it getPageViewId captureTraceFeedback captureTraceMetric Ui".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

    window.posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      defaults: '2026-05-30',
      // No identify() call is ever made on this site, so with identified_only
      // no person profile is created, so anonymous event counts only.
      person_profiles: 'identified_only',
      // Never record sessions. The privacy policy says so; make it true in
      // code rather than leaving it as a promise.
      disable_session_recording: true,
      register: { app: 'celadora-site' }
    });
  }

  /* Tears PostHog down on withdrawal. opt_out_capturing() stops capture but
     itself writes a __ph_opt_in_out_* cookie, and reset() regenerates the
     distinct id without removing ph_*. Neither clears storage, so the sweep
     below is what actually makes "withdrawn" mean nothing is left behind. */
  function unloadPostHog() {
    if (window.posthog && typeof window.posthog.opt_out_capturing === 'function') {
      try {
        window.posthog.opt_out_capturing();
        if (typeof window.posthog.reset === 'function') window.posthog.reset(true);
      } catch (e) { /* best effort */ }
    }
    forgetPostHogStorage();
  }

  function forgetPostHogStorage() {
    var i, name;

    try {
      var cookies = document.cookie ? document.cookie.split(';') : [];
      for (i = 0; i < cookies.length; i++) {
        name = cookies[i].split('=')[0].replace(/^\s+/, '');
        if (name.indexOf('ph_') !== 0 && name.indexOf('__ph_') !== 0) continue;
        // Expire on this host and on the registrable domain, since PostHog
        // may have set it at either scope.
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + location.hostname;
      }
    } catch (e) { /* best effort */ }

    try {
      var doomed = [];
      for (i = 0; i < window.localStorage.length; i++) {
        name = window.localStorage.key(i);
        if (name && (name.indexOf('ph_') === 0 || name.indexOf('__ph_') === 0)) doomed.push(name);
      }
      for (i = 0; i < doomed.length; i++) window.localStorage.removeItem(doomed[i]);
    } catch (e) { /* best effort */ }
  }

  var STYLE = [
    '.consent-banner{position:fixed;left:0;right:0;bottom:0;z-index:9999;',
    'display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:center;',
    'padding:16px clamp(16px,4vw,32px);background:var(--color-surface,#232532);',
    'border-top:1px solid var(--color-divider,rgba(233,233,237,.16));',
    'font-size:14px;line-height:22px;color:var(--color-text,#e9e9ed);',
    'font-family:var(--font-body,system-ui,sans-serif);}',
    '.consent-banner p{margin:0;max-width:66ch;}',
    '.consent-actions{display:flex;gap:8px;flex-shrink:0;}',
    '.consent-banner a{color:var(--color-accent-300,#d2cefd);text-decoration:underline;}',
    // WCAG 1.4.11 wants a >=3:1 boundary on controls; the design system's own
    // button border does not reach that against this surface, so set one here.
    '.consent-banner .btn{border:1px solid #8f93a8;}',
    '.consent-banner .btn:focus-visible{outline:2px solid var(--color-accent,#9184d9);outline-offset:2px;}',
    '@media (max-width:640px){.consent-actions{width:100%;}',
    '.consent-actions .btn{flex:1;}}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('consent-style')) return;
    var s = document.createElement('style');
    s.id = 'consent-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function removeBanner() {
    var existing = document.querySelector('.consent-banner');
    if (existing) existing.parentNode.removeChild(existing);
  }

  function decide(accept) {
    if (accept) {
      writeConsent('granted');
      // If PostHog was loaded earlier this page-view and then withdrawn,
      // loadPostHog() is a no-op, so opt back in explicitly or "granted"
      // would silently stay opted out until the next reload.
      if (loaded) {
        try { window.posthog.opt_in_capturing(); } catch (e) { /* best effort */ }
      } else {
        loadPostHog();
      }
    } else {
      writeConsent('denied');
      unloadPostHog();
    }
    closeBanner();
  }

  var lastFocus = null;

  function onKeydown(e) {
    // Escape closes the banner WITHOUT recording a decision, so dismissing is
    // never mistaken for consent. It reappears on the next page view.
    if (e.key === 'Escape' || e.key === 'Esc') closeBanner();
  }

  function closeBanner() {
    removeBanner();
    document.removeEventListener('keydown', onKeydown);
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (e) { /* element may be gone */ }
    }
    lastFocus = null;
  }

  function showBanner() {
    injectStyle();
    removeBanner();
    lastFocus = document.activeElement;

    var bar = document.createElement('div');
    bar.className = 'consent-banner';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Analytics consent');

    var text = document.createElement('p');
    text.innerHTML =
      'We’d like to use privacy-friendly analytics (PostHog) to see which pages get read. ' +
      'It’s <strong>off unless you say yes</strong>, it never identifies you, and if you decline ' +
      'your browser never contacts them at all. ' +
      '<a href="/privacy.html">What we collect</a>.';

    var actions = document.createElement('div');
    actions.className = 'consent-actions';

    // Both buttons take the SAME class. Under EDPB Guidelines 03/2022 an
    // accept button that is more prominent than the refuse button is a
    // deceptive pattern, and the privacy policy claims refusing is exactly as
    // easy as agreeing, so they have to look identical, not merely both be
    // present. Reject is also first in the DOM.
    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn btn-secondary';
    no.textContent = 'No thanks';
    no.addEventListener('click', function () { decide(false); });

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn btn-secondary';
    yes.textContent = 'Sure';
    yes.addEventListener('click', function () { decide(true); });

    actions.appendChild(no);
    actions.appendChild(yes);
    bar.appendChild(text);
    bar.appendChild(actions);
    document.body.appendChild(bar);

    document.addEventListener('keydown', onKeydown);
    // Move focus to the refuse control so a keyboard user lands on the
    // privacy-preserving option rather than having to tab past the page.
    try { no.focus(); } catch (e) { /* best effort */ }
  }

  function init() {
    loadCloudflare();

    // The stored decision is per-origin, so it is read again on every page and
    // a choice made anywhere is honoured everywhere. Granted keeps PostHog on
    // without re-asking; denied keeps it off and stays silent.
    var state = readConsent();
    if (state === 'granted') loadPostHog();
    else if (state === null) showBanner();
    // 'denied' → load nothing, show nothing.

    // Any element with data-consent-settings re-opens the choice, so consent
    // can be withdrawn as easily as it was given (GDPR Art. 7(3)).
    var openers = document.querySelectorAll('[data-consent-settings]');
    for (var i = 0; i < openers.length; i++) {
      openers[i].addEventListener('click', function (e) {
        e.preventDefault();
        clearConsent();
        unloadPostHog();
        showBanner();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
