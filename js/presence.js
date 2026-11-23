// Everyone in the office, live. Every browser in the same office (same room code) sends where its player
// stands, which way they face and where they look, about 12 times a second while it changes (6 on a phone) and
// once every 2 seconds while it does not. It also sends a short word when its player does something at a table
// (hit, stand, bet, fold, shout), so their figure makes that move on everybody's screen at that moment.
// Nothing about cards, bets or the shoe is ever in these messages: only a place, a direction, a name, a look
// and the kind of move.
//
// How browsers find each other: the first one to open the office takes the office's meeting name ('bjo-' + code)
// and passes every message on to all the others; everybody else links to it. When that browser leaves, the
// next one to notice takes the name over, so the office never depends on any one table's host.
import { peerOptions } from './common.js?v=20261123h';

const GAMES = ['blackjack', 'poker', 'baccarat', 'roulette'];
const KINDS = ['tap', 'wave', 'push', 'fold', 'react'];
const num = (x, lim) => { const n = Number(x); return Number.isFinite(n) ? Math.max(-lim, Math.min(lim, n)) : 0; };
const NOROOM = { livePose() {}, liveGone() {}, gesture() {}, pose: () => null };
const r2 = (x) => Math.round(x * 100) / 100;

// The move a figure makes for a message the player sends to the table. Moves the table plays by itself
// (auto play for an away player) are not the player's own, so they are left out.
export function actKind(m) {
  if (!m || typeof m !== 'object' || m.auto) return null;
  if (m.t === 'action') return { hit: 'tap', stand: 'wave', double: 'push', split: 'push', surrender: 'wave', insurance: 'push' }[m.a] || null;
  if (m.t === 'insurance') return 'push';
  if (m.t === 'act') return { fold: 'fold', check: 'tap', call: 'push', bet: 'push', raise: 'push', allin: 'push' }[m.a] || null;
  if (m.t === 'bet' || m.t === 'rebet') return 'push';
  if (m.t === 'clear' || m.t === 'unbet') return 'wave';
  if (m.t === 'peel' || m.t === 'show') return 'tap';
  if (m.t === 'throw' || m.t === 'hurry' || m.t === 'fx' || m.t === 'punch') return 'react';
  return null;
}

