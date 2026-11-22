// One office, one link. The page you open becomes a frame around the game: every table is drawn inside it,
// and walking to another table swaps the game inside the frame while the address bar keeps the same link.
// The new table is loaded out of sight and shown once it is ready, so you never see a blank page between them.
const PAGES = { blackjack: './', poker: 'poker.html', baccarat: 'baccarat.html', roulette: 'roulette.html' };
const KEY = 'office-frame';
const TEST = ['peerhost', 'peerport', 'peerpath', 'peersecure', '3d', 'flat'];

// The office frame around this page, if there is one.
export function office() {
  try { return window.parent !== window && window.parent.__office ? window.parent.__office : null; } catch { return null; }
}
// The link to give friends: the office link with the room, plus the table to start at.
export function outerLink(link, game) {
  if (!office()) return link;
  const u = new URL(link, location.href), q = new URLSearchParams();
  const room = u.searchParams.get('room') || u.searchParams.get('host');
  if (room) q.set('room', room);
  if (game && game !== 'blackjack') q.set('g', game);
  for (const k of TEST) if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k));
  return location.origin + '/' + (q.toString() ? '?' + q : '');
}
// The page goes to another table: inside the office the frame swaps it, otherwise the browser opens it.
export function openTable(url) {
  const o = office();
  if (o) o.go(new URL(url, location.href).href); else location.href = url;
}

function topLink(frameUrl) {
  const u = new URL(frameUrl), q = new URLSearchParams();
  const room = u.searchParams.get('room') || u.searchParams.get('host');
  if (room) q.set('room', room);
  for (const k of TEST) if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k));
  return '/' + (q.toString() ? '?' + q : '');
}
const save = (v) => { try { sessionStorage.setItem(KEY, v); } catch { /* fine */ } };
const load = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };

// Called by each game page. Inside the office (or in a test or a pop-up), the game itself starts.
export function boot(game, start) {
  const params = new URLSearchParams(location.search);
  if (window.top !== window || params.has('roomdebug') || params.has('noshell')) { start(); return; }
  // This page is opened in the browser: it becomes the office.
  let first;
  const saved = load();
  const g = params.get('g');
  if (saved && (!params.get('room') || new URL(saved).searchParams.get('room') === params.get('room') || new URL(saved).searchParams.get('host') === params.get('room'))) first = saved;
  else {
    const page = g && PAGES[g] ? g : game;
    const u = new URL(PAGES[page], location.href);
    params.delete('g');
    if (page !== game || game === 'blackjack') u.search = params.toString(); else u.search = location.search;
    first = u.href;
  }
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#0b0d10;overflow:hidden';
  const css = document.createElement('style');
  css.textContent = '.office-frame{position:fixed;inset:0;width:100%;height:100%;border:0;display:block;background:#0b0d10;transition:opacity .45s ease}.office-frame.loading{opacity:0;pointer-events:none;z-index:0}.office-frame.on{opacity:1;z-index:1}';
  document.head.appendChild(css);
  let cur = null, next = null;
  const make = (src) => {
    const f = document.createElement('iframe');
    f.className = 'office-frame loading';
    f.allow = 'autoplay; fullscreen; clipboard-write; microphone; camera';
    f.src = src;
    document.body.appendChild(f);
    return f;
  };
  const show = (f) => {
    if (f !== next && cur) return;
    f.classList.remove('loading'); f.classList.add('on');
    const old = cur; cur = f; next = null;
    try { f.contentWindow.focus(); } catch { /* fine */ }
    if (old) setTimeout(() => old.remove(), 500);
  };
  // A table is ready once its page has drawn something; the 3D room needs a little longer to settle.
  const whenReady = (f) => {
    const t0 = Date.now();
    const tick = () => {
      if (f !== next && f !== cur) return;
      let ok = false;
      try { const d = f.contentDocument; ok = d && d.readyState === 'complete' && d.querySelector('#app')?.children.length > 0; } catch { ok = true; }
      if ((ok && Date.now() - t0 > 900) || Date.now() - t0 > 12000) show(f); else setTimeout(tick, 150);
    };
    f.addEventListener('load', () => setTimeout(tick, 150));
  };
  window.__office = {
    go(url) {
      if (next) next.remove();
      next = make(url);
      whenReady(next);
    },
  };
  next = make(first);
  whenReady(next);
  // The address bar keeps the office link; the frame's own address is kept for this tab, so a reload comes back to the same table.
  history.replaceState(null, '', topLink(first));
  let last = '';
  setInterval(() => {
    const f = cur;
    if (!f) return;
    try {
      const href = f.contentWindow.location.href;
      if (href && href !== last && href !== 'about:blank') { last = href; save(href); const t = topLink(href); if (location.pathname + location.search !== t) history.replaceState(null, '', t); }
      if (f.contentDocument.title && document.title !== f.contentDocument.title) document.title = f.contentDocument.title;
    } catch { /* fine */ }
  }, 700);
}
