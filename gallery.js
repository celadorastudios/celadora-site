/* Screenshot gallery.
 *
 * A scroll-snap carousel rather than a slide-swapper. The slides are always
 * in the DOM and always reachable: the viewport is a scrollable region, so
 * swipe, trackpad, arrow keys and a screen reader's own navigation all work
 * before this file loads. That avoids the usual carousel failures, where
 * off-screen slides stay in the tab order, or focus is yanked around, or the
 * whole thing is inert without JavaScript.
 *
 * The buttons are INJECTED here, never in the markup, so there is no dead
 * control on a page where the script failed to load.
 */
(function () {
  'use strict';

  function build(gallery) {
    var viewport = gallery.querySelector('.gallery-viewport');
    var slides = [].slice.call(gallery.querySelectorAll('.gallery-slide'));
    if (!viewport || slides.length < 2) return;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var behavior = reduced ? 'auto' : 'smooth';

    var nav = document.createElement('div');
    nav.className = 'gallery-nav';

    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'gallery-arrow';
    prev.setAttribute('aria-label', 'Previous screenshot');
    prev.innerHTML = '<span aria-hidden="true">←</span>';

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'gallery-arrow';
    next.setAttribute('aria-label', 'Next screenshot');
    next.innerHTML = '<span aria-hidden="true">→</span>';

    var dots = document.createElement('div');
    dots.className = 'gallery-dots';

    var buttons = slides.map(function (slide, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gallery-dot';
      // Name each dot by the part it shows, not "slide 3" — the caption is
      // the useful bit and it is already written.
      var cap = slide.querySelector('figcaption');
      var label = cap ? cap.textContent.trim().split('.')[0] : 'Screenshot ' + (i + 1);
      b.setAttribute('aria-label', 'Show ' + label);
      b.addEventListener('click', function () { go(i); });
      dots.appendChild(b);
      return b;
    });

    // Auto-advance needs a visible, permanent way to stop it: WCAG 2.2.2
    // (Pause, Stop, Hide) applies to anything that moves for more than five
    // seconds. It also stays off entirely for reduced-motion users, pauses
    // while hovered or focused, and pauses when the tab is hidden.
    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'gallery-play';
    // The icon is created ONCE and only its text is updated. Rewriting
    // innerHTML on every state change destroys the node under the cursor
    // mid-click (hovering triggers a state change), and the click is lost.
    var playIcon = document.createElement('span');
    playIcon.setAttribute('aria-hidden', 'true');
    play.appendChild(playIcon);

    nav.appendChild(play);
    nav.appendChild(dots);
    nav.appendChild(prev);
    nav.appendChild(next);
    gallery.appendChild(nav);

    function current() {
      // Whichever slide's centre is nearest the viewport centre.
      var mid = viewport.scrollLeft + viewport.clientWidth / 2;
      var best = 0, bestGap = Infinity;
      slides.forEach(function (s, i) {
        var gap = Math.abs((s.offsetLeft + s.offsetWidth / 2) - mid);
        if (gap < bestGap) { bestGap = gap; best = i; }
      });
      return best;
    }

    function go(i) {
      var target = slides[Math.max(0, Math.min(slides.length - 1, i))];
      viewport.scrollTo({ left: target.offsetLeft - viewport.offsetLeft, behavior: behavior });
    }

    function sync() {
      var i = current();
      buttons.forEach(function (b, n) {
        if (n === i) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
      prev.disabled = i === 0;
      next.disabled = i === slides.length - 1;
    }

    prev.addEventListener('click', function () { stop(); go(current() - 1); });
    next.addEventListener('click', function () { stop(); go(current() + 1); });

    var tick;
    viewport.addEventListener('scroll', function () {
      window.clearTimeout(tick);
      tick = window.setTimeout(sync, 90);
    }, { passive: true });

    /* ------------------------------------------------------ auto-advance */
    var DELAY = 5000;
    var timer = null;
    var wanted = !reduced;   // reduced-motion users never get motion they didn't ask for
    var held = false;        // hovered, focused, or tab hidden

    function advance() {
      var i = current();
      go(i >= slides.length - 1 ? 0 : i + 1);   // wrap, so it never dead-ends
    }

    function pump() {
      window.clearInterval(timer);
      timer = null;
      if (wanted && !held) timer = window.setInterval(advance, DELAY);

      var label = wanted ? 'Pause the screenshot slideshow' : 'Play the screenshot slideshow';
      if (play.getAttribute('aria-label') !== label) {
        play.setAttribute('aria-label', label);
        playIcon.textContent = wanted ? '❚❚' : '▶';
      }
    }

    function stop() { wanted = false; pump(); }
    function hold(v) { held = v; pump(); }

    play.addEventListener('click', function () { wanted = !wanted; pump(); });

    gallery.addEventListener('mouseenter', function () { hold(true); });
    gallery.addEventListener('mouseleave', function () { hold(false); });
    gallery.addEventListener('focusin', function () { hold(true); });
    gallery.addEventListener('focusout', function () {
      if (!gallery.contains(document.activeElement)) hold(false);
    });
    document.addEventListener('visibilitychange', function () { hold(document.hidden); });

    // A deliberate swipe or dot click means they are driving; stop nagging.
    dots.addEventListener('click', stop);
    viewport.addEventListener('pointerdown', stop);

    window.addEventListener('resize', sync);
    sync();
    pump();
  }

  function init() {
    [].forEach.call(document.querySelectorAll('[data-gallery]'), build);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
