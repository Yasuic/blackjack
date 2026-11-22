// Shared by the poker and baccarat pages: small helpers, the playing card picture, the game switch at the
// top left, and the link between the host's browser and the players' browsers.
import { hostRelay, guestRelay, relayWorks } from './relay.js?v=20261122o';
import { cleanBox, cleanPiece } from './vault.js?v=20261122o';
export const params = new URLSearchParams(location.search);
export const $ = (sel, el = document) => el.querySelector(sel);
export function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
export function safeDel(k) { try { localStorage.removeItem(k); } catch {} }
export function getClientId() {
  let id = safeGet('bj-client-id');
  if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); safeSet('bj-client-id', id); }
  return id;
}
export function getLook() { try { const l = JSON.parse(safeGet('bj-look') || '{}') || {}; return { skin: l.skin ?? 2, hair: l.hair ?? 0, flag: l.flag }; } catch { return { skin: 2, hair: 0 }; } }
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function money(n) { return Number(n).toLocaleString(); }
export function newCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
export function randomHex(n = 16) { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
export function modal(html) { $('#modal-body').innerHTML = html; const d = $('#modal'); if (!d.open) d.showModal(); }
const suitClass = (s) => ({ '♠': 's-s', '♥': 's-h', '♦': 's-d', '♣': 's-c' }[s] || '');
// One playing card. c = null draws the back.
export function cardHTML(c, cls = '') {
  if (!c) return `<div class="card back ${cls}"></div>`;
  return `<div class="card ${suitClass(c.s)} ${cls}"><span class="ix"><span class="rk${c.r === '10' ? ' ten' : ''}">${c.r}</span><span class="sx">${c.s}</span></span><span class="st">${c.s}</span></div>`;
}

// ---------- The game switch ----------
export const GAMES = { blackjack: { name: 'Blackjack', page: './', icon: '🃏' }, poker: { name: 'Poker', page: 'poker.html', icon: '♠️' }, baccarat: { name: 'Baccarat', page: 'baccarat.html', icon: '🎴' }, roulette: { name: 'Roulette', page: 'roulette.html', icon: '🎡' } };
export function gameSwitchHTML(current) {
  return `<select class="game-switch" id="game-switch" title="Switch game" aria-label="Game">${Object.entries(GAMES).map(([k, g]) => `<option value="${k}"${k === current ? ' selected' : ''}${g.soon ? ' disabled' : ''}>${g.icon} ${g.name}${g.soon ? ' (soon)' : ''}</option>`).join('')}</select>`;
}
// Going to another game keeps the room code, so the same friends land at the same table of that game.
// The host of this table opens the other game's table when nobody has yet (open=1).
export function gameUrl(game, code, isHost, from = null) {
  const q = new URLSearchParams();
  // A blackjack table with this code exists only when the switch started from blackjack.
  let fromBj = null; try { fromBj = sessionStorage.getItem('games-from-bj'); } catch {}
  if (code && (game !== 'blackjack' || fromBj === code)) { q.set('room', code); q.set('go', '1'); if (isHost) q.set('open', '1'); }
  if (from) q.set('from', from); // the room then walks you over from that table
  for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure', '3d', 'flat', 'roomdebug']) if (params.get(k)) q.set(k, params.get(k));
  const qs = q.toString();
  return GAMES[game].page + (qs ? '?' + qs : '');
}
export function wireGameSwitch(current, getCode, getIsHost) {
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'game-switch') return;
    const g = e.target.value;
    if (g === current || !GAMES[g] || GAMES[g].soon) return;
    walkTo(current, g, gameUrl(g, getCode(), getIsHost(), current), getCode());
  });
}
// The same move, started by a tap on that game's table in the room.
// The first tap only asks, so a stray tap during a hand never takes you away from your table.
let goAsk = null;
export function goToGame(current, g, code, isHost) {
  if (g === current || !GAMES[g]) return;
  if (!goAsk || goAsk.g !== g || Date.now() - goAsk.t > 4000) { goAsk = { g, t: Date.now() }; toast(`Tap again to walk over to ${GAMES[g].name}.`); return; }
  walkTo(current, g, gameUrl(g, code, isHost, current), code);
}

