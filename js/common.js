// Shared by the poker and baccarat pages: small helpers, the playing card picture, the game switch at the
// top left, and the link between the host's browser and the players' browsers.
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
export const GAMES = { blackjack: { name: 'Blackjack', page: './', icon: '🃏' }, poker: { name: 'Poker', page: 'poker.html', icon: '♠️' }, baccarat: { name: 'Baccarat', icon: '🎴', soon: true }, roulette: { name: 'Roulette', icon: '🎡', soon: true } };
export function gameSwitchHTML(current) {
  return `<select class="game-switch" id="game-switch" title="Switch game" aria-label="Game">${Object.entries(GAMES).map(([k, g]) => `<option value="${k}"${k === current ? ' selected' : ''}${g.soon ? ' disabled' : ''}>${g.icon} ${g.name}${g.soon ? ' (soon)' : ''}</option>`).join('')}</select>`;
}
// Going to another game keeps the room code, so the same friends land at the same table of that game.
// The host of this table opens the other game's table when nobody has yet (open=1).
export function gameUrl(game, code, isHost) {
  const q = new URLSearchParams();
  // A blackjack table with this code exists only when the switch started from blackjack.
  let fromBj = null; try { fromBj = sessionStorage.getItem('games-from-bj'); } catch {}
  if (code && (game !== 'blackjack' || fromBj === code)) { q.set('room', code); q.set('go', '1'); if (isHost) q.set('open', '1'); }
  for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure', '3d', 'flat', 'roomdebug']) if (params.get(k)) q.set(k, params.get(k));
  const qs = q.toString();
  return GAMES[game].page + (qs ? '?' + qs : '');
}
export function wireGameSwitch(current, getCode, getIsHost) {
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'game-switch') return;
    const g = e.target.value;
    if (g === current || !GAMES[g] || GAMES[g].soon) return;
    location.href = gameUrl(g, getCode(), getIsHost());
  });
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
  const open = () => {
    peer = new Peer(peerId, peerOptions());
    peer.on('open', () => on.status?.('Live', true));
    peer.on('connection', (conn) => {
      conn.on('data', (m) => {
        if (!m || typeof m !== 'object') return;
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
    });
    peer.on('disconnected', () => { if (dead || peer.destroyed) return; on.status?.('Reconnecting', false); setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch {} }, 1500); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { on.taken?.(); return; }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) on.status?.('Reconnecting', false);
    });
  };
  open();
  // A small sign of life every 2 seconds, so a player's browser notices quickly when the host is gone.
  const beat = setInterval(() => { for (const c of conns.values()) if (c.open) { try { c.send({ t: 'ping' }); } catch {} } }, 2000);
  return {
    send(id, m) { const c = conns.get(id); if (c && c.open) { try { c.send(m); } catch {} } },
    ids: () => [...conns.keys()],
    close() { dead = true; clearInterval(beat); try { peer.destroy(); } catch {} },
  };
}
// A player's side. on: { msg(m), status(text, ok), open(), nohost() }. hello() gives the first message.
export function createGuest(peerId, hello, on) {
  let peer = null, conn = null, dead = false, tries = 0, timer = null, lastRx = 0;
  const retry = () => { if (dead) return; clearTimeout(timer); timer = setTimeout(connect, Math.min(6000, 800 + tries++ * 700)); };
  const connect = () => {
    if (dead) return;
    if (!peer || peer.destroyed) { start(); return; }
    if (peer.disconnected) { try { peer.reconnect(); } catch {} retry(); return; }
    const c = peer.connect(peerId, { reliable: true });
    conn = c;
    const giveUp = setTimeout(() => { if (!c.open && conn === c) { try { c.close(); } catch {} retry(); } }, 9000);
    c.on('open', () => { clearTimeout(giveUp); tries = 0; lastRx = Date.now(); on.status?.('Live', true); c.send(hello()); on.open?.(); });
    c.on('data', (m) => { lastRx = Date.now(); if (m && typeof m === 'object' && m.t !== 'ping') on.msg(m); });
    c.on('close', () => { clearTimeout(giveUp); if (conn === c) { on.status?.('Reconnecting', false); retry(); } });
    c.on('error', () => { clearTimeout(giveUp); if (conn === c) retry(); });
  };
  const start = () => {
    peer = new Peer(peerOptions());
    peer.on('open', connect);
    peer.on('disconnected', () => { if (!dead) { on.status?.('Reconnecting', false); retry(); } });
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') { on.nohost?.(); retry(); return; }
      on.status?.('Reconnecting', false);
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) retry();
    });
  };
  start();
  // Nothing heard from the host for 5.5 seconds: the link is dead even when the browser has not said so yet.
  const watch = setInterval(() => {
    if (dead || !conn || !conn.open || Date.now() - lastRx < 5500) return;
    const c = conn; conn = null;
    on.status?.('Reconnecting', false);
    try { c.close(); } catch {}
    retry();
  }, 1500);
  return {
    send(m) { if (conn && conn.open) { try { conn.send(m); return true; } catch {} } return false; },
    close() { dead = true; clearTimeout(timer); clearInterval(watch); try { peer.destroy(); } catch {} },
  };
}
