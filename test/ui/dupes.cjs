// Duplicate check, run before every push: every game is opened by a host and a guest (in blackjack the guest
// is the dealer), the menu is opened with every folder expanded, and the page fails when one action or one
// label shows twice on the screen at the same time, or when two visible boxes of text overlap.
// Needs: npm i playwright peer (or NODE_PATH to them). Run from the repo: node test/ui/dupes.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
const PORT = 8091, PEER = 9091;
const Q = `peerhost=127.0.0.1&peerport=${PEER}&peersecure=0&noshell=1&relay=0&3d=0&flat=1`;
const GAMES = [['blackjack', 'index.html'], ['poker', 'poker.html'], ['baccarat', 'baccarat.html'], ['roulette', 'roulette.html']].filter(([g]) => !process.env.ONLY || process.env.ONLY.split(',').includes(g));

// What a person sees: buttons and other things to press, with their label and what they do.
function scan() {
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) return false; if (x.tagName === 'DETAILS' && !x.open && !e.closest('summary')) { const s = x.querySelector(':scope > summary'); if (s && !s.contains(e)) return false; } } return true; };
  const label = (e) => (e.getAttribute('aria-label') && !e.textContent.trim() ? e.getAttribute('aria-label') : e.textContent).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\b\d[\d,.]*\b/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
  const els = [...document.querySelectorAll('button, [data-act], summary, select, a[href]')].filter((e) => !e.closest('[aria-hidden=true], #afk-screen') && vis(e) && !e.matches('.chipv, [data-act=chip], [data-throw-at], .menu-wrap > .hamburger'));
  const items = els.map((e) => { const d = { ...e.dataset }; delete d.v; return { act: e.dataset.act || e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''), sig: JSON.stringify(d), label: label(e), where: (e.closest('[id]')?.id || '') }; });
  const out = [];
  const bySig = new Map(), byLabel = new Map();
  for (const it of items) {
    if (it.act && it.sig !== '{}') { const k = it.sig; if (bySig.has(k)) out.push(`same action twice: ${it.act} "${it.label}" (${bySig.get(k)} and ${it.where})`); else bySig.set(k, it.where); }
    if (it.label.length > 2 && !/^#$/.test(it.label)) { const o = byLabel.get(it.label); if (o && o.act !== it.act) out.push(`same label twice: "${it.label}" (${o.act} in ${o.where}, ${it.act} in ${it.where})`); else if (!o) byLabel.set(it.label, it); }
  }
  // Text boxes that lie on top of each other.
  const onTop = (e) => { const r = e.getBoundingClientRect(); const x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!x && (x === e || e.contains(x) || x.contains(e)); };
  const texts = [...document.querySelectorAll('button, label, h3, h4, .pill, .status, .tray-msg, .dp-bar, .dp-head')].filter((e) => vis(e) && e.textContent.trim() && !e.closest('#menu, .menu, details:not([open])') && !(document.body.classList.contains('room3d') && e.closest('#felt, .felt')) && onTop(e));
  // In the 3D room the felt is drawn in perspective, so its boxes are not compared (their screen boxes are bigger than what shows).
  // Hidden under an opaque panel is not an overlap of text: only boxes that are on top at their middle count.
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j]; if (a.contains(b) || b.contains(a)) continue;
    const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const ix = Math.min(p.right, q.right) - Math.max(p.left, q.left), iy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (ix > 3 && iy > 3) out.push(`overlap: "${a.textContent.trim().slice(0, 24)}" x "${b.textContent.trim().slice(0, 24)}"`);
  }
  return [...new Set(out)];
}

(async () => {
  await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
  const { PeerServer } = require('peer'); const peer = PeerServer({ port: PEER, path: '/', host: '127.0.0.1' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let bad = 0;
  for (const [game, file] of GAMES) {
    const mk = async (w, h, phone) => { const c = await browser.newContext({ viewport: { width: w, height: h }, ...(phone ? { isMobile: true, hasTouch: true } : {}) }); const p = await c.newPage(); p.on('dialog', (d) => d.dismiss()); p.on('pageerror', (e) => { bad++; console.log(`  ${game} PAGE ERROR ${e.message}`); }); return p; };
    const H = await mk(1440, 900), A = await mk(1440, 900), B = await mk(390, 844, true), C = await mk(1280, 800);
    const base = `http://127.0.0.1:${PORT}/${file}`;
    await H.goto(`${base}?${Q}`); await H.fill('#name', 'Hal'); if (await H.$('#buyin')) await H.fill('#buyin', '1000'); await H.click('[data-act=host]');
    await H.waitForSelector('.pill.live', { timeout: 25000 });
    const code = await H.evaluate(() => new URLSearchParams(location.search).get('room') || document.querySelector('#conn-pill, .pill.live')?.textContent.replace(/.*Table /, '').split(' ')[0]);
    for (const [P, n] of [[A, 'Ann'], [B, 'Bob'], [C, 'Cy']]) { await P.goto(`${base}?room=${code}&${P === C ? Q.replace('3d=0', '3d=1').replace('&flat=1', '') : Q}`); await P.fill('#name', n); if (await P.$('#buyin')) await P.fill('#buyin', '1000'); await P.click('[data-act=join]'); await P.waitForSelector('.pill.live', { timeout: 25000 }); }
    await H.waitForTimeout(1500);
    // Seat the host, and in blackjack make Ann the dealer.
    await H.evaluate(() => document.querySelector('[data-act=sit]')?.click()); await H.waitForTimeout(800);
    if (game === 'blackjack') { await A.evaluate(() => document.querySelector('[data-act=sit-dealer]')?.click()); await A.waitForTimeout(800); for (const P of [H, B]) await P.evaluate(() => document.querySelector('[data-vote="1"]')?.click()); await H.waitForTimeout(1500); }
    await C.waitForTimeout(6000); // the 3D room needs a moment to build
    for (const [who, P] of [['host', H], ['guest', A], ['phone', B], ['3d', C]]) {
      const table = await P.evaluate(scan);
      if (process.env.SHOTS) await P.screenshot({ path: `${process.env.SHOTS}/${game}-${who}.png` });
      await P.evaluate(() => { document.querySelector('[data-act=menu]')?.click(); document.querySelectorAll('.menu details, #menu details').forEach((d) => (d.open = true)); });
      await P.waitForTimeout(400);
      const menu = (await P.evaluate(scan)).filter((x) => !x.startsWith('overlap'));
      const all = [...new Set([...table, ...menu])];
      if (all.length) { bad += all.length; console.log(`${game} ${who}:\n  ` + all.join('\n  ')); } else console.log(`${game} ${who}: ok`);
      await P.evaluate(() => document.querySelector('[data-act=menu]')?.click());
    }
    for (const P of [H, A, B, C]) await P.context().close();
  }
  await browser.close(); server.close(); peer.close?.();
  console.log(bad ? `FAIL: ${bad} problem(s)` : 'PASS: no duplicates or overlaps');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FATAL', e.message); process.exit(2); });
