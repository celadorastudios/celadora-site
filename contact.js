/* Renders the contact address without putting a harvestable mailto: in the
 * served HTML.
 *
 * Any element with data-contact-email is filled in at runtime from the parts
 * below, which are assembled in JS so a naive regex crawling the page source
 * finds nothing. This is deterrence, not security — a headless-browser
 * scraper will still get it. It costs nothing and stops the bulk of spam.
 *
 * The markup MUST carry a human-readable fallback inside the element (e.g.
 * "hello at celadora.net"), because this is the contact channel for GDPR and
 * CCPA rights requests and for accessibility reports. It has to stay legible
 * with JavaScript disabled — an address that only exists in JS is not a
 * contact channel a regulator would accept.
 */
(function () {
  'use strict';

  var USER = 'hello';
  var DOMAIN = ['celadora', 'net'].join('.');

  function render() {
    var slots = document.querySelectorAll('[data-contact-email]');
    if (!slots.length) return;

    var address = USER + String.fromCharCode(64) + DOMAIN;

    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var link = document.createElement('a');
      link.href = 'mailto:' + address;
      link.textContent = address;
      slot.textContent = '';
      slot.appendChild(link);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
