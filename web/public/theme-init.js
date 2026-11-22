// Apply the saved theme before first paint (no flash of the wrong theme).
// A separate file, not an inline script, so the Content-Security-Policy can
// refuse every inline script (terraform/web.tf).
(function () {
  var t = 'system';
  try { t = localStorage.getItem('dropvault.theme') || 'system'; } catch (e) { /* storage blocked */ }
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
