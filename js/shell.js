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
  css.textContent = '.office-frame{position:fixed;inset:0;width:100%;height:100%;border:0;display:block;background:#0b0d10;transition:opacity .45s ease}.office-frame.loading{opacity:0;pointer-events:none;z-index:0}.office-frame.on{opacity:1;z-index:1}.office-frame.away{opacity:0;pointer-events:none;z-index:0;visibility:hidden}';
  document.head.appendChild(css);
  // Every table you have been to stays open behind the one you look at, so a table you host keeps dealing for
  // the others and you stay in that world. Walking back shows it again at once; it is not loaded a second time.
  let cur = null, next = null;
  const kept = {}; // page path -> frame
  const pageOf = (src) => { try { return new URL(src, location.href).pathname.replace(/index\.html$/, ''); } catch { return src; } }; // one frame per game
  const make = (src) => {
    const f = document.createElement('iframe');
    f.className = 'office-frame loading';
    f.allow = 'autoplay; fullscreen; clipboard-write; microphone; camera';
    f.src = src;
    f.dataset.page = pageOf(src);
    f.addEventListener('load', () => { if (f !== cur && !f.classList.contains('loading')) away(f, true); });
    document.body.appendChild(f);
    return f;
  };
  // A table out of sight draws nothing and makes no sound; the page also tells its table that the player is elsewhere.
  const away = (f, on) => { try { const w = f.contentWindow; if (!!w.__officeAway === !!on) return; w.__officeAway = on; w.__officeAwayChanged?.(on); } catch { /* fine */ } };
  const show = (f) => {
    if (f !== next && cur) return;
    f.classList.remove('loading', 'away'); f.classList.add('on');
    const old = cur; cur = f; next = null;
    away(f, false);
    kept[f.dataset.page] = f;
    try { f.contentWindow.focus(); } catch { /* fine */ }
    try { f.contentWindow.__officeShown?.(); } catch { /* fine */ }
    // The table you left stays open out of sight: it draws nothing and makes no sound while you are away.
    if (old && old !== f) setTimeout(() => { if (cur !== old) { old.classList.remove('on'); old.classList.add('away'); away(old, true); } }, 500);
  };
  // A table is ready once its page has drawn something; the 3D room needs a little longer to settle.
  const whenReady = (f) => {
    const t0 = Date.now();
    const tick = () => {
      if (f !== next && f !== cur) return;
      let ok = false, waited = Date.now() - t0;
      try {
        const w = f.contentWindow, d = f.contentDocument;
        // A 3D table is ready once its view is in your chair; a flat page once it has drawn.
        if (w.__officeShown) ok = true;
        else if (w.__roomApi) ok = waited > 6000;
        else ok = d && d.readyState === 'complete' && d.querySelector('#app')?.children.length > 0 && waited > (/[?&]from=/.test(w.location.search) && !d.body.classList.contains('room3d') && waited < 4000 ? 99999 : 900);
      } catch { ok = true; }
      if (ok || waited > 15000) show(f); else setTimeout(tick, 150);
    };
    f.addEventListener('load', () => setTimeout(tick, 150));
  };
  window.__office = {
    go(url) {
      if (next && !Object.values(kept).includes(next)) next.remove();
      const k = kept[pageOf(url)];
      if (k && k !== cur) {
        // Back to a table that is still open: it shows at once, in your chair, and picks up the chips you carry.
        next = k; away(k, false);
        try { k.contentWindow.__officeBack?.(); } catch { /* fine */ }
        setTimeout(() => show(k), 60);
        return;
      }
      next = make(url);
      whenReady(next);
    },
  };
  next = make(first);
  whenReady(next);
  // Automatic update (see autoUpdate in js/common.js): every open table reloads itself once it has no hand in
  // play. The frame itself reloads only when just one table is open, so no table you host is ever dropped.
  const TAG = new URL(import.meta.url).searchParams.get('v') || '';
  const frames = () => [...new Set([cur, ...Object.values(kept)].filter(Boolean))];
  let updating = false;
  setInterval(async () => {
    if (updating) return;
    let live = '';
    try { const r = await fetch('version.txt?t=' + Date.now(), { cache: 'no-store' }); const m = /v=(\w+)/.exec(await r.text()); live = m ? m[1] : ''; } catch { /* fine */ }
    if (!live) return;
    updating = true;
    const until = Date.now() + 110000;
    const step = () => {
      let left = 0;
      for (const f of frames()) {
        let w = null; try { w = f.contentWindow; } catch { /* fine */ }
        if (!w || !w.__officeTag || w.__officeTag === live) continue;
        // One reload per table for each new version: a page that still comes back old waits for the next check.
        if (f.dataset.upd === live && Date.now() - Number(f.dataset.updAt || 0) < 100000) continue;
        if (w.__officeIdle?.()) { f.dataset.upd = live; f.dataset.updAt = String(Date.now()); try { (w.__updateReload || ((t, x) => x.location.reload()))('Updating game', w); } catch { /* fine */ } } else left++;
      }
      if (!left && TAG !== live && frames().length <= 1 && frames().every((f) => { try { return f.contentWindow.__officeIdle?.() !== false; } catch { return true; } })) { try { sessionStorage.setItem('bj-upd', JSON.stringify({ at: Date.now(), text: 'Updating game' })); } catch { /* fine */ } const u = new URL(location.href); u.searchParams.set('u', Date.now().toString(36)); location.replace(u.href); return; }
      if (left && Date.now() < until) setTimeout(step, 3000); else updating = false;
    };
    step();
  }, 120000);
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