// ---------- One wallet for the whole office ----------
// Walking to another table takes your chips along. This table writes them off as cashed out (your +/- here
// stays the same, so its ledger still adds up to zero), and the next table adds them as your buy-in. If a
// hand of yours is still being played, the chips stay here: a second tap walks over without them.
const CARRY_KEY = 'office-carry';
let cashOutFn = null, walking = false, walkAnyway = null;
export function setCashOut(fn) { cashOutFn = fn; }
function walkCover(text) {
  let el = document.getElementById('walk-cover');
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'walk-cover'; document.body.appendChild(el); }
  el.innerHTML = `<div class="walk-box">${esc(text)}</div>`;
  requestAnimationFrame(() => el.classList.add('on'));
}
export async function walkTo(current, g, url, code) {
  if (walking) return;
  walking = true;
  const name = GAMES[g]?.name || g;
  walkCover(`Walking over to ${name}…`);
  let amount = 0;
  const anyway = walkAnyway && walkAnyway.g === g && Date.now() - walkAnyway.t < 8000;
  if (cashOutFn && code && !anyway) {
    try { amount = Number(await cashOutFn()) || 0; } catch (e) {
      walking = false; walkCover(null);
      walkAnyway = { g, t: Date.now() };
      toast(`${e.message || 'Your chips could not leave this table.'} Tap again to walk over and leave your chips here.`);
      return;
    }
  }
  walkAnyway = null;
  if (amount > 0) safeSet(CARRY_KEY, JSON.stringify({ code, to: g, from: current, amount, cid: randomHex(6), t: Date.now() }));
  setTimeout(() => { location.href = url; }, amount > 0 ? 250 : 120);
}
// The chips this browser carries to this table, if any (they are kept for 10 minutes).
export function carryFor(game, code) {
  try {
    const c = JSON.parse(safeGet(CARRY_KEY) || 'null');
    if (!c || c.to !== game || c.code !== code || !(c.amount > 0) || Date.now() - c.t > 600000) return null;
    return { amount: c.amount, from: GAMES[c.from]?.name || 'another table', cid: c.cid };
  } catch { return null; }
}
// Called once the table shows this player: the chips have arrived.
export function carryDone(game, code) { if (carryFor(game, code)) safeDel(CARRY_KEY); }
// A player's side asks the host to cash them out: send({ t: 'cashout', rid }), the answer comes back as 'cashed'.
const cashWait = {};
export function askCashOut(send) {
  return new Promise((res, rej) => {
    const rid = randomHex(4);
    const timer = setTimeout(() => { delete cashWait[rid]; rej(new Error('The table did not answer.')); }, 5000);
    cashWait[rid] = (m) => { clearTimeout(timer); delete cashWait[rid]; if (m.err) rej(new Error(m.err)); else res(Number(m.amount) || 0); };
    try { send({ t: 'cashout', rid }); } catch { clearTimeout(timer); delete cashWait[rid]; rej(new Error('No link to the table.')); }
  });
}
export function gotCashed(m) { cashWait[m?.rid]?.(m); }

// ---------- The office ledger: every table's +/- for each player, and the total ----------
// Each table's host answers a peek with its ledger. This browser keeps the last one it saw of every table,
// so a table nobody hosts right now still shows its last numbers.
const OFFICE_KEY = 'office-ledger';
const cleanRows = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 40).filter((r) => r && typeof r === 'object')
  .map((r) => ({ id: String(r.id || '').slice(0, 40), name: String(r.name || 'Player').slice(0, 22), net: Math.round((Number(r.net) || 0) * 100) / 100, chips: Math.round((Number(r.chips) || 0) * 100) / 100 }));
