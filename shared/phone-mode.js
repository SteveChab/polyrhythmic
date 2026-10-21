// phone-mode.js: a classic script, loaded in <head> before any CSS paints, so the phone layout
// never flashes the desktop one. It sets html.is-phone on a touch screen whose shorter side is
// 500px or less (site-spec, Phones), and fires "phonechange" on window when that flips.
// ?phone in the URL forces the phone layout, for checking it in a desktop browser.
(function () {
  var mq = matchMedia('(pointer: coarse) and (max-width: 500px), (pointer: coarse) and (max-height: 500px)');
  var force = /[?&]phone\b/.test(location.search);
  var root = document.documentElement;
  function set() {
    var on = force || mq.matches;
    if (on === root.classList.contains('is-phone')) return;
    root.classList.toggle('is-phone', on);
    window.dispatchEvent(new Event('phonechange'));
  }
  set();
  if (mq.addEventListener) mq.addEventListener('change', set); else mq.addListener(set);
})();