// game: this page's game. room(): its 3D room (js/room3d.js), or null while there is none. code(): the office code. me(): { id, name, look }.
// at(): true while this player has a place at this table (a seat or the dealer's spot).
export function startPresence({ game, room, code, me, at, phone = false }) {
  if (typeof Peer === 'undefined') return null;
  const R = () => room() || NOROOM;
  const HZ = phone ? 6 : 12;
  let peer = null, up = null, hub = false, dead = false, again = null, startedFor = '';
  const conns = new Set(), last = new Map(); // the meeting browser: every link, and everybody's last place
  const heard = new Map(); // id -> time last heard (to say goodbye for people behind a link that closed)
  const myId = () => String(me().id || '').slice(0, 40);

  const apply = (m) => {
    if (!m || typeof m !== 'object' || typeof m.i !== 'string') return;
    const id = m.i.slice(0, 40);
    if (!id || id === myId()) return;
    if (m.t === 'p') {
      heard.set(id, Date.now());
      R().livePose(id, { n: String(m.n || 'Player').slice(0, 22), l: { skin: num(m.l?.skin, 9) | 0, hair: num(m.l?.hair, 9) | 0, flag: typeof m.l?.flag === 'string' ? m.l.flag.slice(0, 8) : undefined },
        at: GAMES.includes(m.at) ? m.at : '', x: num(m.x, 60), z: num(m.z, 60), fx: num(m.fx, 1), fz: num(m.fz, 1), p: num(m.p, 1.6) });
    } else if (m.t === 'g' && KINDS.includes(m.k)) R().gesture(id, m.k);
    else if (m.t === 'b') { heard.delete(id); R().liveGone(id); }
  };
  // The meeting browser passes each message on to everybody else and keeps the last place of each person,
  // so somebody who comes in later sees everyone at once.
  const fanOut = (m, from = null) => {
    if (m.t === 'p') last.set(m.i, m); else if (m.t === 'b') last.delete(m.i);
    for (const c of conns) if (c !== from && c.open) { try { c.send(m); } catch { /* gone */ } }
  };
  const out = (m) => {
    if (hub) fanOut(m);
    else if (up?.open) { try { up.send(m); } catch { /* gone */ } }
  };

  const retry = (ms) => { clearTimeout(again); if (!dead) again = setTimeout(start, ms); };
  const trail = [];
  const note = (x) => { trail.push(x); if (trail.length > 30) trail.shift(); };
  function start() {
    clearTimeout(again);
    if (dead) return;
    const c0 = code();
    if (!c0) { retry(2000); return; }
    startedFor = c0; note('start'); startAt = Date.now();
    try { peer?.destroy(); } catch { /* fine */ }
    hub = false; up = null; conns.clear();
    const p = new Peer('bjo-' + c0, peerOptions());
    peer = p;
    p.on('open', () => { if (peer === p) { hub = true; startAt = 0; note('hub'); } });
    p.on('connection', (c) => {
      if (peer !== p) return;
      c.ids = new Set();
      c.on('open', () => { c.rx = Date.now(); conns.add(c); for (const m of last.values()) { try { c.send(m); } catch { /* gone */ } } });
      c.on('data', (m) => { c.rx = Date.now(); if (!m || typeof m !== 'object' || typeof m.i !== 'string') return; c.ids.add(m.i); fanOut(m, c); apply(m); });
      const drop = c.drop = () => { if (!conns.delete(c)) return; try { c.close(); } catch { /* gone */ } for (const id of c.ids) { const b = { t: 'b', i: id }; fanOut(b); apply(b); } };
      c.on('close', drop); c.on('error', drop);
    });
    p.on('disconnected', () => { try { if (!dead && peer === p && !p.destroyed) p.reconnect(); } catch { /* fine */ } });
    p.on('error', (e) => {
      if (peer !== p) return;
      note('err ' + e.type);
      if (e.type === 'unavailable-id') { join(); return; } // somebody else holds the office: link to them
      if (e.type === 'peer-unavailable') { retry(800 + Math.random() * 1500); return; } // the meeting browser just left: try to take over
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) retry(4000);
    });
  }
  function join() {
    clearTimeout(again); note('join');
    try { peer?.destroy(); } catch { /* fine */ }
    const p = new Peer(peerOptions());
    peer = p; hub = false;
    p.on('open', () => {
      if (peer !== p) return;
      const c = p.connect('bjo-' + startedFor, { reliable: true });
      up = c;
      const giveUp = setTimeout(() => { if (!c.open && up === c) retry(1000 + Math.random() * 2000); }, 9000);
      c.on('open', () => { clearTimeout(giveUp); lastKey = ''; upRx = Date.now(); startAt = 0; note('linked'); });
      c.on('data', (m) => { upRx = Date.now(); apply(m); });
      const drop = c.drop = () => { clearTimeout(giveUp); if (up !== c) return; up = null; try { c.close(); } catch { /* gone */ } for (const id of heard.keys()) R().liveGone(id); heard.clear(); retry(400 + Math.random() * 1600); };
      c.on('close', drop); c.on('error', drop);
    });
    p.on('disconnected', () => { try { if (!dead && peer === p && !p.destroyed) p.reconnect(); } catch { /* fine */ } });
    p.on('error', (e) => { if (peer !== p) return; note('jerr ' + e.type); if (e.type === 'peer-unavailable') retry(300 + Math.random() * 1200); else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) retry(4000); });
  }

  // A link that went quiet is over (a closed browser is not always noticed at once): the meeting browser says
  // something every 2 seconds and everybody else sends their place at least that often.
  let upRx = 0, startAt = 0;
  const watch = setInterval(() => {
    if (dead) return;
    const now = Date.now();
    if (hub) { for (const c of conns) { if (c.open) { try { c.send({ t: 'k', i: '' }); } catch { /* gone */ } } if (now - (c.rx || 0) > 6500) c.drop?.(); } }
    else if (up?.open && now - upRx > 6500) up.drop?.();
    else if (!up?.open && startAt && now - startAt > 15000) { startAt = now; start(); } // stuck finding the office: start over
  }, 2000);
  // Sending my own place. A table open out of sight in the office frame sends nothing: the one on screen does.
  let lastKey = '', lastAt = 0;
  const tick = () => {
    if (dead) return;
    if (code() && code() !== startedFor) { start(); return; }
    if (window.__officeAway) return;
    const p = R().pose?.();
    if (!p) return;
    const M = me();
    const m = { t: 'p', i: myId(), n: String(M.name || 'Player').slice(0, 22), l: M.look || {}, g: game, at: !p.free && at() ? game : '', x: r2(p.x), z: r2(p.z), fx: r2(p.fx), fz: r2(p.fz), p: r2(p.p) };
    const key = JSON.stringify([m.n, m.at, m.x, m.z, m.fx, m.fz, m.p]), now = Date.now();
    if (key === lastKey && now - lastAt < 2000) return;
    lastKey = key; lastAt = now;
    out(m);
  };
  const timer = setInterval(tick, 1000 / HZ);
  const bye = () => { if (!window.__officeAway) out({ t: 'b', i: myId() }); };
  addEventListener('pagehide', bye);
  start();

  const api = {
    // A move of mine at the table: my own figure makes it here at once and everybody else's a moment later.
    act(kind) { if (!KINDS.includes(kind) || window.__officeAway) return; R().gesture(myId(), kind); out({ t: 'g', i: myId(), k: kind }); },
    actFor(m) { const k = actKind(m); if (k) api.act(k); },
    info: () => ({ trail: trail.join(','), hub, linked: hub ? conns.size : up?.open ? 1 : 0, people: [...heard.keys()] }),
    close() { dead = true; clearInterval(timer); clearInterval(watch); clearTimeout(again); removeEventListener('pagehide', bye); bye(); try { peer?.destroy(); } catch { /* fine */ } },
  };
  window.__presence = api;
  return api;
}
