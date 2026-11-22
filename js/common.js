// Shared by the poker and baccarat pages: small helpers, the playing card picture, the game switch at the
// top left, and the link between the host's browser and the players' browsers.
import { hostRelay, guestRelay, relayWorks } from './relay.js?v=20261122c';
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
    location.href = gameUrl(g, getCode(), getIsHost(), current);
  });
}
// The same move, started by a tap on that game's table in the room.
// The first tap only asks, so a stray tap during a hand never takes you away from your table.
let goAsk = null;
export function goToGame(current, g, code, isHost) {
  if (g === current || !GAMES[g]) return;
  if (!goAsk || goAsk.g !== g || Date.now() - goAsk.t > 4000) { goAsk = { g, t: Date.now() }; toast(`Tap again to walk over to ${GAMES[g].name}.`); return; }
  location.href = gameUrl(g, code, isHost, current);
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
      if (m.t === 'peek') { try { conn.send({ t: 'people', list: (on.people?.() || []).slice(0, 12) }); } catch {} return; }
      if (m.t === 'hello') {
        const id = String(m.id || '').slice(0, 24);
        if (!id) return;
        const old = conns.get(id);
        if (old && old !== conn) { try { old.close(); } catch {} }
        conn.pid = id; conns.set(id, conn);
      }
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
    // Milliseconds since this player's browser was last heard, or null when it sends no signs of life (an older page).
    quietFor(id) { const c = conns.get(id); return c && c.open && c.pings ? Date.now() - (c.rx || 0) - (c.relay ? 5000 : 0) : null; },
    close() { dead = true; clearInterval(beat); try { relay?.close(); } catch {} try { peer.destroy(); } catch {} },
  };
}
// The other tables of the same office. Every game has its own table under the same code; this asks each of the
// other three who sits there, every few seconds, so their people can be drawn at their table in the room.
// onPeople(game, list) gets [{ id, name, look, seat, seats }], or [] when that table is not open.
export const GAME_PREFIX = { blackjack: 'bjt-', poker: 'bjt-pk-', baccarat: 'bjt-bc-', roulette: 'bjt-ro-' };
export function watchOffice(current, getCode, onPeople) {
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
    c.on('data', (m) => { if (m && m.t === 'people') onPeople(g, clean(m.list)); });
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
    c.on('data', (m) => { lastRx = Date.now(); if (m && typeof m === 'object' && m.t !== 'ping') on.msg(m); });
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
      link.on('data', (m) => { lastRx = Date.now(); if (m && typeof m === 'object' && m.t !== 'ping') on.msg(m); });
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
    close() { dead = true; clearTimeout(timer); clearInterval(watch); try { conn?.close(); } catch {} try { peer?.destroy(); } catch {} },
  };
}

// ---------- The dealer bar and the ledger of roulette and baccarat (rule: js/bank.js) ----------
// Shown above the status line. No dealer: frozen ledger, practice. A dealer: real chips against that player.
export function bankBarHTML(st, myId, isHost) {
  const me = st.players.find((p) => p.id === myId), seated = me && me.seat >= 0;
  if (st.frozen) return `<div class="bank-bar frozen"><b>Frozen ledger</b><span>Practice against the house. Chips go back when a player is the dealer.</span>${seated ? '<button class="btn small gold" data-act="bank-on">Be the dealer</button>' : ''}</div>`;
  const b = st.players.find((p) => p.id === st.bankId);
  return `<div class="bank-bar"><b>Dealer: ${esc(b ? b.name : '?')}${st.bankId === myId ? ' (you)' : ''}</b><span>Real chips. The ledger adds up to zero.</span>${st.bankId === myId || isHost ? `<button class="btn small" data-act="bank-off">${st.bankId === myId ? 'Stop dealing' : 'Remove dealer'}</button>` : ''}</div>`;
}
export function bankLedgerHTML(st, myId) {
  const rows = [...st.players].sort((a, b) => b.net - a.net);
  const cell = (n) => `<td class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : ''}${money(Math.round(n * 100) / 100)}</td>`;
  const sum = Math.round(rows.reduce((a, r) => a + r.net, 0) * 100) / 100;
  return `<h3>Ledger${st.frozen ? ' (frozen)' : ''}</h3><div class="ledger-body"><table class="pk-table"><tr><th>Player</th><th>Bought in</th><th>Chips</th><th>+/-</th></tr>${rows.map((r) => { const b = st.frozen && r.base ? r.base : r; return `<tr class="${r.id === myId ? 'me' : ''}"><td>${esc(r.name)}${r.id === st.bankId ? ' (dealer)' : ''}</td><td>${money(b.totalIn)}</td><td>${money(b.chips)}</td>${cell(r.net)}</tr>`; }).join('')}<tr><td>Total</td><td></td><td></td>${cell(sum)}</tr></table><p class="hint">The +/- column counts only rounds played with a player as the dealer, so it always adds up to zero. Rounds against the house are practice and are left out${st.frozen ? '. The ledger is frozen now: the chips on the table are practice chips' : ''}.</p></div>`;
}