export function officeSave(code, game, rows) {
  if (!code || !GAMES[game]) return;
  let o; try { o = JSON.parse(safeGet(OFFICE_KEY) || 'null'); } catch { o = null; }
  if (!o || o.code !== code) o = { code, games: {} };
  o.games[game] = { rows: cleanRows(rows), t: Date.now() };
  safeSet(OFFICE_KEY, JSON.stringify(o));
  seriesAdd(code, game, o.games[game].rows);
}
// Every +/- this browser sees (its own table and the others it peeks at every few seconds) is kept as a point
// in time, so the ledger can draw it. Only changes are kept, at most 600 points per player and table.
const SERIES_KEY = 'office-series';
function seriesGet(code) { let o; try { o = JSON.parse(safeGet(SERIES_KEY) || 'null'); } catch { o = null; } return o && o.code === code ? o : { code, s: {} }; }
function seriesAdd(code, game, rows) {
  const o = seriesGet(code), now = Date.now();
  let changed = false;
  for (const r of rows) {
    if (!r.id) continue;
    const g = (o.s[game] ||= {}), list = (g[r.id] ||= { name: r.name, pts: [] });
    list.name = r.name;
    const last = list.pts[list.pts.length - 1];
    if (last && last[1] === r.net && last[2] === r.chips) continue;
    list.pts.push([now, r.net, r.chips]); changed = true;
    if (list.pts.length > 600) list.pts.splice(0, list.pts.length - 600);
  }
  if (changed) safeSet(SERIES_KEY, JSON.stringify(o));
}
// One player's history over every table: each point is a moment the +/- at a table changed.
// total: the sum of the +/- of all tables at that moment. balance: the first buy-in seen plus that total,
// so chips bought in later are left out.
function playerSeries(code, id) {
  const o = seriesGet(code), ev = [];
  for (const g of Object.keys(o.s)) for (const pt of o.s[g][id]?.pts || []) ev.push({ t: pt[0], g, net: pt[1], chips: pt[2] });
  ev.sort((a, b) => a.t - b.t);
  const cur = {}, out = [];
  let first = null;
  for (const e of ev) {
    if (first === null) first = e.chips - e.net;
    cur[e.g] = e.net;
    const total = Math.round(Object.values(cur).reduce((a, x) => a + x, 0) * 100) / 100;
    out.push({ t: e.t, g: e.g, total, byGame: { ...cur }, balance: Math.round((first + total) * 100) / 100 });
  }
  return out;
}
const GAME_COLOR = { blackjack: '#3fe6d6', poker: '#9aa7ff', baccarat: '#f0a35e', roulette: '#e86a8a' };
// A small line chart in SVG. lines: [{ pts: [y...], color, width, dash }], bars: [y...] drawn as wins and losses.
function chartSVG({ lines, bars = null, n, label, money: fmt }) {
  const W = 640, H = 170, L = 52, R = 10, T = 12, B = 22;
  const all = [...(bars ? [0] : []), ...lines.flatMap((l) => l.pts), ...(bars || [])]; // the balance chart is not pinned to zero, so its changes show
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
  const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad].map((v) => Math.round(v));
  let svg = `<svg class="office-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
  if (lo <= 0 && hi >= 0) svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
  for (const v of ticks) svg += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  if (bars) { const bw = Math.max(1.5, Math.min(10, ((W - L - R) / Math.max(1, n)) * 0.6)); bars.forEach((v, i) => { if (v) svg += `<rect x="${x(i) - bw / 2}" y="${Math.min(y(v), y(0))}" width="${bw}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" class="${v > 0 ? 'win' : 'loss'}"/>`; }); }
  for (const l of lines) if (l.pts.length) svg += `<polyline fill="none" stroke="${l.color}" stroke-width="${l.width || 2}"${l.dash ? ' stroke-dasharray="5 4"' : ''} points="${l.pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
  return svg + '</svg>';
}
export function officeGraphHTML(code, id) {
  const ser = playerSeries(code, id);
  if (ser.length < 2) return '<p class="hint">The graph starts once this player has played a few rounds while this browser was at a table of the office.</p>';
  const n = ser.length, fmt = (v) => (v > 0 ? '+' : '') + money(v);
  const games = Object.keys(GAMES).filter((g) => ser.some((p) => g in p.byGame));
  const bars = ser.map((p, i) => Math.round((p.total - (i ? ser[i - 1].total : 0)) * 100) / 100);
  bars[0] = 0;
  const pnl = chartSVG({ n, label: 'Wins, losses and +/- over time', money: fmt, bars,
    lines: [...(games.length > 1 ? games.map((g) => ({ pts: ser.map((p) => p.byGame[g] ?? 0), color: GAME_COLOR[g], width: 1.2, dash: true })) : []), { pts: ser.map((p) => p.total), color: '#e8c46a', width: 2.4 }] });
  const bal = chartSVG({ n, label: 'Balance without buy-ins', money: (v) => money(v), lines: [{ pts: ser.map((p) => p.balance), color: '#5fd38d', width: 2.2 }] });
  const when = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const last = ser[n - 1];
  return `<div class="office-graph">
    <div class="og-head"><b>Wins, losses and +/-</b><span class="og-key"><i style="background:#e8c46a"></i>All tables${games.length > 1 ? games.map((g) => ` <i style="background:${GAME_COLOR[g]}"></i>${GAMES[g].name}`).join('') : ''} <i class="bar-w"></i>Win <i class="bar-l"></i>Loss</span></div>
    ${pnl}
    <div class="og-head"><b>Balance without buy-ins</b><span class="og-key">first buy-in plus +/-: ${money(last.balance)}</span></div>
    ${bal}
    <div class="og-foot"><span>${when(ser[0].t)}</span><span>${n} changes</span><span>${when(last.t)}</span></div></div>`;
}
export function officeLedgerHTML(code, myId) {
  let o; try { o = JSON.parse(safeGet(OFFICE_KEY) || 'null'); } catch { o = null; }
  if (!o || o.code !== code) return '<h3>All tables</h3><p class="hint">No table of this office has sent its ledger yet.</p>';
  const games = Object.keys(GAMES).filter((g) => o.games[g]);
  const people = {};
  for (const g of games) for (const r of o.games[g].rows) { const p = (people[r.id] ||= { id: r.id, name: r.name, nets: {}, total: 0 }); p.nets[g] = r.net; p.total = Math.round((p.total + r.net) * 100) / 100; }
  const list = Object.values(people).sort((a, b) => b.total - a.total);
  const cell = (n) => (n === undefined ? '<td class="dim">·</td>' : `<td class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : ''}${money(n)}</td>`);
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'live' : m + ' min ago'; };
  const sums = games.map((g) => o.games[g].rows.reduce((a, r) => a + r.net, 0));
  return `<h3>All tables</h3>
    <div class="office-wrap"><table class="office-table"><tr><th>Player</th>${games.map((g) => `<th>${GAMES[g].icon} ${GAMES[g].name}</th>`).join('')}<th>Total</th></tr>
    ${list.map((p) => `<tr class="${p.id === myId ? 'me' : ''}"><td>${esc(p.name)}${p.id === myId ? ' (you)' : ''}</td>${games.map((g) => cell(p.nets[g])).join('')}${cell(p.total)}</tr>`).join('')}
    <tr class="sum"><td>Total</td>${sums.map(cell).join('')}${cell(Math.round(sums.reduce((a, x) => a + x, 0) * 100) / 100)}</tr></table></div>
    <div class="office-graph-wrap"><label class="og-pick-l">Graph for <select class="og-pick" data-code="${esc(code)}">${list.map((p) => `<option value="${esc(p.id)}"${p.id === myId ? ' selected' : ''}>${esc(p.name)}${p.id === myId ? ' (you)' : ''}</option>`).join('')}</select></label>
      <div class="og-body">${officeGraphHTML(code, list.some((p) => p.id === myId) ? myId : list[0]?.id)}</div></div>
    <p class="hint">Each table keeps its own ledger, and each one adds up to zero. Chips you take to another table leave this one as cashed out, so your +/- per table stays the same. Updated: ${games.map((g) => `${GAMES[g].name} ${ago(o.games[g].t)}`).join(', ')}.</p>`;
}
export function showOffice(code, myId) {
  let d = document.getElementById('office-dlg');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'office-dlg'; d.className = 'office-dlg';
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-office-close]')) d.close(); });
    document.body.appendChild(d);
  }
  d.innerHTML = `<div class="office-body">${officeLedgerHTML(code, myId)}<button class="btn" data-office-close>Close</button></div>`;
  if (!d.open) d.showModal();
}
// Picking a player in the "All tables" view redraws that player's graph.
document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('.og-pick');
  if (!sel) return;
  const box = sel.closest('.office-graph-wrap');
  if (box) box.querySelector('.og-body').innerHTML = officeGraphHTML(sel.dataset.code, sel.value);
});

// ---------- "Connection dropped" ----------
// While this browser has no link to the table, its moves go nowhere. A clear notice says so and a see-through
// cover over the table blocks every button below the top bar, so nobody plays on without knowing. It goes
// away the moment the link is back.
export function showDropped(on, text = 'Your moves are not being sent. Trying to connect again…') {
  let el = document.getElementById('conn-drop');
  if (!on) { if (el) { el.remove(); document.body.classList.remove('conn-dropped'); } return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'conn-drop'; el.setAttribute('role', 'alert');
    el.innerHTML = '<div class="conn-drop-box"><b>Connection dropped</b><span></span></div>';
    for (const ev of ['click', 'pointerdown', 'pointerup', 'touchstart', 'wheel']) el.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'click' || ev === 'wheel') e.preventDefault(); }, { passive: false });
    document.body.appendChild(el); document.body.classList.add('conn-dropped');
  }
  const span = el.querySelector('span'); if (span.textContent !== text) span.textContent = text;
  const bar = document.querySelector('.topbar');
  el.style.top = (bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0) + 'px';
}

// ---------- The link between browsers ----------
export function peerOptions() {
  const host = params.get('peerhost');
  const config = { iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ], sdpSemantics: 'unified-plan' };
  if (!host) return { debug: 1, config };
  return { host, port: Number(params.get('peerport') || 443), path: params.get('peerpath') || '/', secure: params.get('peersecure') !== '0', debug: 1 };
}
// The host's side. on: { msg(id, m), gone(id), status(text, ok), taken() }.
export function createHost(peerId, on) {
  const conns = new Map(); // player id -> connection
  let peer = null, dead = false;
  // One link to a player, direct or through the second path (relay.js): the same handling for both.
  const wire = (conn) => {
    conn.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      // A player's sign of life, every few seconds: it tells the host who is still there (heard()).
      conn.rx = Date.now();
      if (m.t === 'ping') { conn.pings = true; return; }
      // Someone at another table of the office asks who sits here.
      if (m.t === 'peek') { try { conn.send({ t: 'people', list: (on.people?.() || []).slice(0, 12), ledger: on.ledger?.() || null }); } catch {} return; }
      if (m.t === 'hello') {
        const id = String(m.id || '').slice(0, 24);
        if (!id) return;
        const old = conns.get(id);
        if (old && old !== conn) { try { old.close(); } catch {} }
        conn.pid = id; conns.set(id, conn);
      }
      // A player's piece of the key to the hidden cards, asked for by a host that took the table over (js/vault.js). Direct links only.
      if (m.t === 'piece') { if (conn.pid && !conn.relay) on.piece?.(conn.pid, cleanPiece(m.piece)); return; }
      if (conn.pid) on.msg(conn.pid, m);
    });
    const bye = () => { if (conn.pid && conns.get(conn.pid) === conn) { conns.delete(conn.pid); on.gone?.(conn.pid); } };
    conn.on('close', bye); conn.on('error', bye);
  };
  const open = () => {
    peer = new Peer(peerId, peerOptions());
    peer.on('open', () => on.status?.('Live', true));
    peer.on('connection', wire);
    peer.on('disconnected', () => { if (dead || peer.destroyed) return; on.status?.('Reconnecting', false); setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch {} }, 1500); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { on.taken?.(); return; }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) on.status?.(relay?.open ? 'Live' : 'Reconnecting', !!relay?.open);
    });
  };
  // The second path: the host listens there all the time, for players whose network blocks the direct link.
  let relay = null;
  if (relayWorks() && params.get('relay') !== '0') { try { relay = hostRelay(peerId, params.get('relayurl') || '', { onLink: (link) => { if (dead) { link.close(); return; } wire(link); } }); } catch {} }
  open();
  // A small sign of life every 2 seconds, so a player's browser notices quickly when the host is gone.
  let tick = 0;
  const beat = setInterval(() => { tick++; for (const c of conns.values()) if (c.open && (!c.relay || tick % 2 === 0)) { try { c.send({ t: 'ping' }); } catch {} } }, 2000);
  return {
    send(id, m) { const c = conns.get(id); if (c && c.open) { try { c.send(m); } catch {} } },
    ids: () => [...conns.keys()],
    direct: (id) => { const c = conns.get(id); return !!(c && c.open && !c.relay); },
    // Milliseconds since this player's browser was last heard, or null when it sends no signs of life (an older page).
    quietFor(id) { const c = conns.get(id); return c && c.open && c.pings ? Date.now() - (c.rx || 0) - (c.relay ? 5000 : 0) : null; },
    close() { dead = true; clearInterval(beat); try { relay?.close(); } catch {} try { peer.destroy(); } catch {} },
  };
}
// The other tables of the same office. Every game has its own table under the same code; this asks each of the
// other three who sits there, every few seconds, so their people can be drawn at their table in the room.
// onPeople(game, list) gets [{ id, name, look, seat, seats }], or [] when that table is not open.
export const GAME_PREFIX = { blackjack: 'bjt-', poker: 'bjt-pk-', baccarat: 'bjt-bc-', roulette: 'bjt-ro-' };
export function watchOffice(current, getCode, onPeople, onLedger = null) {
  let peer = null, dead = false;
  const conns = {}, nextTry = {};
  const games = Object.keys(GAME_PREFIX).filter((g) => g !== current);
  const clean = (list) => (Array.isArray(list) ? list : []).slice(0, 12).filter((p) => p && typeof p === 'object' && Number.isInteger(p.seat) && p.seat >= 0 && p.seat < 12)
    .map((p) => ({ id: String(p.id || '').slice(0, 40), name: String(p.name || 'Player').slice(0, 22), look: { skin: Number(p.look?.skin) || 0, hair: Number(p.look?.hair) || 0, flag: typeof p.look?.flag === 'string' ? p.look.flag.slice(0, 8) : undefined }, seat: p.seat, seats: Math.max(1, Math.min(12, Number(p.seats) || 9)) }));
  const link = (g) => {
    const code = getCode();
    if (dead || !code || !peer || peer.destroyed || peer.disconnected || conns[g]) return;
    const c = peer.connect(GAME_PREFIX[g] + code, { reliable: true });
    conns[g] = c; c.game = g;
    const drop = () => { if (conns[g] === c) { delete conns[g]; nextTry[g] = Date.now() + 7000; onPeople(g, []); } };
    c.on('open', () => { try { c.send({ t: 'peek' }); } catch {} });
    c.on('data', (m) => { if (m && m.t === 'people') { onPeople(g, clean(m.list)); if (m.ledger) officeSave(getCode(), g, m.ledger); onLedger?.(g); } });
    c.on('close', drop); c.on('error', drop);
    setTimeout(() => { if (!c.open) { try { c.close(); } catch {} drop(); } }, 9000);
  };
  const tick = () => {
    if (dead) return;
    if (!peer || peer.destroyed) {
      peer = new Peer(peerOptions());
      peer.on('error', (e) => { if (e.type === 'peer-unavailable') { const g = games.find((x) => String(e.message || '').includes(GAME_PREFIX[x] + getCode()) && (x === 'blackjack' ? !/bjt-(pk|bc|ro)-/.test(String(e.message)) : true)); if (g && conns[g]) { const c = conns[g]; delete conns[g]; nextTry[g] = Date.now() + 7000; try { c.close(); } catch {} onPeople(g, []); } } });
      peer.on('disconnected', () => { try { if (!dead && !peer.destroyed) peer.reconnect(); } catch {} });
      return;
    }
    for (const g of games) {
      const c = conns[g];
      if (c && c.open) { try { c.send({ t: 'peek' }); } catch {} }
      else if (!c && Date.now() >= (nextTry[g] || 0)) link(g);
    }
  };
  const timer = setInterval(tick, 4000);
  setTimeout(tick, 600); setTimeout(tick, 2200);
  return { close() { dead = true; clearInterval(timer); try { peer?.destroy(); } catch {} } };
}
// A player's side. on: { msg(m), status(text, ok), open(), nohost() }. hello() gives the first message.
export function createGuest(peerId, hello, on) {
  // The locked copy of the table's hidden cards and this player's piece of its key (js/vault.js). The piece is
  // handed only to a host that asks for it over a direct link, which happens after a host change.
  let vbox = null, vpiece = null;
  const vaultMsg = (m, c, direct) => {
    if (m.t === 'vault') { vbox = cleanBox(m.box); vpiece = direct ? cleanPiece(m.piece) : null; return true; }
    if (m.t === 'piece-ask') { if (direct && vpiece && vpiece.kid === m.kid) { try { c.send({ t: 'piece', piece: vpiece }); } catch {} } return true; }
    return false;
  };
  let peer = null, conn = null, dead = false, tries = 0, timer = null, lastRx = 0, downAt = 0, relayBusy = false;
  const retry = () => { if (dead) return; clearTimeout(timer); timer = setTimeout(connect, Math.min(6000, 800 + tries++ * 700)); };
  const connect = () => {
    if (dead || params.get('relay') === 'only') return;
    if (conn && conn.relay && conn.open) return; // the second path is carrying the game: leave it alone
    if (!peer || peer.destroyed) { start(); return; }
    if (peer.disconnected) { try { peer.reconnect(); } catch {} retry(); return; }
    const c = peer.connect(peerId, { reliable: true });
    conn = c;
    const giveUp = setTimeout(() => { if (!c.open && conn === c) { try { c.close(); } catch {} retry(); } }, 9000);
    c.on('open', () => { clearTimeout(giveUp); if (conn !== c) { const old = conn; conn = c; try { old?.close(); } catch {} } tries = 0; lastRx = Date.now(); on.status?.('Live', true); c.send(hello()); on.open?.(); });
    c.on('data', (m) => { lastRx = Date.now(); if (m && typeof m === 'object' && m.t !== 'ping' && !vaultMsg(m, c, true)) on.msg(m); });
    c.on('close', () => { clearTimeout(giveUp); if (conn === c) { on.status?.('Reconnecting', false); retry(); } });
    c.on('error', () => { clearTimeout(giveUp); if (conn === c) retry(); });
  };
  const start = () => {
    if (params.get('relay') === 'only') return; // for testing the second path on its own
    peer = new Peer(peerOptions());
    peer.on('open', connect);
    peer.on('disconnected', () => { if (!dead) { on.status?.('Reconnecting', false); retry(); } });
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') { if (!(conn && conn.relay && conn.open)) on.nohost?.(); retry(); return; }
      if (!(conn && conn.relay && conn.open)) on.status?.('Reconnecting', false);
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) retry();
    });
  };
  // The direct link does not open (some networks block it): come in through the second path, where the host always listens.
  const tryRelay = async () => {
    if (relayBusy || dead || !relayWorks() || params.get('relay') === '0') return;
    relayBusy = true;
    try {
      const link = await guestRelay(peerId, params.get('relayurl') || '', String(hello().id || '').slice(0, 24), 15000);
      if (!link) return;
      if (dead || (conn && conn.open)) { link.close(); return; }
      const old = conn; conn = link;
      try { old?.close(); } catch {}
      link.on('data', (m) => { lastRx = Date.now(); if (m && typeof m === 'object' && m.t !== 'ping' && !vaultMsg(m, link, false)) on.msg(m); });
      link.on('close', () => { if (conn === link) { conn = null; on.status?.('Reconnecting', false); retry(); } });
      tries = 0; lastRx = Date.now(); downAt = 0;
      on.status?.('Live', true); link.send(hello()); on.open?.();
    } finally { relayBusy = false; }
  };
  start();
  // Nothing heard from the host for 5.5 seconds (9 on the second path): the link is dead even when the browser has not said so yet.
  let beatN = 0;
  const watch = setInterval(() => {
    if (dead) return;
    // A sign of life to the host every 3 seconds (4.5 on the second path).
    if (conn && conn.open && ++beatN % (conn.relay ? 3 : 2) === 0) { try { conn.send({ t: 'ping' }); } catch {} }
    if (!conn || !conn.open) { downAt ||= Date.now(); if (Date.now() - downAt > 4500 || params.get('relay') === 'only') tryRelay(); return; }
    downAt = 0;
    if (Date.now() - lastRx < (conn.relay ? 9000 : 5500)) return;
    const c = conn; conn = null;
    on.status?.('Reconnecting', false);
    try { c.close(); } catch {}
    retry();
  }, 1500);
  return {
    send(m) { if (conn && conn.open) { try { conn.send(m); return true; } catch {} } return false; },
    vault: () => ({ box: vbox, piece: vpiece }),
    close() { dead = true; clearTimeout(timer); clearInterval(watch); try { conn?.close(); } catch {} try { peer?.destroy(); } catch {} },
  };
}

// ---------- The dealer bar and the ledger of roulette and baccarat (rule: js/bank.js) ----------
// Shown above the status line. No dealer: frozen ledger, practice. A dealer: real chips against that player.
export function bankBarHTML(st, myId, isHost) {
  const me = st.players.find((p) => p.id === myId), seated = me && me.seat >= 0;
  if (st.frozen) return `<div class="bank-bar frozen"><b>Frozen ledger</b><span>Practice against the house. Chips go back when a player is the dealer.</span>${seated ? '<button class="btn small gold" data-act="bank-on">Be the dealer</button>' : ''}</div>`;
  const b = st.players.find((p) => p.id === st.bankId);
  const leaving = !!st.bankLeaving;
  const mineBtn = st.bankId === myId ? `<button class="btn small ${leaving ? 'gold' : ''}" data-act="bank-off">${leaving ? 'Stopping after this round: keep dealing' : 'Stop dealing after this round'}</button>` : (isHost ? '<button class="btn small" data-act="bank-off">Remove dealer</button>' : '');
  return `<div class="bank-bar${leaving ? ' leaving' : ''}"><b>Dealer: ${esc(b ? b.name : '?')}${st.bankId === myId ? ' (you)' : ''}${leaving ? ' (stopping after this round)' : ''}</b><span>Real chips. The ledger adds up to zero.</span>${mineBtn}</div>`;
}
export function bankLedgerHTML(st, myId) {
  const rows = [...st.players].sort((a, b) => b.net - a.net);
  const cell = (n) => `<td class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : ''}${money(Math.round(n * 100) / 100)}</td>`;
  const sum = Math.round(rows.reduce((a, r) => a + r.net, 0) * 100) / 100;
  return `<h3>Ledger${st.frozen ? ' (frozen)' : ''}</h3><div class="ledger-body"><table class="pk-table"><tr><th>Player</th><th>Bought in</th><th>Chips</th><th>+/-</th></tr>${rows.map((r) => { const b = st.frozen && r.base ? r.base : r; return `<tr class="${r.id === myId ? 'me' : ''}"><td>${esc(r.name)}${r.id === st.bankId ? ' (dealer)' : ''}</td><td>${money(b.totalIn)}</td><td>${money(b.chips)}</td>${cell(r.net)}</tr>`; }).join('')}<tr><td>Total</td><td></td><td></td>${cell(sum)}</tr></table><p class="hint">The +/- column counts only rounds played with a player as the dealer, so it always adds up to zero. Rounds against the house are practice and are left out${st.frozen ? '. The ledger is frozen now: the chips on the table are practice chips' : ''}.</p><button class="btn small office-btn" data-act="office">🏢 All tables</button></div>`;
}
