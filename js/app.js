// Screens and networking. The host's browser runs the Table (js/game.js) and sends
// each player a copy of what they are allowed to see. Players send their moves back.
// Browsers talk to each other directly with PeerJS (WebRTC), so no game server is needed.
import { Table, SIDE_BETS, SIDE_KEYS, handTotal, sha256 } from './game.js?v=20261121s';
import { hostRelay, guestRelay, relayWorks } from './relay.js?v=20261121s';
import { bestMove, strategyChart, describeHand, MOVE_NAMES, handOdds } from './strategy.js?v=20261121s';
import { tickSound, winSound } from './fx.js?v=20261121s';
import * as HX from './history.js?v=20261121s';
import { webglOK, initRoom } from './room3d.js?v=20261121s';
import { watchOffice } from './common.js?v=20261121s';
import { chipSound, cardSound, hitSound, standSound, throwSound, flyChip, stackHTML, chipClass, isMuted, setMuted } from './fx.js?v=20261121s';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const params = new URLSearchParams(location.search);
const ROOM_PREFIX = 'bjt-';
const CHIPS = [1, 5, 25, 100, 500];
const VOTE_SECONDS = 20;

const S = {
  role: null,        // 'host' or 'player'
  code: null,
  myId: getClientId(),
  name: safeGet('bj-name') || '',
  state: null,
  online: false,
  chip: null,
  sideChips: {},
  seen: new Set(),
  train: { right: 0, total: 0 },
  open: new Set(),   // menu folders that are open
  undo: [],          // my bet before each chip, for Undo
  mainChips: [],     // chips I put on my main bet, in order
  cardAt: new Map(), // card key -> time it is dealt
  nextCardAt: 0,
  holeHidden: new Set(),
  prevView: null,
  pend: null,        // my newest bet while the table has not confirmed it yet: { bet, ready, seq, round, at }
  betSeq: Date.now() % 1e9,
  serverBet: null,   // my bet as the table last sent it
  dealEnds: 0,       // when the last card now flying lands
  dealStart: 0,
  dealMany: false,   // the cards now flying are a whole deal, not one card for a hit
  goneTimers: {},    // host only: clientId -> timer that stands a player who dropped out
  // host only
  table: null,
  peer: null,
  conns: {},
  dealerTimer: null,
  autoDealTimer: null,
  settingsKey: '',
  timer: null,      // { key, kind, ends, handle }
  timerEnds: 0,
  timerKind: null,
  // player only
  conn: null,
  retry: 0,
};

if (safeGet('bj-four') === '1') document.body.classList.add('four-colour');

// ---------- Small helpers ----------
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
// The view buttons (Look left, Look right, Reset view, Walk around, zoom) are hidden unless switched on in the menu.
function viewPadOn() { return safeGet('bj-view-pad') === '1'; }
document.body.classList.toggle('view-hidden', !viewPadOn());
function safeDel(k) { try { localStorage.removeItem(k); } catch {} }
// What a guest typed to join a table, kept for this browser tab so a reload goes straight back in.
function sessGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
function sessDel(k) { try { sessionStorage.removeItem(k); } catch {} }
function getClientId() {
  let id = safeGet('bj-client-id');
  if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); safeSet('bj-client-id', id); }
  return id;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money(n) { return Number(n).toLocaleString(); }
function newCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
// One small line for the "cannot reach the host" box, so a screenshot shows what went wrong.
function linkNote() {
  const l = S.link;
  if (!l) return '';
  const names = { host: 'local', srflx: 'public', prflx: 'public', relay: 'relay' };
  const kinds = [...new Set([...l.kinds].map((k) => names[k] || k))];
  return `<small class="link-note">Details: tries ${(S.linkTries || 0) + 1}, link ${esc(l.state)}, paths found: ${kinds.length ? kinds.join(', ') : 'none yet'}.</small>`;
}
function peerOptions() {
  // Optional: ?peerhost=... lets you use your own PeerJS server instead of the free public one.
  const host = params.get('peerhost');
  // How two browsers find a path to each other. First they try a direct link (the "stun" helpers tell each
  // browser its public address). When a network blocks direct links, the "turn" helpers pass the data along
  // instead. The second turn helper also listens on the ports web pages use (80 and 443), which strict
  // office and school networks leave open.
  const config = { iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ], sdpSemantics: 'unified-plan' };
  if (!host) return { debug: 1, config };
  return { host, port: Number(params.get('peerport') || 443), path: params.get('peerpath') || '/', secure: params.get('peersecure') !== '0', debug: 1 };
}
function shareLink() {
  const q = new URLSearchParams();
  q.set('room', S.code);
  for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure']) if (params.get(k)) q.set(k, params.get(k));
  return location.origin + location.pathname + '?' + q.toString();
}

// ---------- Landing ----------
function showLanding() {
  const room = params.get('room');
  const saved = safeGet('bj-host');
  let savedCode = null;
  try { savedCode = saved && JSON.parse(saved).code; } catch {}
  app.innerHTML = `
    <div class="landing">
      <div class="hero-cards">${cardHTML({ r: 'A', s: '♠' }, true)}${cardHTML({ r: 'K', s: '♥' }, true)}</div>
      <div class="game-switch-row"><select class="game-switch" id="game-switch" title="Switch game" aria-label="Game"><option value="blackjack" selected>🃏 Blackjack</option><option value="poker">♠️ Poker</option><option value="baccarat">🎴 Baccarat</option><option value="roulette">🎡 Roulette</option></select></div>
      <h1>Blackjack Table</h1>
      <p>${room ? `You were invited to table <b>${esc(room)}</b>. Pick a name and join.` : 'Host a table, send the link to your friends, and play live. Play money only.'}</p>
      <div class="box">
        <label for="name">Your name</label>
        <input id="name" maxlength="16" placeholder="e.g. Sam" value="${esc(S.name)}" autocomplete="nickname" />
        <label for="buyin">💵 How much do you want to buy in for?</label>
        <input id="buyin" type="number" min="1" step="1" inputmode="numeric" placeholder="Any amount, e.g. 1000" value="${esc(safeGet('bj-buyin') || '')}" />
        <label>🧑 Your character (seen in the 3D room)</label>
        ${lookPickerHTML()}
        ${room ? `<button class="btn primary big" data-act="join">Join table</button>` : `
          <button class="btn primary big" data-act="host">Host a new table</button>
          ${savedCode ? `<button class="btn" data-act="resume">Resume my table (${esc(savedCode)})</button>` : ''}
          <div class="or">or join a friend's table</div>
          <div class="row"><input id="code" placeholder="Table code" maxlength="12" /><button class="btn" data-act="join-code">Join</button></div>`}
      </div>
    </div>`;
  const name = $('#name');
  name.focus();
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('[data-act=join], [data-act=host]').click(); });
}

// The look of your character in the 3D room.
const SKINS = ['#f6d7b8', '#eac39a', '#d6a373', '#b97f4f', '#8a5a36', '#5a3a24'];
const FLAGS = ['', '🇨🇳', '🇮🇳', '🇳🇬', '🇬🇭', '🇰🇪', '🇿🇦', '🇪🇹', '🇯🇲', '🇭🇰', '🇹🇼', '🇸🇬', '🇲🇾', '🇯🇵', '🇰🇷', '🇻🇳', '🇹🇭', '🇵🇭', '🇮🇩', '🇵🇰', '🇧🇩', '🇱🇰', '🇳🇵', '🇺🇸', '🇨🇦', '🇬🇧', '🇦🇺', '🇫🇷', '🇩🇪', '🇮🇹', '🇪🇸', '🇧🇷', '🇲🇽', '🇦🇪', '🇸🇦', '🇹🇷', '🇪🇬'];
const HAIRS = ['#17120f', '#3b2416', '#7a4a22', '#c9a15a', '#9aa0a6'];
function readLook() {
  let l = {};
  try { l = JSON.parse(safeGet('bj-look') || '{}') || {}; } catch {}
  return { skin: Number.isInteger(l.skin) ? l.skin : 2, hair: Number.isInteger(l.hair) ? l.hair : 0, flag: typeof l.flag === 'string' ? l.flag : '' };
}
function lookPickerHTML() {
  const l = readLook();
  const face = `<svg class="look-face" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 64c0-14 10-20 22-20s22 6 22 20z" fill="#2c3e57"/><rect x="27" y="36" width="10" height="10" rx="3" fill="${SKINS[l.skin]}"/><circle cx="32" cy="26" r="14" fill="${SKINS[l.skin]}"/><path d="M18 25c0-10 6-15 14-15s14 5 14 15c-3-6-8-8-14-8s-11 2-14 8z" fill="${HAIRS[l.hair]}"/></svg>`;
  const row = (kind, list, cur) => list.map((c, i) => `<button type="button" class="look-dot ${i === cur ? 'on' : ''}" data-act="look" data-kind="${kind}" data-i="${i}" style="background:${c}" aria-label="${kind} ${i + 1}"></button>`).join('');
  return `<div class="look-pick" id="look-pick">${face}<div class="look-rows"><div class="look-row"><span>Skin</span>${row('skin', SKINS, l.skin)}</div><div class="look-row"><span>Hair</span>${row('hair', HAIRS, l.hair)}</div><div class="look-row"><span>Flag</span><select id="look-flag" data-act-change="look-flag">${FLAGS.map((f) => `<option value="${f}" ${f === l.flag ? 'selected' : ''}>${f || 'None'}</option>`).join('')}</select></div></div></div>`;
}
function readName() {
  const n = ($('#name')?.value || '').trim();
  if (!n) { toast('Type your name first.'); return null; }
  S.name = n.slice(0, 16);
  safeSet('bj-name', S.name);
  const b = Math.round(Number($('#buyin')?.value));
  if (!(b >= 1)) { toast('Type how many chips you want to buy in for.'); $('#buyin')?.focus(); return null; }
  S.buyIn = b;
  safeSet('bj-buyin', String(b));
  S.look = readLook();
  return S.name;
}

// ---------- Host ----------
// taken: set when this browser takes the table over from a host who left ({ code, table, peer }).
function startHost(resume, taken = null) {
  if (!taken && !readName()) return;
  S.role = 'host';
  S.conns = {}; S.goneTimers = S.goneTimers || {}; S.keyDropped = {}; S.spareKeys = []; S.histSaved = undefined; S.snapSent = '';
  clearInterval(S.pinger);
  S.pinger = setInterval(() => Object.values(S.conns || {}).forEach((c) => {
    try { c?.open && c.send({ t: 'ping' }); } catch {}
    // A guest's browser answers every ping. When the answers stop, the tab is closed or asleep. The
    // link itself can take half a minute to notice, so the host does not wait for it.
    if (c?.answers && Date.now() - c.lastSeen > 9000) { connLost(c); try { c.close(); } catch {} }
  }), 4000);
  if (taken) { S.code = taken.code; S.table = taken.table; }
  else if (resume) {
    try {
      const saved = JSON.parse(safeGet('bj-host'));
      S.code = saved.code;
      S.table = Table.fromJSON(saved.table);
    } catch { S.table = null; }
  }
  if (!S.table) {
    S.code = newCode();
    S.table = new Table();
  }
  resume = resume || !!taken;
  S.table.join(S.myId, S.name, S.buyIn, S.look);
  S.table.hostId = S.myId;
  // The table's secret id for its hand history. It stays in this browser and is never sent to players.
  if (!S.table.created?.id) S.table.created = { id: HX.newTableId(), at: Date.now() };
  HX.openTable({ id: S.table.created.id, code: S.code, created: S.table.created.at, host: S.name });
  // After the host reloads nobody is connected yet. Give everyone the usual time to come back.
  if (resume) Object.values(S.table.players).forEach((p) => { if (!p.connected && !p.kicked && p.id !== S.myId) awayClock(p.id); });
  history.replaceState(null, '', location.pathname + '?' + new URLSearchParams({ ...Object.fromEntries(params), host: S.code }).toString());
  buildLayout();
  stayAwake();
  if (matchMedia('(pointer: coarse)').matches) setTimeout(() => toast('You are the host: keep this tab open and in front. Friends lose the table when you switch apps.'), 1500);
  if (taken) { S.peer = taken.peer; S.online = true; wireHostPeer(taken.peer, 99); } else openHostPeer(0);
  openHostRelay();
  hostChanged();
}

// The host also listens on the second path, so a player whose network blocks the usual link can still come in.
function openHostRelay() {
  try { S.relay?.close(); } catch {}
  S.relay = null;
  if (!relayWorks() || params.get('relay') === '0') return;
  const code = S.code;
  S.relay = hostRelay(code, relayUrl(), {
    onLink: (link) => { if (S.role !== 'host' || S.code !== code) { link.close(); return; } link.on('data', (msg) => onHostMessage(link, msg)); link.on('close', () => connLost(link)); },
    onOpen: () => { if (S.role === 'host' && !S.online) { S.online = true; render(); } },
    onClose: () => { if (S.role === 'host' && (!S.peer || S.peer.disconnected || S.peer.destroyed)) { S.online = false; render(); } },
  });
}
function openHostPeer(attempt) {
  const peer = new Peer(ROOM_PREFIX + S.code, peerOptions());
  S.peer = peer;
  wireHostPeer(peer, attempt);
}
function wireHostPeer(peer, attempt) {
  peer.on('open', () => { S.online = true; render(); });
  peer.on('connection', (conn) => {
    conn.on('data', (msg) => onHostMessage(conn, msg));
    conn.on('close', () => connLost(conn));
  });
  peer.on('disconnected', () => { if (S.role !== 'host' || S.peer !== peer) return; /* an old host link that was closed on purpose */ S.online = !!S.relay?.open; render(); setTimeout(keepAlive, 1500); });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id' && S.role === 'host' && (attempt >= 6 || attempt === 99)) {
      // The table's name is held by someone else for good: while this browser was away, another
      // player's browser took the table over. Join it as a player; chips and seat are still there.
      peer.destroy();
      demoteToPlayer();
      return;
    }
    if (e.type === 'unavailable-id' && attempt < 15) {
      // After a page refresh the old table name can stay reserved for a few seconds.
      peer.destroy();
      setTimeout(() => openHostPeer(attempt + 1), 2000);
      toast('Reopening your table...');
      return;
    }
    if (e.type === 'peer-unavailable') return;
    // The meeting point cannot be reached. With the second path open the table still works, so say that once instead.
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type) && S.relay?.open) { if (!S.saidRelay) { S.saidRelay = true; toast('The usual meeting point is not reachable. Your table stays open on the backup path.'); } return; }
    toast('Connection problem: ' + (e.type || e.message));
  });
}

// The host's own copy of the table, for a page refresh. Writing it is the slowest part of a change,
// so it waits for a quiet half second (and is written at once when the page is hidden or closed).
// It holds the last 40 rounds of history; every round is already in the browser's database.
function saveHostNow() {
  clearTimeout(S.saveT); S.saveT = null;
  if (S.role !== 'host' || !S.table) return;
  const j = S.table.toJSON();
  safeSet('bj-host', JSON.stringify({ code: S.code, table: { ...j, hist: (j.hist || []).slice(-40) } }));
}
function saveHostSoon() { if (!S.saveT) S.saveT = setTimeout(saveHostNow, 500); }
addEventListener('pagehide', saveHostNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveHostNow(); });

// ---------- The table outlives its host ----------
// Between rounds the host's browser sends every player a copy of the table as everyone can already
// see it: seats, chips, buy-ins and settings. The shoe, the shuffle codes and the hand history are
// left out. If the host's browser goes away, the next player's browser opens the table again from
// that copy with a new shuffle, so nobody ever learns the order of the old shoe.
function sendSnap() {
  const t = S.table;
  if (!(t.phase === 'betting' || t.phase === 'settled')) return;
  const { shoe, shoeSize, fair, hist, evts, created, runCount, dealer, turn, pendingSettings, ...lite } = t.toJSON();
  const order = Object.values(t.players).filter((p) => p.id !== S.myId && p.connected && !p.kicked).map((p) => p.id);
  const body = JSON.stringify({ order, table: lite });
  if (body === S.snapSent) return;
  S.snapSent = body;
  const msg = { t: 'snap', snap: body };
  for (const conn of Object.values(S.conns)) if (conn.open) { try { conn.send(msg); } catch {} }
}
// A player's browser found no host at the table's address. After a short wait (longer for players
// further down the list, so only one steps up) it opens the table itself.
function maybeTakeOver() {
  if (S.role !== 'player' || S.kicked || S.taking || S.conn?.open) return;
  S.noHostAt ||= Date.now();
  let snap = null;
  try { snap = S.snap ? JSON.parse(S.snap) : null; } catch {}
  const at = snap ? snap.order.indexOf(S.myId) : -1;
  const rank = snap ? (at < 0 ? snap.order.length + 1 : at) : 2;
  if (Date.now() - S.noHostAt < 6000 + rank * 6000) return;
  S.taking = true;
  const peer = new Peer(ROOM_PREFIX + S.code, peerOptions());
  const fail = () => { try { peer.destroy(); } catch {} S.taking = false; S.noHostAt = Date.now(); };
  const timer = setTimeout(fail, 12000);
  peer.on('error', () => { clearTimeout(timer); fail(); });
  peer.on('open', () => {
    clearTimeout(timer);
    peer.removeAllListeners('error');
    let table = null;
    try { if (snap) table = Table.fromJSON(snap.table); } catch { table = null; }
    const fresh = !table;
    if (!table) table = new Table();
    const oldHost = table.hostId;
    for (const p of Object.values(table.players)) { p.connected = false; p.gone = false; }
    table.join(S.myId, S.name, S.buyIn, S.look);
    // The old host stays the dealer when they were the dealer: the dealer makes no choices, so the others can keep playing.
    table.phase = 'settled'; table.startBetting(); // bets from a round that never finished go back
    table.vote = null; table.hist = []; table.evts = []; table.created = null;
    table.newShoe();
    table.addLog(fresh ? `${S.name} opened the table.` : `The host left. ${S.name} is the host now. The shoe was shuffled again.${table.banker && table.banker === oldHost && table.players[oldHost] ? ` ${table.players[oldHost].name} is still the dealer.` : ''}`);
    table.ev(fresh ? 'table opened with no host present' : 'host handoff: new host, new shuffle', S.myId);
    try { S.conn?.close(); } catch {}
    try { S.peer?.destroy(); } catch {}
    clearInterval(S.watchdog);
    S.conn = null; S.taking = false; S.noHostAt = null; S.why = '';
    sessDel('bj-join-' + S.code);
    startHost(true, { code: S.code, table, peer });
    toast(fresh ? 'Nobody was hosting, so the table opened in your browser. You are the host: keep this tab open.' : 'The host left. You are the host now: keep this tab open.');
  });
}
// This browser was the host, came back, and found the table running in someone else's browser.
function demoteToPlayer() {
  const code = S.code;
  try { S.relay?.close(); } catch {} S.relay = null;
  clearInterval(S.pinger);
  if (S.timer) { clearTimeout(S.timer.handle); S.timer = null; }
  Object.values(S.goneTimers || {}).forEach(clearTimeout);
  S.snap = S.snapSent || null; // if nobody is hosting after all, the table can still be opened again from this copy
  S.goneTimers = {}; S.conns = {}; S.table = null; S.peer = null; S.online = false;
  safeDel('bj-host');
  history.replaceState(null, '', location.pathname + '?' + new URLSearchParams({ ...Object.fromEntries([...params].filter(([k]) => k !== 'host')), room: code }).toString());
  toast('Another player kept the table running while you were away. You are back as a player.');
  startPlayer(code, { name: S.name, buyIn: S.buyIn, look: S.look });
}

// A guest's link is gone. A reload or a short drop is not the end of their hand: they get a little
// time to come back before the dealer stands for them.
function connLost(conn) {
  const id = conn.clientId;
  if (!id || S.conns[id] !== conn) return;
  delete S.conns[id];
  conn.clientId = null;
  if (S.voice?.[id]) { delete S.voice[id]; voiceCast(); }
  S.table.disconnect(id);
  S.table.addLog(`${S.table.players[id]?.name || 'A player'} lost the connection.`);
  awayClock(id, Date.now() - (conn.lastSeen || Date.now()));
  hostChanged();
}

function onHostMessage(conn, msg) {
  // Someone at another table of the office asks who sits here.
  if (msg && msg.t === 'peek') { try { conn.send({ t: 'people', list: (S.presence || []).slice(0, 12) }); } catch {} return; }
  if (!msg || typeof msg !== 'object') return;
  conn.lastSeen = Date.now();
  if (msg.t === 'pong') { conn.answers = true; return; }
  if (msg.t === 'join') {
    const id = String(msg.clientId || '').slice(0, 20);
    if (!id || id === S.myId) { conn.send({ t: 'error', msg: 'Open the link in another browser or device.' }); return; }
    const p = S.table.players[id];
    if (p?.kicked) { conn.send({ t: 'kicked' }); setTimeout(() => conn.close(), 300); return; }
    const old = S.conns[id];
    if (old && old !== old.closed) { old.clientId = null; try { old.close(); } catch {} }
    conn.clientId = id;
    S.conns[id] = conn;
    clearTimeout(S.goneTimers[id]); delete S.goneTimers[id];
    S.table.join(id, msg.name, msg.buyIn, msg.look);
    hostChanged();
    if (S.snapSent) { try { conn.send({ t: 'snap', snap: S.snapSent }); } catch {} }
    if (S.chat?.length) { try { conn.send({ t: 'chat-log', list: S.chat.slice(-40) }); } catch {} }
    try { conn.send({ t: 'voice-list', list: voiceList() }); } catch {}
    return;
  }
  if (!conn.clientId) return;
  if (msg.t === 'throw') { relayThrow(conn.clientId, msg); return; }
  if (msg.t === 'hurry') { relayHurry(conn.clientId, msg.say); return; }
  if (msg.t === 'chat') { relayChat(conn.clientId, msg); return; }
  if (msg.t === 'voice') { voiceSet(conn.clientId, conn.peer, !!msg.on, !!msg.mic); return; }
  if (msg.t === 'keys') { gotNonce(msg, conn.clientId); return; }
  // Any player may read the finished rounds: cards that were dealt, bets and results. The unplayed
  // cards of the shoe and the shuffle secret are not part of a round and are never sent.
  if (msg.t === 'hist-get') {
    const now = Date.now();
    if (now - (conn.histAt || 0) < 800) return;
    conn.histAt = now;
    hostRounds().then((all) => { try { conn.send({ t: 'hist', n: (S.table.hist || []).length, total: all.length, rounds: all.slice(-80).map(({ events, table, backed, ...r }) => r) }); } catch {} });
    return;
  }
  fresh(moveCount(msg), () => runAction(conn.clientId, msg, (err) => conn.open && conn.send({ t: 'error', msg: err, bet: msg.t === 'bet' })));
}

// How long a player who dropped out may stay away before the dealer stands their hand. Their own
// turn clock keeps running as well, so whichever ends first counts.
const AWAY_MS = 20000;
function awayClock(id, already = 0) {
  clearTimeout(S.goneTimers[id]);
  S.goneTimers[id] = setTimeout(() => {
    delete S.goneTimers[id];
    fresh(() => 0, () => hostDo((tb) => tb.markGone(id)));
  }, Math.max(3000, AWAY_MS - already)); // "already" is how long they had been silent when the host noticed
}
// Tell everyone something that happened to one player (shown as a banner to them, a short note to the rest).
function tellAll(note) {
  const msg = { t: 'note', ...note };
  for (const conn of Object.values(S.conns)) if (conn.open) conn.send(msg);
  showNote(msg);
}
function showNote(msg) {
  if (msg.kind === 'timeout') {
    if (msg.id === S.myId) { S.timedOutRound = S.state?.round; banner('Time ran out', 'Your hand was stood.', 'bad', 5000); }
    else toast(`${msg.name || 'A player'} ran out of time. Their hand was stood.`);
  } else if (msg.kind === 'ins-timeout') {
    if (Array.isArray(msg.ids) && msg.ids.includes(S.myId)) banner('Time ran out', 'Insurance was not taken.', 'bad', 4000);
  }
}

// A word for one player only (a short note at the bottom of their screen).
function sayTo(id, text) {
  if (id === S.myId) toast(text);
  else if (S.conns[id]?.open) S.conns[id].send({ t: 'say', msg: text });
}
// Someone who is watching asks a seated player to sit out. One ask a minute per watcher; the seated
// player gets a small note they can ignore.
function askOut(from, to) {
  const t = S.table, a = t.players[from], b = t.players[to];
  if (!a || !b || from === to) return;
  if (a.seat !== null || t.banker === from) throw new Error('Only someone who is watching can ask for a seat.');
  if (b.seat === null) throw new Error(`${b.name} is not seated.`);
  S.askAt ||= {}; S.askFor ||= {};
  const wait = 60000 - (Date.now() - (S.askAt[from] || 0));
  if (wait > 0) throw new Error(`You can ask again in ${Math.ceil(wait / 1000)} seconds.`);
  S.askAt[from] = Date.now();
  S.askFor[to] = from;
  const msg = { t: 'ask-out', name: a.name };
  if (to === S.myId) showAsk(msg); else if (S.conns[to]?.open) S.conns[to].send(msg);
  sayTo(from, `${b.name} was asked to sit out.`);
}
function showAsk(msg) {
  $('#ask-note')?.remove();
  const el = document.createElement('div');
  el.id = 'ask-note'; el.className = 'ask-note';
  el.innerHTML = `<span><b>${esc(String(msg.name || 'Someone').slice(0, 16))}</b> is watching and asks for a seat.</span><button class="btn small" data-ask="yes">Sit out after this hand</button><button class="btn small ghost" data-ask="no" aria-label="Ignore">✕</button>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ask]');
    if (!b) return;
    if (b.dataset.ask === 'yes') send({ t: 'ask-out-yes' });
    el.remove();
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 25000);
}

// Moves any player (including the host as a player) can make.
function runAction(id, msg, onError) {
  const t = S.table;
  try {
    switch (msg.t) {
      case 'sit': t.sit(id, Number(msg.seat), !!msg.add); break;
      case 'sit-out': t.sitOut(id, msg.seat, !!msg.on); break;
      case 'stand-up': t.standUp(id, Number.isInteger(msg.seat) ? msg.seat : undefined); break;
      case 'bet': t.setBet(id, msg); break;
      case 'insurance': t.insurance(id, !!msg.take, Number.isInteger(msg.seat) ? msg.seat : undefined); break;
      case 'action': t.action(id, String(msg.a), !!msg.auto); break;
      case 'ask-out': askOut(id, String(msg.to)); break;
      case 'ask-out-yes': {
        const left = t.leaveAfter(id), me = t.players[id];
        const asker = S.askFor?.[id];
        if (left && asker) { delete S.askFor[id]; sayTo(asker, me.leaving ? `${me.name} will sit out when this hand ends.` : `${me.name} sat out. The seat is free.`); }
        break;
      }
      case 'sit-dealer': {
        const voteId = t.requestDealer(id);
        if (voteId) setTimeout(() => hostDo((tb) => tb.expireVote(voteId)), VOTE_SECONDS * 1000);
        S.voteEnds = Date.now() + VOTE_SECONDS * 1000;
        break;
      }
      case 'vote': t.castVote(id, !!msg.yes); break;
      case 'buyin': {
        const req = t.requestBuyIn(id, msg.amount);
        t.answerBuyIn(req.id, true); // buy-ins go straight through; the ledger shows everyone's total
        // Bought in to pay for a double or a split: that move is played in the same step.
        if (msg.then === 'double' || msg.then === 'split') t.action(id, msg.then);
        break;
      }
      case 'leave-dealer': t.leaveDealer(id); break;
      case 'dealer-max': t.setDealerMax(id, msg.amount, msg.side); break;
      case 'dealer-shuffle': t.dealerShuffle(id); break;
      case 'seed': t.setClientSeed(id, msg.seed); return; // nothing on the table changes, so no update is sent
      default: return;
    }
  } catch (e) {
    onError(e.message);
  }
  hostChanged();
}

// ---------- Keys for the cards ----------
// The shoe order is set at the shuffle by the host's hidden seed together with a secret that never
// leaves one guest's browser. To deal card number k the host's browser asks that guest for key k.
// The host cannot read a card before its key arrives; the guest cannot read it without the seed.
const newNonce = () => { const b = new Uint8Array(8); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); };
const cleanNonce = (n) => String(n).replace(/[^0-9a-zA-Z]/g, '').slice(0, 32);
// Every guest whose code is in this shoe holds a part of each card's key, so opening a card early
// would need all of them to help the host.
function keyHolders() {
  const open = Object.values(S.conns).filter((c) => c?.open && c.clientId);
  const inShoe = S.table.fair?.current?.clientSeeds || {};
  const mixed = open.filter((c) => inShoe[c.clientId] !== undefined && !S.keyDropped?.[c.clientId]);
  return mixed.length ? mixed : open;
}
let freshChain = Promise.resolve();
// countFn says how many cards the step takes. fn runs once the keys are here. Steps run one at a time, in order.
function fresh(countFn, fn) {
  freshChain = freshChain.then(() => new Promise((res) => {
    const t = S.table;
    let count = 0;
    try { count = countFn(t) || 0; } catch { count = 0; }
    S.spareKeys ||= [];
    const run = (keys) => {
      t.keys = S.spareKeys.concat(keys || []);
      try { fn(); } finally { S.spareKeys = t.keys || []; t.keys = null; res(); } // keys a step did not use open the next cards
    };
    const need = count - S.spareKeys.length;
    if (need <= 0) return run([]);
    const local = () => Array.from({ length: need }, newNonce);
    const holders = keyHolders();
    if (!holders.length) return run(local()); // nobody else is at the table
    const rid = newNonce(), parts = {};
    S.nonceWait ||= {};
    const finish = () => {
      clearTimeout(timer); delete S.nonceWait[rid];
      const ids = Object.keys(parts).sort();
      // A guest who did not answer in time is left out for the rest of the table.
      holders.forEach((c) => { if (!parts[c.clientId]) (S.keyDropped ||= {})[c.clientId] = true; });
      if (!ids.length) return run(local());
      run(Array.from({ length: need }, (_, i) => sha256(ids.map((id) => parts[id][i] || '').join('|')).slice(0, 32)));
    };
    const timer = setTimeout(finish, 1500);
    S.nonceWait[rid] = (keys, from) => {
      if (!from || parts[from]) return;
      parts[from] = (Array.isArray(keys) ? keys : []).slice(0, need).map(cleanNonce);
      if (holders.every((c) => parts[c.clientId])) finish();
    };
    const msg = { t: 'key-req', rid, from: (t.fair?.cards || 0) + S.spareKeys.length + 1, count: need };
    holders.forEach((c) => c.send(msg));
  })).catch(() => {});
}
function gotNonce(msg, from) { S.nonceWait?.[msg.rid]?.(msg.keys, from); }
const moveCount = (msg) => (t) => (msg.t === 'action' ? { hit: 1, double: 1, split: 2 }[msg.a] || 0 : msg.t === 'buyin' ? { double: 1, split: 2 }[msg.then] || 0 : msg.t === 'peek' ? 1 : 0);
// The guest's side of the guard. A key is fixed by its card number, so sending one again tells the host
// nothing new, and a jump forward only means this phone missed a few requests while it was asleep or
// reconnecting. What a changed host could gain from is more keys than the step on the table can use:
// a deal needs two cards per seat plus two for the dealer, a move needs one or two. That is refused.
function serveKeys(msg) {
  const from = Number(msg.from), count = Number(msg.count), st = S.state;
  const betting = !st || st.phase === 'betting' || st.phase === 'settled';
  const most = betting ? 2 * (st?.seats?.length || 7) + 2 : 2;
  if (!Number.isInteger(from) || from < 1 || !Number.isInteger(count) || count < 1 || count > most) {
    (S.fair ||= { mine: {}, cur: {}, checks: {} }).alert = true;
    toast('The host asked for too many card keys at once. Tap the badge at the top right.');
    render();
    return [];
  }
  return Array.from({ length: count }, (_, i) => myKey(from + i));
}
// A secret kept in this browser tab, and the key for card number k made from it.
function myKey(k) {
  let sec = null;
  try { sec = sessionStorage.getItem('bj-key-' + S.code); } catch {}
  if (!sec) { sec = newNonce() + newNonce(); try { sessionStorage.setItem('bj-key-' + S.code, sec); } catch {} }
  S.keySecret ||= sec;
  return sha256(S.keySecret + '|' + k).slice(0, 32);
}

// Moves only the host can make. These never come from the network.
function hostDo(fn) {
  try { fn(S.table); } catch (e) { toast(e.message); }
  hostChanged();
}

function hostChanged() {
  const t = S.table;
  // The dealer draws one card at a time so everyone can watch.
  if (t.phase === 'dealer' && !S.dealerTimer) {
    const step = () => fresh((tb) => (tb.dealerNeedsCard() ? 1 : 0), () => {
      t.dealerStep();
      if (t.phase === 'dealer') S.dealerTimer = setTimeout(step, 950);
      else S.dealerTimer = null;
      hostChanged();
    });
    S.dealerTimer = setTimeout(step, 1000);
  }
  // A few seconds after a round ends, the dealer clears the cards and the betting spots.
  if (t.phase === 'settled' && !S.clearTimer) {
    S.clearTimer = setTimeout(() => {
      S.clearTimer = null;
      if (S.table.phase === 'settled') hostDo((tb) => tb.startBetting());
    }, 4500);
  }
  // Auto deal once every seated, connected player has pressed Ready.
  if (t.settings.autoDeal !== false && t.phase === 'betting' && !S.autoDealTimer) {
    const seated = t.seats.filter((s) => s && !s.out && t.players[s.playerId].connected);
    if (seated.length && seated.every((s) => s.ready && s.bet.main > 0)) {
      S.autoDealTimer = setTimeout(() => {
        S.autoDealTimer = null;
        const still = t.seats.filter((s) => s && !s.out && t.players[s.playerId].connected);
        if (t.phase === 'betting' && still.length && still.every((s) => s.ready) && t.canDeal()) fresh((tb) => tb.dealCount(), () => hostDo((tb) => { if (tb.phase === 'betting' && tb.canDeal()) tb.deal(); }));
      }, 900);
    }
  }
  // New cards get their place in the deal animation first, so a turn clock can wait for them to land.
  const mine = t.publicState(S.myId);
  queueCards(mine);
  scheduleTimer();
  const timer = S.timer ? { kind: S.timer.kind, endsIn: S.timer.ends - Date.now() } : null;
  const voteEndsIn = t.vote ? Math.max(0, S.voteEnds - Date.now()) : 0;
  for (const [id, conn] of Object.entries(S.conns)) {
    if (conn.open) conn.send({ t: 'state', state: { ...t.publicState(id), timer, voteEndsIn } });
  }
  setState({ ...mine, timer, voteEndsIn });
  setTimerFromState(S.state);
  saveHostSoon();
  sendSnap();
  // Finished rounds go to this browser's own database (and from there to the online backup).
  const lastRound = t.hist?.length ? t.hist[t.hist.length - 1].round : 0;
  if (t.created?.id && lastRound && lastRound !== S.histSaved) { const from = S.histSaved ?? -1; S.histSaved = lastRound; HX.saveRounds(t.created.id, t.hist.filter((h) => h.round > from)); }
  render();
}

// The automatic dealer: deals when the betting time is up, and stands for a
// player who has not acted in time.
function scheduleTimer() {
  const t = S.table;
  const s = t.settings;
  let want = null;
  // The betting clock only runs when a deal can really happen: a dealer (or the frozen ledger), a bank
  // that covers the bets, and at least one fresh bet of the minimum or more. Bets left on the table
  // from the round that just ended are not bets for the next one, so nothing counts down while the
  // results are showing.
  if (t.phase === 'betting' && s.betTimer > 0 && t.canDeal()) {
    want = { key: `deal-${t.round}`, kind: 'deal', secs: s.betTimer };
  } else if (t.phase === 'insurance' && s.turnTimer > 0) {
    want = { key: `ins-${t.round}`, kind: 'insurance', secs: Math.min(s.turnTimer, 15) };
  } else if (t.phase === 'playing' && t.turn) {
    const h = t.seats[t.turn.seat].hands[t.turn.hand];
    const tp = t.players[t.seats[t.turn.seat].playerId];
    // A player who is away does not get the full clock: the table plays their hand after a moment.
    const away = tp && !tp.connected && (tp.gone || tp.kicked);
    if (away || s.turnTimer > 0) want = { key: `turn-${t.round}-${t.turn.seat}-${t.turn.hand}-${h.cards.length}${away ? '-away' : ''}`, kind: 'turn', secs: away ? 1.2 : s.turnTimer };
  }
  if (S.timer && want && S.timer.key === want.key) return;
  if (S.timer) { clearTimeout(S.timer.handle); S.timer = null; }
  if (!want) return;
  const fire = () => {
    S.timer = null;
    if (want.kind === 'deal') fresh((tb) => tb.dealCount(), () => hostDo((tb) => { if (tb.phase === 'betting' && tb.canDeal()) tb.deal(); }));
    else if (want.kind === 'insurance') fresh(() => 0, () => {
      const t2 = S.table;
      if (t2.phase !== 'insurance') return;
      const ids = t2.seats.filter((x) => x && x.hands.length && !x.insuranceDecided && t2.players[x.playerId].connected).map((x) => x.playerId);
      hostDo((tb) => tb.forceInsurance());
      if (ids.length) tellAll({ kind: 'ins-timeout', ids });
    });
    else fresh(() => 1, () => {
      const t2 = S.table;
      if (t2.phase !== 'playing' || !t2.turn) return;
      const p = t2.players[t2.seats[t2.turn.seat].playerId];
      let did = null;
      hostDo((tb) => { did = tb.awayMove(); tb.addLog(did === 'hit' ? `${p.name} is away or out of time with 11 or less: the dealer hits for them.` : `Time ran out for ${p.name}, dealer stands.`); });
      if (did === 'stand') tellAll({ kind: 'timeout', id: p.id, name: p.name });
    });
  };
  // A turn clock starts when the player can act: after the cards that are still being dealt have landed.
  const lead = want.kind === 'deal' ? 0 : Math.max(0, S.dealEnds - performance.now());
  const ms = lead + want.secs * 1000;
  S.timer = { key: want.key, kind: want.kind, ends: Date.now() + ms, handle: setTimeout(fire, ms) };
}

function setTimerFromState(st) {
  S.timerKind = st.timer?.kind || null;
  S.timerEnds = st.timer ? Date.now() + st.timer.endsIn : 0;
  updateTimer();
}

function updateTimer() {
  const el = $('#timer');
  if (!el) return;
  let left = Math.max(0, Math.ceil((S.timerEnds - Date.now()) / 1000));
  // While the cards are still being dealt the clock has not started yet.
  const cap = S.timerKind === 'turn' ? S.state?.settings?.turnTimer : S.timerKind === 'insurance' ? Math.min(S.state?.settings?.turnTimer || 15, 15) : 0;
  if (cap) left = Math.min(left, cap);
  if (!S.timerKind || !S.timerEnds || (S.timerKind !== 'deal' && dealingNow() && S.dealMany)) { el.hidden = true; return; }
  el.hidden = false;
  el.classList.toggle('urgent', left <= 5);
  // Tick for the last 5 seconds when it is my move.
  const myMove = (S.timerKind === 'turn' && S.state?.actions?.length) ||
    (S.timerKind === 'insurance' && (() => { const { seat } = myInfo(S.state); return seat && seat.hands.length && !seat.insuranceDecided; })());
  if (myMove && left <= 5 && left > 0 && S.lastTick !== left) { S.lastTick = left; tickSound(left === 1); }
  if (left > 5) S.lastTick = null;
  const dn = $('#decide-num');
  if (dn) {
    const total = (S.state?.settings?.turnTimer || 30) * 1000;
    const frac = S.timerKind === 'turn' ? Math.max(0, Math.min(1, (S.timerEnds - Date.now()) / total)) : 1;
    dn.textContent = S.timerKind === 'turn' ? left : '';
    $('#decide-timer').classList.toggle('urgent', S.timerKind === 'turn' && left <= 5);
    $('#decide-bar').style.transform = `scaleX(${frac})`;
    const warn = $('#decide-warn');
    if (warn) { const on = S.timerKind === 'turn' && left <= 5; warn.hidden = !on; if (on) warn.textContent = left > 0 ? `${left} second${left === 1 ? '' : 's'} left. After that your hand is stood.` : 'Time is up.'; }
  }
  el.textContent = S.timerKind === 'deal' ? `Dealing in ${left}s` : S.timerKind === 'insurance' ? `Insurance closes in ${left}s` : `${left}s to act`;
}
setInterval(updateTimer, 250);

// ---------- Staying connected ----------
// The link to the meeting point (where browsers find each other) can drop when a phone changes network,
// a laptop sleeps or a tab comes back from the background. One retry is not enough, so this runs every
// few seconds and again the moment the tab is shown or the network returns.
function keepAlive() {
  const peer = S.peer;
  if (!peer || S.kicked || !S.role) return;
  if (S.role === 'player' && !S.online && (peer.destroyed || peer.disconnected)) { S.downAt ||= Date.now(); if (Date.now() - S.downAt > 2500) tryRelay(); }
  if (peer.destroyed) { if (S.role === 'host') openHostPeer(0); else openGuestPeer(); return; }
  if (peer.disconnected) { try { peer.reconnect(); } catch {} return; }
  if (S.role === 'player') {
    // A link that has gone silent (the phone was asleep) is dropped at once instead of after the usual wait.
    if (S.conn && S.online && Date.now() - S.lastSeen > 12000) { const c = S.conn; S.conn = null; S.online = false; try { c.close(); } catch {} render(); }
    // A link that was started but never opened (the host's browser did not answer) is thrown away and started again.
    if (S.conn && !S.conn.open && !S.online && Date.now() - (S.lastTry || 0) > 12000) { const c = S.conn; S.conn = null; S.linkTries = (S.linkTries || 0) + 1; try { c.close(); } catch {} }
    if (!S.conn && Date.now() - (S.lastTry || 0) > 4000) connectToHost();
    // Still no table after a few seconds: try the second path as well.
    if (S.online) S.downAt = 0; else { S.downAt ||= Date.now(); if (Date.now() - S.downAt > 2500 || params.get('relay') === 'only') tryRelay(); }
  }
}
setInterval(keepAlive, 5000);
addEventListener('online', keepAlive);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { keepAlive(); stayAwake(); } });
// Keep the screen on while you are at a table, so a phone or laptop does not sleep in the middle of a hand.
async function stayAwake() {
  if (!S.role || document.hidden || !navigator.wakeLock) return;
  try { if (!S.wake || S.wake.released) S.wake = await navigator.wakeLock.request('screen'); } catch {}
}

// ---------- Player ----------
function startPlayer(code, saved) {
  code = String(code || '').trim().toLowerCase();
  if (saved) { S.name = saved.name; S.buyIn = saved.buyIn; S.look = saved.look; }
  else if (!readName()) return;
  S.role = 'player';
  S.code = code;
  // Remembered for this tab only, under the table's code: a reload joins the same table again.
  sessSet('bj-join-' + code, JSON.stringify({ name: S.name, buyIn: S.buyIn, look: S.look }));
  buildLayout();
  render();
  stayAwake();
  openGuestPeer();
  // Both paths from the start: if the usual one has no table after 2.5 seconds, the second path is used.
  S.downAt = Date.now(); setTimeout(keepAlive, 2600);
}

function openGuestPeer() {
  const peer = new Peer(peerOptions());
  S.peer = peer;
  peer.on('open', () => { if (!S.conn?.open) connectToHost(); });
  peer.on('disconnected', () => { S.why = 'net'; setTimeout(keepAlive, 1500); });
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      // The meeting point answered: no table with this code is open right now.
      S.online = false; S.why = 'nohost'; S.conn = null;
      render();
      maybeTakeOver();
      return; // keepAlive tries again every few seconds
    }
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { S.why = 'net'; return; }
    toast('Connection problem: ' + (e.type || e.message));
  });
}

// The usual link does not open: come in through the second path (see relay.js). The host listens there all the time.
const relayUrl = () => params.get('relayurl') || '';
async function tryRelay() {
  if (S.relayBusy || S.online || S.role !== 'player' || S.kicked || !relayWorks() || params.get('relay') === '0') return;
  S.relayBusy = true;
  try {
    const link = await guestRelay(S.code, relayUrl(), S.myId, 15000);
    if (!link) return;
    if (S.online || S.role !== 'player') { link.close(); return; }
    const old = S.conn; S.conn = null;
    try { old?.close(); } catch {}
    wireGuestConn(link);
    link.emit('open');
  } finally { S.relayBusy = false; }
}
function connectToHost() {
  if (params.get('relay') === 'only') return; // for testing the second path on its own
  if (!S.peer || S.peer.disconnected || S.peer.destroyed) return;
  S.lastTry = Date.now();
  wireGuestConn(S.peer.connect(ROOM_PREFIX + S.code, { reliable: true }));
}
function wireGuestConn(conn) {
  S.conn = conn;
  // Notes for the "cannot reach the host" box: which kinds of path this browser found, and how far the link got.
  S.link = { kinds: new Set(), state: 'starting' };
  const link = S.link;
  const watch = () => { const pc = conn.peerConnection; if (!pc || pc._bj) return !!pc; pc._bj = true;
    pc.addEventListener('icecandidate', (e) => { const t = e.candidate?.type || (/ typ (\w+)/.exec(e.candidate?.candidate || '') || [])[1]; if (t) link.kinds.add(t); });
    pc.addEventListener('iceconnectionstatechange', () => { link.state = pc.iceConnectionState; });
    return true; };
  if (!watch()) setTimeout(watch, 300);
  conn.on('open', () => {
    S.online = true;
    S.why = '';
    S.retry = 0; S.noHostAt = null; S.linkTries = 0; S.viaRelay = !!conn.relay;
    conn.send({ t: 'join', clientId: S.myId, name: S.name, buyIn: S.buyIn, look: S.look });
  });
  conn.on('data', (msg) => {
    S.lastSeen = Date.now();
    if (msg.t === 'ping') { try { conn.send({ t: 'pong' }); } catch {} return; }
    if (msg.t === 'state') { setState(msg.state); render(); setTimerFromState(msg.state); }
    else if (msg.t === 'error') { toast(msg.msg); if (msg.bet) dropPend(); }
    else if (msg.t === 'hist') { S.guestHist = Array.isArray(msg.rounds) ? msg.rounds : []; S.guestHistTotal = msg.total || S.guestHist.length; drawHistPanel(true); if ($('#modal')?.open && $('#hist-list')) showHistory(); }
    else if (msg.t === 'snap') S.snap = String(msg.snap || '').slice(0, 400000);
    else if (msg.t === 'say') toast(String(msg.msg || '').slice(0, 200));
    else if (msg.t === 'chat') gotChat(msg);
    else if (msg.t === 'voice-list') gotVoiceList(msg.list);
    else if (msg.t === 'chat-log') { if (Array.isArray(msg.list) && !S.chat?.length) { S.chat = []; msg.list.slice(-40).forEach((m) => gotChat(m, true)); } }
    else if (msg.t === 'ask-out') showAsk(msg);
    else if (msg.t === 'note') showNote(msg);
    else if (msg.t === 'fx' && msg.kind === 'hurry') showHurry(msg);
    else if (msg.t === 'fx') showThrow(msg);
    else if (msg.t === 'peek') showPeek(msg.card, msg.by);
    else if (msg.t === 'key-req') conn.send({ t: 'keys', rid: msg.rid, keys: serveKeys(msg) });
    else if (msg.t === 'kicked') { S.kicked = true; sessDel('bj-join-' + S.code); S.peer.destroy(); app.innerHTML = '<div class="center-msg"><h2>You were removed from the table.</h2></div>'; }
  });
  const lost = () => {
    if (S.kicked || S.conn !== conn) return;
    S.conn = null;
    S.online = false;
    render();
    S.retry++;
    S.viaRelay = false;
    setTimeout(() => { if (!S.conn) connectToHost(); }, Math.min(10000, 1500 * S.retry));
    S.downAt = Date.now(); setTimeout(keepAlive, 2600);
  };
  conn.on('close', lost);
  conn.on('error', lost);
  // The host sends a short "still here" message every few seconds. If none arrives, the host's tab
  // is closed or asleep, so drop this link and keep trying to reach the table again.
  clearInterval(S.watchdog);
  S.lastSeen = Date.now();
  S.watchdog = setInterval(() => {
    if (S.conn === conn && Date.now() - S.lastSeen > 12000) { try { conn.close(); } catch {} lost(); }
  }, 3000);
}

// Send a move: players send it to the host, the host runs it directly.
function send(msg) {
  if (S.role === 'host' && msg.t === 'chat') { relayChat(S.myId, msg); return; }
  if (S.role === 'host' && msg.t === 'voice') { voiceSet(S.myId, S.peer?.id, !!msg.on, !!msg.mic); return; }
  if (S.role === 'host' && msg.t === 'hurry') { relayHurry(S.myId, msg.say); return; }
  if (S.role === 'host' && msg.t === 'throw') relayThrow(S.myId, msg);
  else if (S.role === 'host') fresh(moveCount(msg), () => runAction(S.myId, msg, (err) => { toast(err); if (msg.t === 'bet') dropPend(); }));
  else if (S.conn?.open) S.conn.send(msg);
  else toast('Not connected to the table.');
}

// ---------- My own bet, one step ahead of the table ----------
// A tap changes my bet here at once and that is what is sent. The table's copy of my bet replaces
// it only when it is the answer to the last bet I sent (the table sends my bet's number back),
// when the round moves on, or when the table said no. So quick taps add up, and a state that
// was already on its way cannot put my bet back to an older amount.
// A person can hold two or more seats. One of them is the seat in hand: the one the tray, the chips
// and the move buttons work on. It follows the turn while cards are played, and the player's own
// choice (S.seatAim) while betting. The rest of the page reads it as me.seat.
function aimSeat(st) {
  const me = st.players.find((p) => p.id === S.myId);
  if (!me) return;
  const mine = me.seats || (me.seat !== null && me.seat !== undefined ? [me.seat] : []);
  me.seats = mine;
  const firstIn = mine.find((i) => !st.seats[i]?.out);
  let a = mine.includes(S.seatAim) && (!st.seats[S.seatAim]?.out || firstIn === undefined) ? S.seatAim : mine.length ? firstIn ?? mine[0] : null;
  if (st.phase === 'playing' && st.turn && mine.includes(st.turn.seat)) a = st.turn.seat;
  else if (st.phase === 'insurance') { const w = mine.find((i) => st.seats[i]?.hands.length && !st.seats[i].insuranceDecided); if (w !== undefined) a = w; }
  S.seatAim = a;
  me.seat = a;
  // The seat the table is drawn around. It stays put while the turn moves between my seats, so nothing on the table jumps.
  // It never changes while I hold that seat, in any phase: picking a chip, betting on another of my
  // seats or a new round must not move or resize a single seat.
  // A phone draws only one seat large enough to bet on, so there the large seat is the seat in hand while bets go down.
  const phoneBetting = innerWidth < 700 && (st.phase === 'betting' || st.phase === 'settled') && a !== null;
  S.home = phoneBetting ? a : mine.includes(S.home) ? S.home : mine.length ? mine[0] : null;
  me.home = S.home;
  // Rebet covers every seat I played last round, so it is offered even when the seat in hand was not one of them.
  if (st.rebets) st.rebet = a !== null ? st.rebets[a] || Object.values(st.rebets).find(Boolean) || null : null;
}
function pickSeat(i) {
  const st = S.state;
  if (!st) return;
  S.seatAim = i; S.undo = [];
  aimSeat(st);
  render();
}
function setState(state) {
  S.state = state;
  aimSeat(state);
  const me = state.players.find((p) => p.id === S.myId);
  const between = state.phase === 'betting' || state.phase === 'settled';
  // The table's own copy of each of my bets, kept so a bet of mine that is still on its way can be laid over it.
  S.serverBet = {};
  for (const i of me?.seats || []) if (state.seats[i]) S.serverBet[i] = { bet: state.seats[i].bet, ready: state.seats[i].ready };
  const seat = S.pend ? state.seats[S.pend.seat] : null;
  if (S.pend && (!seat || seat.playerId !== S.myId || !between || state.round !== S.pend.round || seat.betSeq === S.pend.seq || Date.now() - S.pend.at > 4000)) S.pend = null;
  overlayBet();
  // A rebet asked for while the results were showing goes down as soon as the cards are cleared.
  if (S.rebetWhenOpen != null && (S.rebetWhenOpen !== state.round || !myInfo(state).seat || !between)) S.rebetWhenOpen = null;
  if (S.rebetWhenOpen != null && state.phase === 'betting') { S.rebetWhenOpen = null; setTimeout(doRebet, 0); }
  autoStep();
}
function overlayBet() {
  const st = S.state;
  if (!st || !S.serverBet) return;
  for (const [k, srv] of Object.entries(S.serverBet)) {
    const seat = st.seats[k];
    if (!seat) continue;
    const src = S.pend && S.pend.seat === Number(k) ? S.pend : srv;
    seat.bet = structuredClone(src.bet);
    seat.ready = src.ready;
  }
}
function dropPend() {
  if (!S.pend) return;
  S.pend = null;
  overlayBet();
  render();
}
function placeBet(bet, ready = false) {
  const st = S.state;
  const b = { main: bet.main, sides: { ...bet.sides } };
  if (!b.main) b.sides = {};
  if (b.sides.friendBust && bet.target != null) b.target = bet.target;
  const { me } = myInfo(st);
  const at = me.seat;
  const prev = st.seats[at]?.bet.main || 0; // what this seat held before this tap
  S.pend = { bet: b, ready: b.main > 0 && !!ready, seq: ++S.betSeq, round: st.round, at: Date.now(), seat: at };
  overlayBet();
  // Several seats: chips added to one seat go on my other seats too, so all my hands carry the same
  // main bet. It only copies to seats that held the same main bet before (or nothing), and only when
  // chips are added. Taking chips off one seat changes that seat alone, so the bets can still differ.
  const copy = [];
  if (b.main > prev && !ready && (me.seats || []).length > 1) {
    let left = me.chips - (me.seats || []).reduce((a, i) => a + (i === at ? b.main + Object.values(b.sides).reduce((x, y) => x + y, 0) : betTotal(st.seats[i].bet)), 0);
    for (const i of me.seats) {
      const o = st.seats[i];
      if (i === at || !o || o.out || o.ready || o.hands?.length || (o.bet.main || 0) !== prev) continue;
      const add = b.main - prev;
      if (add > left) continue;
      left -= add;
      copy.push({ t: 'bet', main: b.main, sides: { ...o.bet.sides }, target: o.bet.target, ready: false, seq: ++S.betSeq, seat: i, auto: !!S.auto?.on });
      if (S.role !== 'host') o.bet = { ...o.bet, main: b.main }; // shown at once; the table's answer follows
    }
  }
  send({ t: 'bet', main: b.main, sides: b.sides, target: b.target, ready, seq: S.pend.seq, seat: at, auto: !!S.auto?.on });
  for (const m of copy) send(m);
  // Ready on one seat: the next of my seats that still needs a bet comes into hand.
  if (S.pend.ready) { const nx = (me.seats || []).find((i) => i !== at && st.seats[i] && !st.seats[i].ready && !st.seats[i].out); if (nx !== undefined) { S.seatAim = nx; S.undo = []; aimSeat(st); } }
  render();
}
// Put last round's bet down again. Only ever called from the Rebet button or the B key.
// What Rebet will put down: the sum over all my seats that played last round.
function rebetSum(st) {
  const rs = Object.values(st.rebets || {}).filter(Boolean);
  return rs.length > 1 ? rs.reduce((a, r) => a + betTotal(r), 0) : betTotal(st.rebet);
}
function rebetHands(st) { const n = Object.values(st.rebets || {}).filter(Boolean).length; return n > 1 ? ` on ${n} hands` : ''; }
function doRebet() {
  const st = S.state;
  if (!st) return;
  const { me, seat } = myInfo(st);
  if (!seat || !st.rebet) return;
  if (st.phase === 'settled') { S.rebetWhenOpen = S.rebetWhenOpen === st.round ? null : st.round; render(); return; }
  if (st.phase !== 'betting') return;
  // Several seats: every seat I played last round gets its own bet of last round back, side bets included.
  const own = (me.seats || []).filter((i) => st.seats[i] && st.rebets?.[i]);
  if (own.length > 1 || (own.length === 1 && own[0] !== me.seat)) {
    let n = 0;
    for (const i of own) {
      const o = st.seats[i];
      if (o.out || o.ready || betTotal(o.bet)) continue;
      const r = st.rebets[i];
      send({ t: 'bet', main: r.main, sides: { ...r.sides }, target: r.target, ready: false, seq: ++S.betSeq, seat: i, auto: !!S.auto?.on });
      if (S.role !== 'host') o.bet = { ...o.bet, main: r.main, sides: { ...r.sides } };
      flyChip($('.rebet-btn') || $('#float-balance'), $(`#spot-${i}`), r.main);
      n++;
    }
    if (!n) toast('Your seats already have bets down. Clear them first to rebet.');
    S.undo = []; S.mainChips = []; S.sideChips = {};
    render();
    return;
  }
  if (betTotal(seat.bet)) { toast('You already have a bet down. Clear it first to rebet.'); return; }
  S.undo.push(structuredClone(seat.bet));
  S.mainChips = [];
  S.sideChips = {};
  flyChip($('.rebet-btn') || $('#float-balance'), $(`#spot-${me.seat}`), st.rebet.main);
  placeBet(st.rebet);
}

// ---------- Layout and rendering ----------
function buildLayout() {
  const host = S.role === 'host';
  try { S.room?.stop(); } catch {}
  S.room = null;
  document.body.classList.add('in-room');
  app.innerHTML = `
    <div class="topbar">
      <select class="game-switch" id="game-switch" title="Switch game" aria-label="Game"><option value="blackjack" selected>🃏 Blackjack</option><option value="poker">♠️ Poker</option><option value="baccarat">🎴 Baccarat</option><option value="roulette">🎡 Roulette</option></select>
      <span id="conn-pill" class="pill">Connecting</span>
      <span class="spacer"></span>
      <button id="fair-pill" class="pill fair-pill" data-act="fair" title="How the shuffle is kept fair">🔐<span class="fp-t"> Provably fair</span></button>
      <button class="btn small gold" data-act="copy">🔗 Invite</button>
      <div class="menu-wrap" id="menu-wrap">
        <button class="hamburger" data-act="menu" aria-label="Menu" aria-haspopup="true"><span></span><span></span><span></span></button>
        <div class="menu" id="menu">
          <div class="menu-invite">
            <div class="menu-title">🔗 Invite link</div>
            <div class="share"><input id="share" readonly /><button class="btn small" data-act="copy">Copy</button></div>
          </div>
          <button class="menu-item" data-act="view-pad" title="Look left, Look right, Reset view, Walk around and zoom buttons">🎥 View buttons: ${viewPadOn() ? 'on' : 'off'}</button>
          ${fold('m-table', '📜 Table rules and payouts', `
            <button class="menu-item" data-act="rules">💰 Side bet payouts</button>`)}
          ${fold('m-view', '🎛️ My view and sound', `
            <button class="menu-item" data-act="four">🎨 Four colour cards</button>
            <button class="menu-item" data-act="hints" id="hints-btn">${hintsOn() ? '💡 Strategy hints: on' : '💡 Strategy hints: off'}</button>
            <button class="menu-item" data-act="room3d">${use3D() ? '🧊 3D room: on' : '🧊 3D room: off'}</button>
            ${use3D() ? `<button class="menu-item" data-act="pixel">${pixelOn() ? '👾 Pixel look: on' : '👾 Pixel look: off'}</button>` : ''}
            <button class="menu-item" data-act="mute" id="mute-btn">${isMuted() ? '🔇 Sound: off' : '🔊 Sound: on'}</button>
            <button class="menu-item" data-act="keys">⌨️ Keyboard keys</button>`)}
          ${host ? `
          ${fold('m-round', '🃏 Round', '<div id="host-round"></div>')}
          ${fold('m-players', '👥 Players', `
            <div class="hint" style="margin-bottom:8px">Chips for Give / Take: <input id="give-amt" type="number" value="500" min="1" style="width:90px" /></div>
            <div id="host-players" class="player-list"></div>`)}
          ${fold('m-settings', '⚙️ Game settings', '<div id="host-settings"></div>')}
          ${fold('m-log', '📝 Table log', `<div id="host-log" class="log"></div>
            ${fold('m-logs', 'Logs', `<button class="menu-item" data-act="hist-panel" title="A small list of the hands at the left of the screen.">🕘 Hand history: ${histOn() ? 'on' : 'off'}</button>`, true)}`)}` : `
          ${fold('m-players', '👥 Players', '<div id="guest-players" class="player-list"></div>')}
          <div class="menu-note hint">Only the host can propose new settings, and everyone votes on them.</div>
          ${fold('m-log', '📝 Table log', `<div id="host-log" class="log"></div>
            ${fold('m-logs', 'Logs', `<button class="menu-item" data-act="hist-panel" title="A small list of the hands at the left of the screen.">🕘 Hand history: ${histOn() ? 'on' : 'off'}</button>`, true)}`)}`}
          ${fold('m-cheat', '✅ Game Cheating Detection', `
            <button class="menu-item" data-act="fair">🔐 Provably fair</button>`)}
        </div>
      </div>
    </div>
    <div class="main player">
      <div>
        ${use3D() ? '<div class="room" id="room"><div class="felt" id="felt"></div></div><div class="hud3d" id="hud3d"><div class="hud-top" id="hud-top"></div><div class="felt-actions hud" id="felt-actions"></div><div class="tray" id="tray"></div></div>'
          : '<div class="table-stage" id="stage"><div class="felt" id="felt"></div><div class="felt-actions" id="felt-actions"></div></div>'}
        ${use3D() ? '<button class="float-balance" id="float-balance" data-act="buyin-open" title="Tap to buy in more chips" hidden></button>' : '<div class="tray-wrap"><div class="tray" id="tray"></div><button class="float-balance" id="float-balance" data-act="buyin-open" title="Tap to buy in more chips" hidden></button></div>'}
        <div class="panel controls" id="controls"></div>
      </div>
    </div>
    <div class="hud-bar" id="hud-bar">
    <details class="sb-guide" id="sb-guide"><summary>🎲 Side bets <span>▾</span></summary><div id="sb-guide-body"></div></details>
    <button class="float-throw" data-act="throw-open" title="Pick a reaction, then tap a player or the dealer">😀 Reactions</button>
    <button class="float-hurry" data-act="hurry" title="Tell the others to hurry up. Press as often as you like.">⏰<span> Hurry up</span></button>
    <button class="float-hurry float-bus" data-act="hurry" data-say="bus" title="Shout BUSSSS!!! at the table. Press as often as you like.">💥<span> Bussss</span></button>
    <button class="float-hurry float-split" data-act="hurry" data-say="split" title="Shout SPLIT THAT SHIT!!! at the table. Press as often as you like.">✂️<span> Split it</span></button>
    <button class="float-hurry float-insure" data-act="hurry" data-say="insure" title="Shout INSURE THAT SHIT!! at the table. Press as often as you like.">🛡️<span> Insure it</span></button>
    <div class="ledger ${safeGet('bj-ledger') !== '1' ? 'closed' : ''}" id="ledger"></div>
    <div class="zoom-ctl">${use3D() ? '<button class="view-btn" data-act="turn" data-d="1" title="Turn to the players on your left" aria-label="Look left">◀ Look left</button><button class="view-btn" data-act="turn" data-d="-1" title="Turn to the players on your right" aria-label="Look right">Look right ▶</button><button class="view-btn view-reset" data-act="view-reset" title="Back to your own seat">Reset view</button><button class="view-btn view-walk" data-act="walk" title="Leave your chair and move through the whole office" aria-label="Walk around">🚶 Walk around</button>' : ''}<label class="tilt-ctl" title="Camera angle: drag to tilt the table"><span>Angle</span><input type="range" id="tilt" min="0" max="50" step="1" /></label><button data-act="zoom" data-d="-1" aria-label="Zoom out">−</button><span id="zoom-val"></span><button data-act="zoom" data-d="1" aria-label="Zoom in">+</button></div>
    </div>
    <div class="buyin-pop" id="buyin-pop" hidden></div>
    <div class="host-pops" id="host-pops"></div>`;
  applyZoom();
  if (use3D()) {
    document.body.classList.add('room3d');
    try { S.room = initRoom($('#room'), $('#felt'), { phone: innerWidth < 700, pixel: pixelOn(), hud: $('#hud3d'), size: innerWidth < 700 ? { W: Math.max(320, Math.min(460, innerWidth - 16)), H: 600 } : FELT, onGo: (g) => { if (!['poker', 'baccarat', 'roulette'].includes(g)) return; if (S.goAsk?.g !== g || Date.now() - S.goAsk.t > 4000) { S.goAsk = { g, t: Date.now() }; toast(`Tap again to walk over to ${g[0].toUpperCase() + g.slice(1)}.`); return; } goGame(g); } }); }
    catch (e) { console.error(e); safeSet('bj-3d', '0'); toast('The 3D room could not start on this device.'); }
    // The first time you get to a table: a short walk round the office before your chair.
    if (S.room && S.code && S.tourFor !== S.code) { S.tourFor = S.code; S.room.tour(params.get('from') ? 1500 : 2000, params.get('from')); }
    if (params.has('roomdebug')) window.__room = S.room; // lets a test read the camera and the frame rate
    if (S.room && !S.roomHint) { S.roomHint = true; setTimeout(() => toast(matchMedia('(pointer: coarse)').matches ? 'One finger turns the view. Two fingers slide it, and a pinch moves you in or out.' : 'Drag to look around. Scroll or pinch out to walk around the table.'), 1200); }
  }
}

// The 3D room is on unless the browser cannot draw it or the person turned it off.
// The 3D room is the usual view on every device that can draw it. The menu switch turns it off and is remembered.
const PHONE_FLAT = true;
function use3D() {
  if (params.get('flat') === '1' || !webglOK()) return false;
  if (params.get('room') === '3d' || params.get('3d') === '1') return true;
  // A phone opens the flat table unless the 3D room was switched on in the menu (the person asked for 2D on phones).
  const v = safeGet('bj-3d');
  return PHONE_FLAT && innerWidth < 700 ? v === '1' : v !== '0';
}

// Zoom the table a little in or out. Saved for next time on this device.
function pixelOn() { return safeGet('bj-pixel') === '1'; }
// Who is sitting where, for the figures in the 3D room.
function roomPeople(st) {
  const { order, spots } = seatSpots(st);
  const at = {};
  order.forEach((i, pos) => { at[i] = spots[pos]; });
  const list = st.players.filter((p) => (p.seat !== null && p.seat !== undefined) || st.banker?.id === p.id).map((p) => {
    const isDealer = st.banker?.id === p.id, seat = isDealer ? null : p.seat;
    return { id: p.id, name: p.name, look: p.look || { skin: 2, hair: 0 }, seat, seats: st.seats.length, isMe: p.id === S.myId, isDealer,
      x: at[seat]?.x, y: at[seat]?.y, bet: seat !== null && st.seats[seat] ? betTotal(st.seats[seat].bet) : 0 };
  });
  // A player who holds more seats has the same character on each of them.
  st.seats.forEach((seat, i) => {
    const p = seat && st.players.find((x) => x.id === seat.playerId);
    if (!p || p.seat === i || st.banker?.id === p.id || at[i] === undefined) return;
    list.push({ id: p.id + '#' + i, name: p.name, look: p.look || { skin: 2, hair: 0 }, seat: i, seats: st.seats.length, isMe: false, isDealer: false, x: at[i].x, y: at[i].y, bet: betTotal(seat.bet) });
  });
  // The house dealer stands behind the table too, so someone is seen dealing the cards.
  if (!st.banker && st.frozen) list.push({ id: 'house-dealer', name: 'Dealer', look: { skin: 2, hair: 0 }, seat: null, seats: st.seats.length, isMe: false, isDealer: true, bet: 0 });
  return [list, order.map((i, pos) => ({ seat: i, x: spots[pos].x, y: spots[pos].y }))];
}
function getZoom() { const z = Number(safeGet('bj-zoom')); return z >= 0.6 && z <= 1.6 ? z : 1; }
function getTilt() { const v = safeGet('bj-tilt'); const n = Number(v); return v !== null && n >= 0 && n <= 50 ? n : 30; }
// How far above and below its turning line (70% of the way down) the tilted felt reaches on the screen, in felt pixels.
const VIEW_DIST = 1400;
function tiltView(fh, deg) {
  const a = (deg * Math.PI) / 180, sin = Math.sin(a), cos = Math.cos(a);
  const at = (v) => (v * cos * VIEW_DIST) / (VIEW_DIST - v * sin);
  return { top: at(-0.7 * fh), bottom: at(0.3 * fh) };
}
// The table is drawn at one fixed size and scaled to fit the window, so the page never scrolls.
// On a desktop the felt has the shape of a real seven seat blackjack table, a D about 1.7 times as
// wide as it is deep (1240 by 730), with a padded rail around it. On a phone it is as wide as the
// screen and as tall as the room between the top buttons and the chip tray.
const FELT = { W: 1240, H: 730 };
function applyZoom() {
  const z = getZoom();
  const stage = $('#stage');
  const top = $('.topbar')?.offsetHeight || 56;
  document.documentElement.style.setProperty('--topbar-h', top + 'px');
  if (stage) {
    const phone = innerWidth < 700;
    const tilt = getTilt() * (phone ? 0.7 : 1);
    // Room around the felt for the rail: top, sides, bottom.
    const rimT = phone ? 8 : 14, RIM = phone ? 8 : 30, rimB = phone ? 10 : 38;
    const availH = innerHeight - top - (phone ? 42 : 0) - (phone ? 190 : 150) - (phone ? 12 : 14);
    const availW = innerWidth - (phone ? 0 : 16);
    const seen = (h) => { const v = tiltView(h, tilt); return v.bottom - v.top + rimT + rimB; };
    let fw = FELT.W, fh = FELT.H, fit;
    if (phone) {
      fw = innerWidth - 2 * RIM;
      fh = 560;
      for (let i = 0; i < 8; i++) fh *= availH / seen(fh);
      fh = Math.round(Math.max(430, Math.min(760, fh)));
      fit = Math.min(1, availH / seen(fh));
    } else {
      fit = Math.max(0.35, Math.min(availW / (fw + 2 * RIM), availH / seen(fh), 1.3));
    }
    const v = tiltView(fh, tilt);
    const turnY = rimT - v.top; // where the felt's turning line sits inside the stage
    stage.style.width = fw + 2 * RIM + 'px';
    stage.style.height = Math.round(v.bottom - v.top + rimT + rimB) + 'px';
    stage.style.perspectiveOrigin = `50% ${turnY}px`;
    stage.style.setProperty('--fw', fw + 'px');
    stage.style.setProperty('--fh', fh + 'px');
    stage.style.setProperty('--ft', Math.round(turnY - 0.7 * fh) + 'px');
    stage.style.setProperty('--rim', RIM + 'px');
    // Zooming scales the table inside its box, so the chip tray below never moves.
    stage.style.zoom = fit;
    stage.style.setProperty('--uz', z);
    // On a small window the table is drawn smaller. Names, chips and totals are drawn a little larger then, so they stay readable.
    stage.style.setProperty('--up', phone ? 1 : Math.min(1.25, Math.max(1, 0.8 / fit)).toFixed(3));
    stage.style.setProperty('--tilt', tilt + 'deg');
    stage.style.setProperty('--spin', (Number(safeGet('bj-spin')) || 0) + 'deg');
    const changed = !S.felt || S.felt.W !== fw || S.felt.H !== fh;
    S.felt = { W: fw, H: fh, phone };
    if (changed && S.state && $('#felt .seats')) setTimeout(render, 0);
  }
  const tl = $('#tilt');
  if (tl && document.activeElement !== tl) tl.value = getTilt();
  const zv = $('#zoom-val');
  if (zv) zv.textContent = Math.round(z * 100) + '%';
  placePanels();
}
// Pop-ups that must not cover cards (the result of the round, table messages) sit on the status line
// between the dealer and your seat. This tells the styles where that line is on the screen.
function placePanels() {
  const r = $('#felt .mid-band .status')?.getBoundingClientRect();
  if (!r || !r.width) return;
  const f = $('#felt').getBoundingClientRect(); // the middle of the table, not of the status text: a button may sit beside it
  const root = document.documentElement.style;
  root.setProperty('--pop-x', Math.round(f.left + f.width / 2) + 'px');
  root.setProperty('--pop-y', Math.round(r.top + r.height / 2) + 'px');
}

function renderBalance(st) {
  const el = $('#float-balance');
  if (!el) return;
  const { me, seat } = myInfo(st);
  if (!me) { el.hidden = true; return; }
  // Only a bet for the coming round is still to be taken from the balance. After a round the old bet is already paid out.
  const onTable = seat && st.phase === 'betting' ? betTotal(seat.bet) : 0;
  const waiting = st.buyIns?.length ? `<small class="pending">Buy-in of ${money(st.buyIns[0].amount)} waiting for the host</small>` : '<small>Tap to buy in more</small>';
  el.hidden = false;
  el.innerHTML = `<span class="lbl">Balance</span><b>${money(me.chips - onTable)}</b>${waiting}`;
}

// `then` is the move ('double' or 'split') the buy-in is for, and `need` the chips missing for it.
function openBuyIn(broke = false, then = null, need = 0) {
  const pop = $('#buyin-pop');
  const me = S.state?.players.find((p) => p.id === S.myId);
  const word = then === 'split' ? 'split' : 'double';
  const amounts = then ? [need, ...[500, 1000, 2500, 5000].filter((v) => v > need)].slice(0, 4) : [500, 1000, 2500, 5000];
  pop.innerHTML = `<div class="vote-card">
    <div class="vote-title">${then ? `Buy in to ${word}` : broke ? 'You are out of chips' : 'Buy in more chips'}</div>
    <p>${then ? `You are ${money(need)} short for this ${word}. Pick an amount and the ${word} is played right away. ` : ''}Chips are added right away and everyone sees it in the ledger. Play money only.${me?.boughtIn ? ` You have bought in ${money(me.boughtIn)} extra so far.` : ''}</p>
    <div class="actions">${amounts.map((v, i) => `<button class="btn ${then && !i ? 'primary' : ''}" data-buy="${v}">${money(v)}${then && !i ? ' (just enough)' : ''}</button>`).join('')}</div>
    <div class="share" style="margin-top:10px;justify-content:center"><input id="buy-amt" type="number" min="${then ? need : 1}" placeholder="Other amount" style="width:150px" /><button class="btn primary" data-buy="custom">${then ? `Buy in and ${word}` : 'Buy in'}</button></div>
    <div class="actions" style="margin-top:10px">${broke ? '<button class="btn small" data-buy="spectate">Leave seat and watch</button>' : ''}<button class="btn small" data-buy="close">${broke ? 'Not now' : 'Cancel'}</button></div>
  </div>`;
  pop.hidden = false;
  const opened = Date.now();
  pop.onclick = (e) => {
    // A move button acts on the press, so the click that ends the same tap arrives here: it must not close the box or pick an amount.
    if (Date.now() - opened < 450) return;
    const b = e.target.closest('[data-buy]');
    if (e.target === pop || b?.dataset.buy === 'close') { pop.hidden = true; return; }
    if (b?.dataset.buy === 'spectate') { pop.hidden = true; send({ t: 'stand-up' }); return; }
    if (!b) return;
    const amount = b.dataset.buy === 'custom' ? Math.round(Number($('#buy-amt').value)) : Number(b.dataset.buy);
    if (!amount) { toast('Type an amount.'); return; }
    if (then && amount < need) { toast(`You need at least ${money(need)} more to ${word}.`); return; }
    send(then ? { t: 'buyin', amount, then } : { t: 'buyin', amount });
    pop.hidden = true;
    toast(then ? `Added ${money(amount)} chips and ${then === 'split' ? 'split' : 'doubled'}.` : `Added ${money(amount)} chips.`);
  };
}
// The move a buy-in would pay for: a double or a split that only the balance is in the way of.
function shortFor(a) {
  const st = S.state;
  if (!st?.turn || st.phase !== 'playing' || st.actions?.includes(a) || !st.actions?.length) return 0;
  const seat = st.seats[st.turn.seat], hand = seat?.hands[st.turn.hand];
  const me = st.players.find((p) => p.id === S.myId);
  if (!hand || !me || seat.playerId !== S.myId || hand.cards.length !== 2 || hand.splitAces || me.chips >= hand.bet) return 0;
  const ten = (c) => ['10', 'J', 'Q', 'K'].includes(c.r);
  const pair = hand.cards[0].r === hand.cards[1].r || (ten(hand.cards[0]) && ten(hand.cards[1]));
  if (a === 'double' || (a === 'split' && pair)) return hand.bet - me.chips;
  return 0;
}

// Hand history: every round since the table opened, newest first, with a line where each shuffle starts.
function histHTML(list) {
  if (!list.length) return '<h2 style="margin-top:0">Hand history</h2><p class="hint">No round has been played yet.</p>';
  const pl = (n) => `<span class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : n < 0 ? '-' : ''}${money(Math.abs(n))}</span>`;
  const cards = (str) => str.split(' ').filter(Boolean).map((c) => `<span class="hc ${/[♥♦]/.test(c) ? 'red' : ''}">${esc(c)}</span>`).join('');
  const rows = [];
  const shoes = [...new Set(list.map((h) => h.shoe))];
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i], next = list[i + 1];
    if (!next || next.shoe !== h.shoe) {
      const inShoe = list.filter((x) => x.shoe === h.shoe);
      rows.push(`<div class="hist-shoe"><span>Shuffle ${shoes.indexOf(h.shoe) + 1}</span><small>${inShoe.length} ${inShoe.length === 1 ? 'round' : 'rounds'}, round ${inShoe[0].round}${inShoe.length > 1 ? ' to ' + inShoe[inShoe.length - 1].round : ''}</small></div>`);
    }
    rows.push(`<div class="hist-round">
      <div class="hist-head"><b>Round ${h.round}</b><span>Dealer (${esc(h.dealerName)}): ${cards(h.dealer)} <em>${h.dealerTotal > 21 ? 'bust ' + h.dealerTotal : h.dealerTotal}</em></span>${h.counted ? '' : '<small>practice, not in the ledger</small>'}${h.midShuffle ? '<small>the shoe ran out and was shuffled during this round</small>' : ''}</div>
      ${h.seats.map((s) => `<div class="hist-seat"><span class="hs-name">${esc(s.name)}</span><span class="hs-hands">${s.hands.map((x) => `<span class="hs-hand">${cards(x.cards)} <em>${x.total}</em> ${esc(x.result || '')}${x.doubled ? ', doubled' : ''} ${pl(x.net)}</span>`).join('')}${s.sides.map((x) => `<span class="hs-side">${esc(x.name)} ${x.net ? pl(x.net) : 'back'}</span>`).join('')}</span><span class="hs-net">${pl(s.net)}</span></div>`).join('')}
    </div>`);
  }
  return `<h2 style="margin-top:0">Hand history</h2><p class="hint">Newest round first. A gold line marks where each new shuffle starts.</p><div id="hist-list" class="hist-list">${rows.join('')}</div>`;
}
// Hand history is for the host only. It is read from this browser's database, so it holds every round
// of the table, also from before a refresh. S.histScope: 'all' or 'shoe' (since the last shuffle).
// Finished rounds for the hand history. The host reads its own store; a player asks the host once per new round.
async function allRounds() {
  if (S.role === 'host') return hostRounds();
  const n = S.state?.histN;
  if (S.guestHistN !== n) { S.guestHistN = n; send({ t: 'hist-get' }); }
  return S.guestHist || [];
}
async function hostRounds(id = S.table.created?.id) {
  let list = id ? await HX.getRounds(id) : [];
  if (id === S.table.created?.id) { const have = new Set(list.map((r) => r.round)); list = list.concat((S.table.hist || []).filter((r) => !have.has(r.round))).sort((a, b) => a.round - b.round); }
  return list;
}
const scopeHTML = () => `<div class="hx-scope"><button class="seat-tab ${S.histScope !== 'shoe' ? 'on' : ''}" data-hx="scope" data-v="all">All hands</button><button class="seat-tab ${S.histScope === 'shoe' ? 'on' : ''}" data-hx="scope" data-v="shoe">Since last shuffle</button></div>`;
// The small hand history panel at the left of the screen. Off until the host turns it on in the menu.
// It only shows; rounds are saved and backed up whether it is on or off.
const histOn = () => safeGet('bj-hist-panel') === '1';
async function drawHistPanel(force) {
  let el = $('#hist-panel');
  if (!S.role || !histOn() || !S.state) { el?.remove(); S.histPanelN = null; return; }
  // The round in play is the top entry and grows with every card. The dealer's face down card stays hidden.
  const st0 = S.state;
  const cs = (cards) => cards.map((c) => (c.hidden || !c.r ? '??' : c.r + c.s)).join(' ');
  // Side bets of the round in play: the stake while it is open, the result once it is known.
  const liveSides = (x) => {
    const done = new Map((x.sideResults || []).map((r) => [r.key, r]));
    const parts = Object.entries(x.bet?.sides || {}).filter(([k, v]) => v > 0 && SIDE_BETS[k]).map(([k, v]) => { const r = done.get(k); return `${esc(SIDE_BETS[k].name)} ${r ? (r.win ? '<b class="up">+' + money(r.pay - r.stake) + '</b>' : r.push ? 'back' : '<b class="down">-' + money(r.stake) + '</b>') : money(v)}`; });
    if (x.insurance) parts.push(`Insurance ${money(x.insurance)}`);
    return parts.length ? `<div class="hp-sides">${parts.join(', ')}</div>` : '';
  };
  const liveSeats = st0.phase !== 'betting' && st0.phase !== 'settled' ? st0.seats.filter((x) => x && x.hands.length) : [];
  const live = liveSeats.length ? `<div class="hp-round hp-live"><div class="hp-top"><b>#${st0.round}</b> ${esc(st0.banker?.name || 'House')} ${esc(cs(st0.dealer.cards))}${st0.dealer.cards.some((c) => c.hidden || !c.r) ? '' : ' = ' + (st0.dealer.total > 21 ? 'bust' : st0.dealer.total)} <i>live</i></div>${liveSeats.map((x) => `<div class="hp-seat"><span>${esc(st0.players.find((q) => q.id === x.playerId)?.name || 'Player')}: ${x.hands.map((y) => `${esc(cs(y.cards))} = ${y.total > 21 ? 'bust' : y.total}`).join(' | ')}</span></div>${liveSides(x)}`).join('')}</div>` : '';
  const sig = S.state.histN + '|' + (S.guestHist || []).length + '|' + live;
  if (el && el.isConnected && !force && S.histPanelN === sig) return;
  S.histPanelN = sig;
  const all = await allRounds();
  if (!S.role || !histOn()) return;
  el = $('#hist-panel');
  if (!el || !el.isConnected) { el = document.createElement('div'); el.id = 'hist-panel'; app.appendChild(el); }
  const net = (n) => `<b class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : n < 0 ? '-' : ''}${money(Math.abs(n))}</b>`;
  const rows = all.slice(-30).reverse().map((h) => `<div class="hp-round"><div class="hp-top"><b>#${h.round}</b> ${esc(h.dealerName)} ${esc(h.dealer)} = ${h.dealerTotal > 21 ? 'bust' : h.dealerTotal}</div>${h.seats.map((x) => `<div class="hp-seat"><span>${esc(x.name)}: ${x.hands.map((y) => `${esc(y.cards)} = ${y.total}${y.result ? ` <i class="${y.net > 0 ? 'up' : y.net < 0 ? 'down' : ''}">${esc(y.result)}${y.net ? ' ' + (y.net > 0 ? '+' : '-') + money(Math.abs(y.net)) : ''}</i>` : ''}`).join(' | ')}</span>${net(x.net)}</div>${(x.sides || []).length ? `<div class="hp-sides">${x.sides.map((z) => `${esc(z.name)} ${z.net > 0 ? '<b class="up">+' + money(z.net) + '</b>' : z.net < 0 ? '<b class="down">-' + money(-z.net) + '</b>' : 'back'}`).join(', ')}</div>` : ''}`).join('')}</div>`).join('');
  el.innerHTML = `<div class="hp-head"><span>Hand history</span><button data-act="history" title="Open the full list">Full</button><button data-act="hist-panel" title="Turn this panel off" aria-label="Turn the hand history panel off">×</button></div><div class="hp-list">${live}${rows || (live ? '' : '<p>No round has been played yet.</p>')}</div>`;
}
async function showHistory() {
  if (!S.role) return;
  S.histShown = S.state?.histN;
  const all = await allRounds();
  const list = S.histScope === 'shoe' ? HX.sinceLastShuffle(all) : all;
  $('#modal-body').innerHTML = histHTML(list).replace('</h2>', `</h2>${scopeHTML()}<div class="hx-row"><span class="hint">${list.length} of ${all.length} rounds shown${S.role !== 'host' && (S.guestHistTotal || 0) > all.length ? ` (the last ${all.length} of ${S.guestHistTotal})` : ''}.</span></div>`);
  $('#modal-body').dataset.hx = 'history';
  if (!$('#modal').open) $('#modal').showModal();
}
async function showExport() {
  if (S.role !== 'host') return;
  const tables = await HX.listTables();
  const cur = S.table.created?.id;
  const when = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
  const row = (t) => `<div class="hx-table"><div><b>Table ${esc(t.code || '')}</b>${t.id === cur ? ' <span class="role-tag host">this table</span>' : ''}<br><span class="hint">Opened ${when(t.created)} · ${t.id === cur ? Math.max(t.rounds, (S.table.hist || []).length) : t.rounds} rounds</span></div>
    <div class="hx-btns"><button class="btn small" data-hx="dl" data-id="${t.id}" data-f="txt">Text file</button><button class="btn small" data-hx="dl" data-id="${t.id}" data-f="csv">Spreadsheet (.csv)</button><button class="btn small" data-hx="dl" data-id="${t.id}" data-f="txt" data-src="online" title="Read this table back from the online backup">From backup</button></div></div>`;
  $('#modal-body').innerHTML = `<h2 style="margin-top:0">Export hand history</h2>
    <p class="hint">Every round with its time, shuffle number, bets, side bets, cards, each move in order and the result, plus who joined, left or reconnected. Only the host can export. Players never receive this.</p>
    ${scopeHTML()}
    <div class="hx-tables">${tables.map(row).join('') || '<p class="hint">No table has been saved on this browser yet.</p>'}</div>
    <p class="hint">This browser keeps its last 5 tables, also after it is closed. A sixth table drops the oldest. Each round is also saved to an online backup that only this browser can read back.${HX.backupState.last ? ' ' + esc(HX.backupState.last) + ' It will try again after the next round.' : ''}</p>`;
  $('#modal-body').dataset.hx = 'export';
  if (!$('#modal').open) $('#modal').showModal();
}
async function exportTable(id, fmt, online) {
  if (S.role !== 'host') return;
  const meta = (await HX.listTables()).find((t) => t.id === id) || { id, code: S.code, created: S.table.created?.at };
  let all;
  try { all = online ? await HX.fetchBackup(id) : await hostRounds(id); } catch (e) { toast(e.message || 'The online backup could not be reached.'); return; }
  const list = S.histScope === 'shoe' ? HX.sinceLastShuffle(all) : all;
  if (!list.length) { toast(online ? 'The online backup has no rounds for this table yet.' : 'This table has no finished rounds yet.'); return; }
  const scope = S.histScope === 'shoe' ? 'Since last shuffle' : 'All hands';
  const d = new Date(), name = `blackjack-${meta.code || 'table'}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${S.histScope === 'shoe' ? 'last-shuffle' : 'all'}${online ? '-backup' : ''}`;
  if (fmt === 'csv') HX.download(name + '.csv', HX.toCSV(meta, list), 'text/csv;charset=utf-8');
  else HX.download(name + '.txt', HX.toText(meta, list, scope, id === S.table.created?.id && !online ? S.table.evts || [] : []), 'text/plain;charset=utf-8');
  toast(`Saved ${list.length} ${list.length === 1 ? 'round' : 'rounds'} to your downloads.`);
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-hx]');
  if (!el || el.id === 'modal-body' || S.role !== 'host') return;
  const again = () => ($('#modal-body').dataset.hx === 'export' ? showExport() : showHistory());
  if (el.dataset.hx === 'scope') { S.histScope = el.dataset.v; again(); }
  else if (el.dataset.hx === 'export') showExport();
  else if (el.dataset.hx === 'dl') exportTable(el.dataset.id, el.dataset.f, el.dataset.src === 'online');
});

// Running tally of buy-ins and results for everyone at the table.
function renderGuestPlayers(st) {
  { const lg = $('#host-log'); if (lg && S.role !== 'host' && S.state?.log) lg.innerHTML = S.state.log.slice().reverse().map((l) => `<div>${esc(l)}</div>`).join(''); }
  const box = $('#guest-players');
  if (!box) return;
  box.innerHTML = st.players.map((p) => `<div class="player-row"><div><b>${p.id === st.hostId ? '<span class="crown">♛</span> ' : ''}${esc(p.name)}</b>${p.id === S.myId ? ' (you)' : ''}
    ${p.id === st.hostId ? '<span class="role-tag host">Host</span>' : ''}${st.banker?.id === p.id ? ' <span class="role-tag">Dealer</span>' : ''}<br>
    <span class="hint">${money(p.chips)} chips · ${p.seat === null ? 'not seated' : 'seat ' + (p.seat + 1)} · ${p.connected ? 'online' : 'away'}</span></div></div>`).join('');
}

function renderLedger(st) {
  const box = $('#ledger');
  if (!box || !st.ledger) return;
  const net = (r) => r.chips - r.totalIn - (r.houseNet || 0); // hands against the house are left out
  const rows = st.ledger.slice().sort((a, b) => net(b) - net(a));
  const sumIn = rows.reduce((a, r) => a + r.totalIn, 0);
  const sumChips = rows.reduce((a, r) => a + r.chips, 0);
  const pl = (n) => `<span class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : ''}${money(n)}</span>`;
  box.innerHTML = `<button class="ledger-head" data-act="ledger-toggle"><span class="lh-long">Ledger</span><span class="lh-short">Ledger</span> <span>${box.classList.contains('closed') ? '▴' : '▾'}</span></button>
    <div class="ledger-body"><table>
      <tr><th>Player</th><th>Bought in</th><th>Chips</th><th>+/-</th></tr>
      ${rows.map((r) => `<tr class="${r.id === S.myId ? 'me' : ''}"><td>${r.id === st.hostId ? '♛ ' : ''}${esc(r.name)}${r.kicked ? ' (left)' : r.connected ? '' : ' (away)'}${st.banker?.id === r.id ? ' (dealer)' : ''}</td><td>${money(r.totalIn)}</td><td>${money(r.chips)}</td><td>${pl(net(r))}</td></tr>`).join('')}
      <tr class="tot"><td>Table</td><td>${money(sumIn)}</td><td>${money(sumChips)}</td><td>${pl(rows.reduce((a, r) => a + net(r), 0))}</td></tr>
    </table>
    <div class="hint">Bought in counts starting chips, buy-ins and chips the host gives or takes. The +/- column counts only hands played with a player as the dealer, so it always adds up to zero. Hands against the house are practice and are left out.</div></div>`;
}

// The host sees a pop-up for each buy-in request.
function renderHostPops() {
  const box = $('#host-pops');
  if (!box || S.role !== 'host') return;
  const reqs = S.table.buyIns || [];
  box.innerHTML = reqs.map((r) => `<div class="host-pop"><b>${esc(S.table.players[r.playerId]?.name || 'A player')}</b> wants to buy in <b>${money(r.amount)}</b> chips.
    <div class="actions"><button class="btn small primary" data-act="buyin-answer" data-id="${r.id}" data-yes="1">Approve</button><button class="btn small danger" data-act="buyin-answer" data-id="${r.id}" data-yes="0">Say no</button></div></div>`).join('');
}

// Put HTML into a part of the page only when it really changed. The table sends a new state for
// every chip anyone moves; leaving untouched parts alone keeps buttons, hover and focus steady.
function setHTML(el, html) {
  if (!el || el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

function render(note) {
  drawHistPanel();
  if (S.role && $('#modal')?.open && $('#hist-list') && S.state && S.state.histN !== S.histShown) showHistory();
  if (!S.role) return;
  const st = S.state;
  const pill = $('#conn-pill');
  if (pill) {
    pill.className = 'pill ' + (S.online ? 'live' : 'off');
    pill.textContent = S.online ? `Table ${S.code}${S.role === 'player' && S.viaRelay ? ' · backup path' : ''}` : (S.role === 'host' ? 'Opening table...' : 'Reconnecting...');
  }
  const share = $('#share');
  if (share && share.value !== shareLink()) share.value = shareLink();
  if (S.role === 'host') $('#offline-note')?.remove(); // this browser took the table over: the note is out of date
  // A guest whose host has gone away: say why, since the table lives in the host's browser tab.
  if (S.role !== 'host') {
    if (S.online) S.offSince = 0; else S.offSince ||= Date.now();
    const stuck = !S.online && Date.now() - S.offSince > 6000;
    let box = $('#offline-note');
    if (box && box.dataset.why !== (S.why || '')) { box.remove(); box = null; }
    if (box && stuck) { const n = box.querySelector('.link-note'); if (n) n.outerHTML = linkNote() || '<small class="link-note"></small>'; }
    if (stuck && !box) {
      let mine = null; try { mine = JSON.parse(safeGet('bj-host') || 'null')?.code; } catch {}
      box = document.createElement('div'); box.id = 'offline-note'; box.className = 'offline-note'; box.dataset.why = S.why || '';
      const why = S.why === 'net' ? ['Your connection dropped.', 'This phone or computer lost its internet link for a moment. The page keeps trying and joins the table again by itself.']
        : S.why === 'nohost' ? ['The host is away.', 'The host\'s browser closed or went to sleep. In a few seconds the table opens again in another player\'s browser, with the same seats and chips and a new shuffle. This page joins again by itself.']
        : ['Cannot reach the host.', 'The table is open, but the link to the host does not open. Either the host\'s browser is asleep or in a background tab, or one of the two networks blocks the link. Ask the host to open the game tab. If the host stays away, the table moves to another player after about a minute. If that does not happen, switch between Wi-Fi and mobile data, or turn off a VPN. The page keeps trying.' + linkNote()];
      box.innerHTML = `<b>${why[0]}</b><div>${why[1]}</div>${mine === S.code ? `<a class="btn gold" href="${location.pathname}?host=${encodeURIComponent(S.code)}">I am the host: reopen my table</a>` : ''}<a class="btn" href="${location.pathname}">Start a new table</a>`;
      document.body.appendChild(box);
    } else if (!stuck && box) box.remove();
    if (!S.online && !S.offTick) S.offTick = setInterval(() => { if (S.online) { clearInterval(S.offTick); S.offTick = null; } render(); }, 2000);
  }
  if (!st) {
    setHTML($('#felt'), `<div class="center-msg">${esc(note || 'Connecting to the table...')}</div>`);
    setHTML($('#tray'), '');
    $('#controls').innerHTML = '';
    return;
  }
  queueCards(st);
  S.dealing = dealingNow();
  fairWatch(st);
  { const fp = $('#fair-pill'), bad = !!S.fair?.alert || Object.values(S.fair?.checks || {}).some((k) => !k.ok); if (fp) { fp.classList.toggle('bad', bad); fp.innerHTML = bad ? '⚠️<span class="fp-t"> Shuffle check failed</span>' : '🔐<span class="fp-t"> Provably fair</span>'; } }
  const prev = S.prevView;
  if (prev && st.round !== prev.round) { S.undo = []; S.mainChips = []; S.sideChips = {}; }
  // Once the cards are dealt, the picked chip is put down, so the next round starts with none picked.
  if (prev && prev.phase !== st.phase && !(st.phase === 'betting' || st.phase === 'settled')) S.chip = null;
  // The dealer sees the table from the dealer's side: dealer at the bottom, players across the top.
  S.presence = roomPeople(st)[0].filter((p) => !p.isDealer && p.seat !== null).map((p) => ({ id: p.id, name: p.name, look: p.look, seat: p.seat, seats: p.seats }));
  if (S.room) S.room.setSide(myInfo(st).isBanker ? 'dealer' : 'player');
  $('#felt').classList.toggle('flip', myInfo(st).isBanker);
  setHTML($('#felt'), feltHTML(st));
  // In the 3D room the status line, the timer and "Deal me in" sit with the buttons at the bottom of the screen, so they never leave it.
  if (S.room) {
    $('#hud-top').innerHTML = `<div class="status">${esc(statusText(st))} <span id="timer" class="timer" hidden></span></div>${dealMeInHTML(st)}`;
    S.room.setPeople(...roomPeople(st));
    S.room.setOthers(S.others);
    S.room.setChips(st.seats.map((seat, i) => { const pl = seat && st.players.find((x) => x.seat === i); return seat ? { seat: i, main: seat.bet?.main || 0, balance: pl ? Math.max(0, pl.chips - betTotal(seat.bet)) : 0, mine: seat.playerId === S.myId,
        sides: Object.entries(seat.bet?.sides || {}).filter(([, v]) => v > 0).map(([k, v]) => [k === 'friendBust' ? `#seat-${i} .pvp-tag.mine` : `#sb-${i}-${k}`, v]) } : null; }).filter(Boolean));
  }
  const tray = $('#tray');
  // During a hand the move buttons appear in the middle of the table, only when you have to act,
  // and only once the cards being dealt have landed.
  const between = st.phase === 'betting' || st.phase === 'settled';
  // Flat view: the tray under the table always holds your buttons, so nothing sits on the cards. The 3D room keeps its floating panel.
  // Move buttons wait until the cards being dealt have landed.
  const watching = !myInfo(st).seat && !myInfo(st).isBanker; // someone watching always keeps their line and the ask for a seat
  const inTray = between || !S.room || watching;
  drawSitOut(st);
  setHTML(tray, autoBarHTML(st) + (inTray ? (between || !S.dealing || watching ? trayHTML(st) : '') + sideResultsHTML(st) : ''));
  setHTML($('#felt-actions'), inTray || S.dealing ? '' : trayHTML(st));
  // The round result stays up until the cards are cleared.
  if (st.phase !== 'settled') { clearTimeout(S.resultTimer); $('#result-pop')?.remove(); }
  $('#controls').innerHTML = controlsHTML(st);
  $('#controls').hidden = !$('#controls').innerHTML.trim();
  if (S.role === 'host') renderHostPanel(st);
  renderVote(st);
  renderBalance(st);
  renderHostPops();
  renderLedger(st);
  renderGuestPlayers(st);
  renderGuide(st);
  // Out of chips between rounds: offer a buy-in once per round. They can close it, or leave the seat and watch.
  {
    const { me, seat } = myInfo(st);
    const between = st.phase === 'betting' || st.phase === 'settled';
    if (me && seat && between && me.chips < st.settings.minBet && !betTotal(seat.bet) && S.brokeAsked !== st.round && $('#buyin-pop')?.hidden) {
      S.brokeAsked = st.round;
      openBuyIn(true);
    }
  }
  if (!S.fitted) { S.fitted = true; applyZoom(); }
  placePanels();
  updateTimer();
  runDealQueue();
  animateChanges(prev, st);
  S.prevView = { phase: st.phase, round: st.round, ins: Object.fromEntries(st.seats.filter(Boolean).map((s) => [s.playerId, s.insurance || 0])), bets: Object.fromEntries(st.seats.filter(Boolean).map((s) => [s.playerId, betTotal(s.bet)])) };
}

// Pop-up vote when someone asks to move to the dealer seat.
function renderVote(st) {
  let box = $('#vote');
  const v = st.vote;
  if (!v) { if (box) box.remove(); S.voteBoxId = null; return; }
  S.voteEndsLocal = S.voteBoxId === v.id ? S.voteEndsLocal : Date.now() + (st.voteEndsIn || VOTE_SECONDS * 1000);
  S.voteBoxId = v.id;
  if (!box) { box = document.createElement('div'); box.id = 'vote'; box.className = 'vote-pop'; document.body.appendChild(box); }
  const mine = v.candidate === S.myId;
  const isSet = v.kind === 'settings';
  const title = mine ? 'Waiting for votes' : isSet ? `${esc(v.name)} (host) wants to change the settings` : `${esc(v.name)} wants to be the dealer`;
  const body = isSet ? `<ul class="vote-list">${(v.summary || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  box.innerHTML = `<div class="vote-card">
    <div class="vote-title">${title}</div>
    ${body}
    <p>${mine ? `Everyone else has to say yes. ${v.yes} of ${v.voters} said yes so far.` : isSet ? 'Everyone has to say yes. No answer counts as no.' : 'They would pay all winning bets and collect all losing bets. Everyone has to say yes. No answer counts as no.'}</p>
    ${v.canVote ? `<div class="actions"><button class="btn primary" data-vote="1">Yes</button><button class="btn danger" data-vote="0">No</button></div>` : (mine ? '' : '<p class="hint">You voted. Waiting for the others.</p>')}
    <div class="vote-bar"><span id="vote-bar"></span></div>
  </div>`;
  box.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', () => send({ t: 'vote', yes: b.dataset.vote === '1' })));
  updateVoteBar();
}
function updateVoteBar() {
  const bar = $('#vote-bar');
  if (!bar) return;
  const left = Math.max(0, S.voteEndsLocal - Date.now());
  bar.style.width = (100 * left) / (VOTE_SECONDS * 1000) + '%';
}
setInterval(updateVoteBar, 200);

function betTotal(b) { return (b?.main || 0) + Object.values(b?.sides || {}).reduce((x, y) => x + y, 0); }

// Chips move on the table when other players bet, and when a round is paid out.
function animateChanges(prev, st) {
  if (!prev) return;
  if (st.phase === 'settled' && prev.phase !== 'settled') {
    showResult(st);
    // Dealer blackjack ends the round at once, so say it in large letters (the insurance check below already does when it ran).
    if (dealerBJ(st) && prev.phase !== 'insurance') banner('Dealer has blackjack', 'The round is over.', 'bad', 3200);
    badBeat(st);
    // Dumb luck: you went against basic strategy this round and still won.
    const mine = myInfo(st).seat;
    if (S.badPlayRound === st.round && mine && mine.net > 0) {
      setTimeout(() => { send({ t: 'throw', item: 'fire', to: S.myId }); toast('🔥 Dumb luck! Wrong play, still won.'); }, 1200);
    }
  }
  // A new round started without me: say so once, with the reason.
  if (st.round !== prev.round && (prev.phase === 'betting' || prev.phase === 'settled') && st.phase !== 'betting' && st.phase !== 'settled') {
    const { me, seat } = myInfo(st);
    if (me && seat && !seat.hands.length) {
      const min = st.settings.minBet, main = seat.bet.main;
      if (!main) toast('You did not place a bet, so you were not dealt in this round.');
      else if (main < min) banner('You were not dealt in', `Table minimum is ${money(min)}. Your bet was ${money(main)}.`, 'bad', 5000);
      else banner('You were not dealt in', 'Your bet was more than your chips.', 'bad', 5000);
    }
  }
  const dealer = $('#dealer-zone .cards') || $('#dealer-zone');
  // Chips are paid and collected after the last card has landed.
  const payDelay = Math.max(300, S.dealEnds - performance.now() + 150);
  // Insurance: after the dealer checks the hole card, say what happened.
  if (prev.phase === 'insurance' && st.phase !== 'insurance' && prev.round === st.round) {
    const anyIns = st.seats.some((x) => x && x.insurance > 0);
    const bj = st.dealer.cards.length === 2 && !st.dealer.cards[1].hidden && st.dealer.total === 21;
    banner(bj ? 'Dealer has blackjack' : 'No blackjack. Play continues', bj ? (anyIns ? 'Insurance pays 2 to 1.' : '') : (anyIns ? 'Insurance bets are lost.' : ''), bj ? 'bad' : 'ok');
  }
  st.seats.forEach((s, i) => {
    if (!s) return;
    const spot = $(`#spot-${i}`);
    // Insurance chips: onto the table when taken, to the dealer when the dealer has no blackjack.
    const insBefore = prev.ins?.[s.playerId] || 0;
    if (s.insurance > insBefore) flyChip(s.playerId === S.myId ? ($('#float-balance') || $(`#seat-${i} .who`)) : $(`#seat-${i} .who`), $(`#seat-${i} .ins-tag`) || spot, s.insurance);
    if (prev.phase === 'insurance' && st.phase === 'playing' && s.insurance > 0) flyChip($(`#seat-${i} .ins-tag`) || spot, dealer, s.insurance, 500);
    const before = prev.bets[s.playerId] || 0;
    const now = betTotal(s.bet);
    // My own chips already flew when I clicked them.
    if (s.playerId !== S.myId && now > before && (st.phase === 'betting' || st.phase === 'settled') && prev.round === st.round) {
      flyChip($(`#seat-${i} .who`), spot, now - before);
    }
    if (st.phase === 'settled' && prev.phase !== 'settled' && s.hands.length && s.net) {
      const n = Math.min(5, 1 + Math.floor(Math.abs(s.net) / 50));
      for (let k = 0; k < n; k++) {
        if (s.net > 0) flyChip(dealer, spot, Math.abs(s.net), payDelay + k * 90, false);
        else flyChip(spot, dealer, Math.abs(s.net), payDelay + k * 90, false);
      }
    }
  });
}

function dealerBJ(st) { const c = st.dealer?.cards || []; return c.length === 2 && !c.some((x) => x.hidden) && handTotal(c).total === 21; }
// Big "You win / You lose" message over the table that fades away.
function showResult(st) {
  const { seat, isBanker } = myInfo(st);
  let net = null;
  if (isBanker) net = st.banker.net;
  else {
    // All of my seats in this round count together.
    const { me } = myInfo(st);
    const own = (me?.seats || (seat ? [me.seat] : [])).map((i) => st.seats[i]).filter((x) => x && x.hands.length);
    if (own.length) net = own.reduce((a, x) => a + (x.net || 0), 0);
    else if (seat && seat.hands.length) net = seat.net;
  }
  if (net === null || net === undefined) return;
  // Running total since joining the table, the same number as the ledger.
  const row = (st.ledger || []).find((r) => r.id === S.myId);
  const all = row ? row.chips - row.totalIn - (row.houseNet || 0) : null;
  const allLine = all === null || st.frozen ? '' : `<em class="rp-total ${all > 0 ? 'up' : all < 0 ? 'down' : ''}">Total ${all > 0 ? 'profit' : all < 0 ? 'loss' : 'even'}${all ? ' ' + money(Math.abs(all)) : ''}</em>`;
  $('#result-pop')?.remove();
  const el = document.createElement('div');
  el.id = 'result-pop';
  el.className = 'result-pop ' + (net > 0 ? 'win' : net < 0 ? 'lose' : 'push');
  el.innerHTML = (net > 0 ? `<small>Net profit</small><b>${money(net)}</b>` : net < 0 ? `<small>Net loss</small><b>${money(-net)}</b>` : '<small>Net</small><b>Even</b>') +
    (dealerBJ(st) ? '<em class="warn">Dealer has blackjack</em>' : '') +
    (S.timedOutRound === st.round ? '<em class="warn">Time ran out. Your hand was stood.</em>' : '') +
    (st.frozen ? '<em>House dealer: not counted in the ledger</em>' : '');
  const felt = document.body;
  // Wait for the last cards and chips to land first.
  // It stays up until the cards are cleared (render takes it away when the next round opens).
  clearTimeout(S.resultTimer);
  S.resultTimer = setTimeout(() => {
    if (S.state?.phase !== 'settled') return;
    felt.appendChild(el);
    if (net > 0) winSound(net >= 500);
    el.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.6)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.05)', offset: 0.4 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
    ], { duration: 420, easing: 'ease-out' });
    // After a moment it makes itself small and moves up, so the hands and their results can be read.
    setTimeout(() => { el.classList.add('stay'); document.querySelectorAll('.table-banner').forEach((b) => b.classList.add('out')); }, 1300);
  }, Math.max(350, S.dealEnds - performance.now() + 250));
}

function suitClass(s) { return { '♠': 's-s', '♥': 's-h', '♦': 's-d', '♣': 's-c' }[s] || ''; }
// Cards are dealt one at a time from the shoe. Each new card gets a start time in the
// deal queue; until then it is invisible, then it slides out of the shoe.
const DEAL_GAP = 380;
function cardHTML(c, big, key, order) {
  let cls = 'card' + (big ? ' big' : '');
  let extra = '';
  if (key) {
    const now = performance.now();
    // queueCards gave every card on the table its time before this drawing started.
    if (!S.cardAt.has(key)) S.cardAt.set(key, now - 10000);
    const at = S.cardAt.get(key);
    if (at > now - 50) { cls += ' pending'; extra = ` data-key="${key}"`; }
    // The dealer's hole card turns over in place.
    if (c.hidden) S.holeHidden.add(key);
    else if (S.holeHidden.has(key)) { S.holeHidden.delete(key); cls += ' flip'; setTimeout(cardSound, 0); }
  }
  if (c.hidden) return `<div class="${cls} back"${extra}></div>`;
  // A real playing-card index: rank with a small suit under it in the top-left corner, so both stay readable when cards overlap.
  return `<div class="${cls} ${suitClass(c.s)}"${extra}><span class="ix"><span class="rk${c.r === '10' ? ' ten' : ''}">${c.r}</span><span class="sx">${c.s}</span></span><span class="st">${c.s}</span></div>`;
}

const FLIGHT = 420; // how long a card takes from the shoe to its place
// Give every card that is new in this state its moment in the deal. This runs before the table is
// drawn, so the drawing knows which hands still have a card on the way. While cards are flying,
// totals, results, side bet results, the turn highlight and the move buttons stay hidden; one more
// drawing is booked for the moment the last card lands.
function queueCards(st) {
  const now = performance.now();
  const add = [];
  const see = (key, order) => { if (!S.cardAt.has(key)) { S.cardAt.set(key, null); add.push({ key, order }); } };
  const r = st.round;
  st.dealer.cards.forEach((c, i) => see(`${r}-d-${i}`, [i, st.seats.length]));
  st.seats.forEach((seat, i) => seat && seat.hands.forEach((h, j) => h.cards.forEach((c, k) => see(`${r}-${i}-${j}-${k}`, [k + j * 10, i]))));
  if (!add.length) return;
  // The first look at a table (joining, or coming back after a reload): the cards are already there.
  if (!S.prevView) { add.forEach((p) => S.cardAt.set(p.key, now - 10000)); return; }
  // Deal in casino order: first card to each seat, then the dealer, then the second card.
  add.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  if (now >= S.dealEnds) { S.dealStart = now; S.dealMany = false; }
  for (const p of add) {
    const at = Math.max(now, S.nextCardAt);
    S.cardAt.set(p.key, at);
    S.nextCardAt = at + DEAL_GAP;
  }
  if (add.length >= 4) S.dealMany = true;
  S.dealEnds = S.nextCardAt - DEAL_GAP + FLIGHT;
  clearTimeout(S.dealDone);
  S.dealDone = setTimeout(render, S.dealEnds - now + 40);
}
function dealingNow() { return performance.now() < S.dealEnds; }
// True while any of these cards belongs to the deal that is still going on.
function inFlight(keys) { return S.dealing && keys.some((k) => (S.cardAt.get(k) ?? 0) >= S.dealStart); }

function runDealQueue() {
  const shoe = $('#shoe');
  document.querySelectorAll('.card.pending[data-key]').forEach((el) => {
    if (el._queued) return;
    el._queued = true;
    const at = S.cardAt.get(el.dataset.key);
    const delay = Math.max(0, at - performance.now());
    setTimeout(() => {
      if (!el.isConnected) return;
      const a = shoe?.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      el.classList.remove('pending');
      cardSound();
      S.room?.dealCard?.();
      if (!a) return;
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(-25deg) scale(.6)`, opacity: 0.6 },
        { transform: 'none', opacity: 1 },
      ], { duration: FLIGHT, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }, delay);
  });
}

function statusText(st) {
  const turnSeat = st.turn && st.seats[st.turn.seat];
  if (S.dealing && S.dealMany && (st.phase === 'insurance' || st.phase === 'playing')) return 'Dealing the cards';
  switch (st.phase) {
    case 'betting': return st.noDealer ? 'Bets can go down. The cards wait for a dealer' : st.bankShort ? ((st.banker?.chips || 0) < 0 ? `The dealer owes ${money(-st.banker.chips)} chips and has to buy in before the next deal` : `The dealer has ${money(st.banker?.chips || 0)} chips, fewer than the bets on the table. Lower the bets or the dealer buys in`) : waitingOnMe(st) ? 'The others are ready. Bet to join this round' : 'Place your bets';
    case 'insurance': return 'Dealer shows an ace. Insurance?';
    case 'playing': return turnSeat ? (turnSeat.playerId === S.myId ? 'Your turn' : turnSeat.connected === false ? `${turnSeat.name} is away. The dealer stands for them soon` : `${turnSeat.name} is playing`) : '';
    case 'dealer': return 'Dealer is playing';
    case 'settled': return S.dealing ? (S.dealMany ? 'Dealing the cards' : 'Dealer is playing') : 'Round over. The cards are cleared in a moment';
  }
  return '';
}

// You are seated with no bet down while somebody else has already pressed "Deal me in".
function waitingOnMe(st) {
  const { seat, isBanker } = myInfo(st);
  return !!seat && !isBanker && !seat.bet.main && st.seats.some((s) => s && s.ready);
}
function myInfo(st) {
  const me = st.players.find((p) => p.id === S.myId);
  const seat = me && me.seat !== null ? st.seats[me.seat] : null;
  const isBanker = st.banker?.id === S.myId;
  return { me, seat, isBanker };
}

// Each person sees their own seat in the middle, with friends around them in table order.
function seatOrder(st) {
  const { me, isBanker } = myInfo(st);
  const n = st.seats.length;
  if (isBanker) return Array.from({ length: n }, (_, i) => i);
  const center = Math.floor(n / 2);
  const home = me ? me.home ?? me.seat : null;
  const shift = home !== null && home !== undefined ? home - center : 0;
  // First base (seat 1, dealt first) is on the dealer's left, which is the right side of the screen.
  return Array.from({ length: n }, (_, pos) => (pos + shift + n) % n).reverse();
}

// A seat on the felt, from the rim towards the dealer: name plate (who), betting circle with its ring
// of side bets (ring), then the fixed box for the cards (hw wide, hh deep). Sizes in felt pixels before
// any shrinking; the f-values are for your own, larger seat. On a phone the other players are small
// cards (mw by mh) in a column down each side, and your own seat fills the middle.
const SEAT_BOX = {
  desk: { who: 44, ring: 120, hh: 124, fwho: 54, fring: 160, fhh: 206, gap: 6, side: 34, bottom: 24, top: 20 },
  phone: { mw: 80, mh: 124, side: 5, top: 58, bottom: 8, who: 40 },
  // The flat phone table has room for taller small seats, so their cards are larger and easy to read.
  phoneFlat: { mw: 84, mh: 150, side: 4, top: 58, bottom: 8, who: 40 },
};
// How the cards of a seat are sized: room for the labels under each hand (meta, or meta1 when hands
// are stacked in two rows), the largest card width, the narrowest a hand may be, and the gap between
// two hands. The box they must fit comes from the seat's place on the table.
const HAND_BOX = {
  focus: { meta: 46, meta1: 24, cwMax: 64, minW: 48, gap: 14 },
  seat: { meta: 40, meta1: 20, cwMax: 38, minW: 38, gap: 8 },
  mini: { meta: 18, meta1: 14, cwMax: 31, minW: 26, gap: 4 },
  pfocus: { meta: 40, meta1: 22, cwMax: 56, minW: 40, gap: 9 },
};
// Where every seat goes, like a real blackjack table: the dealer stands at the straight edge and the
// betting circles sit on one even arc along the curved edge, all at the same distance from a point
// just in front of the dealer, in equal steps, the same on the left and the right. Every seat is
// turned to face the dealer, so its cards lie between its circle and the dealer on one line.
// `c` is the place in the row (0 = far left) of your own seat, which is at the bottom middle and a
// little larger. Seats shrink only when the circles would touch. Returns one spot per place: x and y
// are percentages of the felt for the seat's outer edge, s its size (1 = full), r its turn in degrees,
// mode is 'focus' (your own big seat), 'seat' or 'mini', and hw by hh is the box for its cards.
function seatLayout(n, c, { W, H, phone, flip, round, noFocus, in3d }) {
  const pct = (v, of) => Math.round((v / of) * 10000) / 100;
  if (phone) return phoneLayout(n, c, { W, H, flip, noFocus, pct, in3d });
  const B = SEAT_BOX.desk, rad = Math.PI / 180;
  const K = Math.max(c, n - 1 - c, 1);
  const step = Math.min(24, 60 / K); // degrees between two seats
  const cy = B.top, Ry = H - B.bottom - cy;
  const Rx = Math.min(Ry, (W / 2 - B.side - 62) / Math.sin(K * step * rad));
  const Rm = Math.min(Rx, Ry), half = Math.sin((step / 2) * rad);
  const depth = B.who + B.ring + B.hh + B.gap;
  // Shrink until two neighbouring circles keep a gap between them.
  let s = Math.min(1, (2 * (Rm - B.who - B.ring / 2) * half) / (B.ring + 10));
  for (let i = 0; i < 4; i++) s = Math.min(1, (2 * (Rm - (B.who + B.ring / 2) * s) * half) / (B.ring + 10));
  const rIn = Rm - depth * s; // how close to the dealer the other seats' cards reach
  const hw = Math.max(60, Math.floor((2 * rIn * half) / s - 8));
  let fs = noFocus ? s : Math.sqrt(s); // your own seat shrinks more slowly, so your cards stay easy to read
  // At a full table of nine or ten, your own ring of side bets must still clear the rings beside it.
  if (!noFocus && n > 1) {
    const sa = Math.sin(step * rad), ca = Math.cos(step * rad), inN = (B.who + B.ring / 2) * s;
    const nx = Rx * sa - inN * sa, ny = Ry * ca - inN * ca;
    const clear = (f) => Math.hypot(nx, ny - (Ry - (B.fwho + B.fring / 2) * f)) >= (B.fring / 2) * f + (B.ring / 2) * s + 4;
    while (fs > s && !clear(fs)) fs -= 0.01;
  }
  // Your own cards may be as wide as the gap the two seats beside you leave.
  const yb = Ry - (B.fwho + B.fring + 14) * fs;
  const fhw = n > 1 ? Math.max(120, Math.min(256, Math.floor((2 * ((yb - 60) * Math.sin(step * rad) - (hw * s) / 2 - 4)) / Math.cos(step * rad) / fs))) : 256;
  return Array.from({ length: n }, (_, pos) => {
    const k = pos - c, a = k * step * rad;
    const big = !k && !noFocus;
    const x = W / 2 + Rx * Math.sin(a), y0 = cy + Ry * Math.cos(a), y = flip ? H - y0 : y0;
    return { x: pct(x, W), y: pct(y, H), s: Math.round((big ? fs : s) * 1000) / 1000, r: Math.round(-k * step * (flip ? -1 : 1) * 10) / 10,
      mode: big ? 'focus' : 'seat', hw: big ? fhw : hw, hh: big ? B.fhh : B.hh, sw: big ? Math.max(fhw, 176) : Math.max(hw, 124) };
  });
}
// Phone: your own seat is large at the bottom middle, the dealer large at the top, and everyone else
// is a small card (name, chips, bet, total, tiny cards) down the two sides. Tap one to see it large.
// The dealer's own view has no seat of its own, so every player is a small card in rows at the far end.
function phoneLayout(n, c, { W, H, flip, noFocus, pct, in3d }) {
  const B = in3d ? SEAT_BOX.phone : SEAT_BOX.phoneFlat;
  const HH = in3d ? 66 : 92;
  const out = new Array(n);
  // The dealer in the 3D room on a phone: the seats follow the rounded far end of the table, one after
  // another along its edge, so every seat is in front of the player who holds it and none is cut off.
  if (noFocus && flip && in3d) {
    const base = H * 0.8, lim = (n > 5 ? 82 : n > 3 ? 70 : 50) * Math.PI / 180;
    const at = (pos, s) => {
      const ax = W / 2 - 8 - (B.mw * s) / 2, by = base - 12 - (B.mh * s) / 2;
      const th = n === 1 ? 0 : -lim + (2 * lim * pos) / (n - 1);
      return { x: W / 2 + ax * Math.sin(th), y: base - by * Math.cos(th) };
    };
    // The largest tile size at which no two neighbours touch.
    let s = 1;
    const fits = (k) => { for (let pos = 1; pos < n; pos++) { const p = at(pos - 1, k), q = at(pos, k); if (Math.abs(q.x - p.x) < B.mw * k + 3 && Math.abs(q.y - p.y) < B.mh * k + 3) return false; } return true; };
    while (s > 0.5 && !fits(s)) s -= 0.04;
    for (let pos = 0; pos < n; pos++) { const p = at(pos, s); out[pos] = { x: pct(p.x, W), y: pct(p.y + (B.mh * s) / 2, H), s: Math.round(s * 1000) / 1000, r: 0, mode: 'mini', hw: B.mw - 4, hh: HH }; }
    return out;
  }
  if (noFocus) {
    const per = Math.max(1, Math.min(n, Math.floor((W - 2 * B.side) / (B.mw + 4))));
    const rows = Math.ceil(n / per);
    const s = Math.min(1, (H * 0.56 - 12) / (rows * (B.mh + 6)));
    for (let pos = 0; pos < n; pos++) {
      const row = Math.floor(pos / per), inRow = Math.min(per, n - row * per), col = pos - row * per;
      const x = W / 2 + (col - (inRow - 1) / 2) * (B.mw + 4);
      const yTop = 12 + row * (B.mh + 6) * s;
      out[pos] = { x: pct(x, W), y: pct(flip ? yTop + B.mh * s : H - yTop, H), s: Math.round(s * 1000) / 1000, r: 0, mode: 'mini', hw: B.mw - 4, hh: HH };
    }
    return out;
  }
  const left = c, right = n - 1 - c;
  // In the 3D room the felt is rounded like a real table and narrows towards your own seat, so the
  // side seats stop higher up and each one moves in as far as the curved edge at its height.
  const curve = in3d && !flip;
  const inset = (y) => (curve ? (W / 2) * (1 - Math.sqrt(Math.max(0, 1 - ((y / H - 0.12) / 0.88) ** 2))) : 0);
  const ybSide = curve ? H - 190 : H - 50; // flat table: the felt's rounded end lifts the corners
  const lane = W - (left || right ? 2 * (B.mw + B.side + inset(ybSide)) + 8 : 16);
  const dealerH = H < 500 ? 96 : 112, laneH = 74;
  const ring = Math.round(Math.max(96, Math.min(curve ? 150 : lane - 8, H * 0.27, 150))); // in the 3D room the side seats stop above the circle
  const hh = Math.round(Math.max(64, H - B.bottom - (curve ? 20 : 0) - B.who - 8 - ring - dealerH - laneH));
  const yb = ybSide;
  const col = (count, x0, posOf) => {
    if (!count) return;
    const slot = (yb - B.top) / count;
    const s = Math.min(1, (slot - 4) / B.mh);
    for (let k = 0; k < count; k++) out[posOf(k)] = { x: pct(x0 + Math.sign(W / 2 - x0) * inset(yb - k * slot), W), y: pct(yb - k * slot, H), s: Math.round(s * 1000) / 1000, r: 0, mode: 'mini', hw: B.mw - 4, hh: HH };
  };
  col(left, B.side + B.mw / 2, (k) => c - 1 - k);
  col(right, W - B.side - B.mw / 2, (k) => c + 1 + k);
  out[c] = { x: 50, y: pct(H - B.bottom - (curve ? 20 : 0), H), s: 1, r: 0, mode: 'focus', phone: true, hw: lane, hh, rz: Math.round((ring / 160) * 1000) / 1000, sw: lane };
  return out;
}
function seatSpots(st) {
  const { me } = myInfo(st);
  const order = seatOrder(st);
  const box = feltBox();
  // The big middle seat is your own. Before you sit down it is simply the seat in the middle of the row.
  const home = me ? me.home ?? me.seat : null;
  const mid = home !== null && home !== undefined && order.includes(home) ? order.indexOf(home) : order.length - 1 - Math.floor(order.length / 2);
  // The dealer looks at the table from the other side and has no seat there, so no seat is the big one.
  return { order, mid, box, spots: seatLayout(order.length, mid, { ...box, noFocus: box.flip || !box.phone }) };
}
const spotStyle = (p) => `--x:${p.x}%;--y:${p.y}%;--s:${p.s};--r:${p.r}deg;--hw:${p.hw}px;--hh:${p.hh}px${p.rz ? `;--rz:${p.rz}` : ''}${p.sw ? `;--sw:${p.sw}px` : ''}`;
// The window changed size: applyZoom draws the table again when the felt itself changed.
function placeSeats() {}
function feltBox() {
  const el = $('#felt');
  const flip = !!el?.classList.contains('flip');
  const in3d = !!el?.classList.contains('in3d');
  if (S.felt && !in3d) return { W: S.felt.W, H: S.felt.H, phone: S.felt.phone, flip, round: flip, in3d };
  const phone = matchMedia('(max-width: 700px)').matches;
  return { W: el?.clientWidth || (phone ? innerWidth - 16 : FELT.W), H: el?.clientHeight || (phone ? 560 : FELT.H), phone, flip, round: flip || in3d, in3d };
}

// Cards of one hand, laid as a fan: each next card sits half a card to the right and a little higher,
// so the rank and suit in every top-left corner stay in view. `cw` is the card width in pixels.
const FAN_DX = 0.5;
function fanUnits(cards, doubled) { const k = Math.max(1, doubled ? cards - 1 : cards); return Math.max(1 + (k - 1) * FAN_DX, doubled ? 1.5 : 1); }
function placed(html, style) { return html.replace('<div class="', `<div style="${style}" class="`); }

function feltHTML(st) {
  const d = st.dealer;
  const r = st.round;
  const { me, isBanker } = myInfo(st);
  const shoeTxt = st.settings.decks === 'csm' ? 'Randomized: shuffled every round' :
    `${st.settings.decks} deck${st.settings.decks > 1 ? 's' : ''} · ${st.shoe.left}/${st.shoe.size} cards left · ` +
    (st.settings.shuffleMode === 'rounds' ? `shuffle every ${st.settings.shuffleEvery} rounds` : `shuffle at ${st.settings.penetration}%`);
  const dealerBusy = inFlight(d.cards.map((c, i) => `${r}-d-${i}`));
  const dealerTotal = d.cards.length && !dealerBusy ? `<span class="total">${d.total > 21 ? 'Bust ' + d.total : d.total + (d.soft && d.total < 21 ? ' soft' : '')}</span>` : '';
  const b = st.banker;
  let dealerSeat;
  if (b) {
    const net = b.net && !S.dealing ? `<span class="net ${b.net > 0 ? 'up' : 'down'}">${b.net > 0 ? '+' : ''}${money(b.net)}</span>` : '';
    dealerSeat = `<div class="dealer-name" ${isBanker ? '' : `data-throw-at="${b.id}" title="Tap to throw something at the dealer"`}>${esc(b.name)}${isBanker ? ' (you)' : ''} is the dealer ${isBanker ? '' : `<span class="chips">${money(b.chips)}</span>`} ${net}
${isBanker && st.settings.decks !== 'csm' ? `<button class="btn small gold" data-act="d-shuffle" title="${st.phase === 'betting' || st.phase === 'settled' ? 'Shuffle the shoe now' : 'Shuffle the shoe before the next hand'}">🔀 Shuffle</button>` : ''}</div>`;
  } else {
    dealerSeat = `<div class="dealer-name">${st.frozen ? 'Dealer: house (automatic)' : 'No dealer yet'}
      ${me && !st.vote ? '<button class="btn small gold" data-act="sit-dealer">Ask to be dealer</button>' : ''}</div>`;
  }
  const { order, spots, box } = seatSpots(st);
  computeOdds(st);
  // The dealer's cards: side by side while they fit, closer together when the hand grows. The total sits beside them.
  const laneW = box.phone ? (spots.find((p) => p.mode === 'focus')?.hw || box.W - 16) : 620;
  const dcw = box.phone ? (box.H < 500 ? 46 : 52) : 66;
  const dn = Math.max(1, d.cards.length);
  const ddx = dn > 1 ? Math.max(FAN_DX, Math.min(0.86, ((box.phone ? laneW - 70 : 440) / dcw - 1) / (dn - 1))) : 0;
  const dW = Math.round(dcw * (1 + (dn - 1) * ddx));
  const dealerH = box.phone ? (box.H < 500 ? 96 : 112) : 152;
  const zoomSeat = S.zoomSeat != null && (spots[order.indexOf(S.zoomSeat)]?.mode === 'mini' || (spots[order.indexOf(S.zoomSeat)]?.mode === 'seat' && st.seats[S.zoomSeat]?.hands.length > 2)) && st.seats[S.zoomSeat] ? S.zoomSeat : null;
  return `
    ${countBadgeHTML(st)}
    <div class="shoe-box"><div class="shoe" id="shoe"><div class="shoe-cards"></div><div class="shoe-fill" style="--fill:${Math.round(100 * st.shoe.left / (st.shoe.size || 1))}%"></div></div><div class="shoe-info">${shoeTxt}</div></div>
    <div class="dealer" id="dealer-zone" style="--cw:${dcw}px">
      ${dealerSeat}
      <div class="dealer-hand">
        <div class="cards" style="width:${dW}px">${d.cards.map((c, i) => placed(cardHTML(c, true, `${r}-d-${i}`, [i, st.seats.length]), `left:${Math.round(i * ddx * dcw)}px`)).join('')}</div>
        <div class="dealer-total">${dealerTotal}${S.fav === 'dealer' && !S.dealing ? ' <span class="fav-tag">Favourite</span>' : ''}</div>
      </div>
    </div>
    <div class="chip-tray" aria-hidden="true"></div><div class="discard-box" aria-hidden="true"></div>
    ${arcTextHTML(st, box)}
    <div class="mid-band" style="--lane-y:${dealerH + 4}px;--lane-w:${laneW}px">
      ${frozenHTML(st)}
      ${S.room ? '' : `<div class="status">${esc(statusText(st))} <span id="timer" class="timer" hidden></span></div>
      ${dealMeInHTML(st)}`}
    </div>
    <div class="seats">${order.map((i, pos) => seatHTML(st, st.seats[i], i, spots[pos].mode === 'focus', spots[pos])).join('')}</div>
    ${zoomSeat !== null ? `<div class="seat-zoom" data-seat-zoom style="--hw:${box.phone ? 256 : 420}px;--hh:${SEAT_BOX.desk.fhh}px">${seatHTML(st, st.seats[zoomSeat], zoomSeat, false, { mode: 'zoom', hw: box.phone ? 256 : 420, hh: SEAT_BOX.desk.fhh }).replace(/ id="[^"]*"/g, '')}<button class="btn small" data-seat-zoom-close>Close</button></div>` : ''}`;
}

// Live chances for every hand once the first two cards are out, and the favourite at the table.
function computeOdds(st) {
  S.odds = {};
  S.fav = null;
  if (!(st.phase === 'insurance' || st.phase === 'playing')) return;
  const up = st.dealer.cards[0];
  if (!up || up.hidden) return;
  let best = -1;
  st.seats.forEach((seat, i) => {
    if (!seat) return;
    seat.hands.forEach((h, j) => {
      if (h.cards.length < 2 || h.surrendered) return;
      const o = handOdds(h.cards, up, { dealerHitsSoft17: st.settings.dealerHitsSoft17, done: h.done || h.doubled, fromSplit: h.fromSplit });
      if (!o) return;
      S.odds[`${i}-${j}`] = o;
      if (o.win > best) { best = o.win; S.fav = `${i}-${j}`; }
    });
  });
  // The dealer is the favourite if no hand is more likely to win than to lose.
  const any = Object.values(S.odds);
  if (any.length && any.every((o) => o.win < o.lose)) S.fav = 'dealer';
}
function oddsHTML(key) {
  const o = S.odds?.[key];
  if (!o || S.dealing) return '';
  const pct = (x) => Math.round(x * 100) + '%';
  return `<div class="odds ${S.fav === key ? 'fav' : ''}" title="Win ${pct(o.win)}, push ${pct(o.push)}, lose ${pct(o.lose)}">${S.fav === key ? '<span class="fav-tag">Favourite</span>' : ''}<b>${pct(o.win)}</b><small>win</small><span class="odds-sep">·</span><small>push ${pct(o.push)}</small></div>`;
}

// No player is the dealer: either wait for one, or the host deals with the house and frozen balances.
function frozenHTML(st) {
  if (st.banker) return '';
  const host = S.role === 'host';
  const between = st.phase === 'betting' || st.phase === 'settled';
  if (st.frozen) {
    return `<div class="frozen-banner on"><b>Frozen ledger</b> Practice with the house dealer. Chips and buy-ins go back when it stops.
      ${host && between ? '<button class="btn small" data-act="h-frozen" data-on="0">Stop</button>' : ''}</div>`;
  }
  return `<div class="frozen-banner wait"><b>Waiting for a dealer</b> ${host
    ? 'Someone has to ask to be the dealer, or you can deal anyway with the house as dealer. Those hands are not counted in the ledger.'
    : 'Ask to be the dealer, or wait for the host to deal with the ledger frozen.'}
    ${host ? '<button class="btn small gold" data-act="h-frozen" data-on="1">Deal with the ledger frozen</button>' : ''}</div>`;
}

// Big "Deal me in" button on the table once you have a bet down.
function dealMeInHTML(st) {
  const { me, seat, isBanker } = myInfo(st);
  // Only for a fresh bet, and only when the table can deal: with no dealer, or a dealer whose chips
  // do not cover the bets, the line above already says what the table is waiting for.
  // A new hand with nothing down yet: the big middle button puts last hand's whole bet back, side bets included.
  if (!isBanker && seat && st.phase === 'betting' && st.rebet && !(me?.seats || [me?.seat]).some((i) => st.seats[i] && betTotal(st.seats[i].bet))) return `<div class="deal-me-in"><button class="deal-btn rebet-btn" data-act="rebet" title="The same bet as last hand, side bets included (B)">↻ Rebet ${money(rebetSum(st))}${rebetHands(st)}</button></div>`;
  if (isBanker || !seat || st.phase !== 'betting' || !seat.bet.main || st.noDealer || st.bankShort) return '';
  if (seat.ready) {
    const slow = st.seats.filter((s) => s && !s.ready && s.connected !== false && s.playerId !== S.myId).map((s) => s.name);
    return `<div class="deal-me-in waiting"><span>Waiting for ${slow.length ? esc(slow.slice(0, 2).join(' and ')) + (slow.length > 2 ? ' and others' : '') : 'the deal'}</span><button class="btn small" data-act="ready">Not ready</button></div>`;
  }
  if (seat.bet.main < st.settings.minBet) return `<div class="deal-me-in waiting"><span class="under-min">Table minimum ${money(st.settings.minBet)}. Add ${money(st.settings.minBet - seat.bet.main)} more to be dealt in.</span></div>`;
  // One press deals in every seat of mine that has a bet of the minimum or more.
  const open = (me?.seats || []).filter((i) => st.seats[i] && !st.seats[i].out && !st.seats[i].ready && st.seats[i].bet.main >= st.settings.minBet).length;
  return `<div class="deal-me-in"><button class="deal-btn" data-act="ready" ${open > 1 ? 'title="Deals in all your seats that have a bet"' : ''}>Deal me in${open > 1 ? ` (${open} hands)` : ''}</button></div>`;
}

// Table writing that follows the curve of the table, like a casino felt: three arcs around the same
// point as the seats, between the dealer and the betting circles, the insurance line as a band.
const ARC_Y = [262, 281, 289]; // lowest point of the two lines of lettering and of the rule under them, in felt pixels from the top
function arcTextHTML(st, box) {
  const s = st.settings;
  const bj = s.blackjackPays === 1.5 ? '3 TO 2' : s.blackjackPays + ' TO 1';
  const rules = `DEALER MUST DRAW TO 16 AND ${s.dealerHitsSoft17 ? 'HIT SOFT 17' : 'STAND ON ALL 17s'}`;
  const ins = `INSURANCE PAYS 2 TO 1 · ${isStrip(s) ? 'LAS VEGAS STRIP RULES' : 'HOUSE RULES'}`;
  const label = `Blackjack pays ${bj}. ${rules}. Insurance pays 2 to 1.`;
  if (!box || box.phone) {
    return `<svg class="arc-svg" viewBox="0 0 1000 240" aria-label="${label}">
    <defs>
      <path id="arc1" d="M 140 0 A 600 600 0 0 0 860 0" />
      <path id="arc2" d="M 80 16 A 650 650 0 0 0 920 16" />
      <path id="arc3" d="M 40 48 A 700 700 0 0 0 960 48" />
    </defs>
    <text class="arc-big"><textPath href="#arc1" startOffset="50%" text-anchor="middle">BLACKJACK PAYS ${bj}</textPath></text>
    <text class="arc-mid"><textPath href="#arc2" startOffset="50%" text-anchor="middle">${rules}</textPath></text>
    <text class="arc-small"><textPath href="#arc3" startOffset="50%" text-anchor="middle">${ins}</textPath></text>
  </svg>`;
  }
  const { W, H } = box, cx = W / 2;
  // Two lines only, on a flat curve in the gap between the status line and your own cards, so nothing lies on the lettering.
  const line2 = `${s.dealerHitsSoft17 ? 'DEALER HITS SOFT 17' : 'DEALER STANDS ON ALL 17s'} · INSURANCE PAYS 2 TO 1`;
  const flat = (base, half) => { const R = 760, y = (base - R + Math.sqrt(R * R - half * half)).toFixed(1); return `M ${cx - half} ${y} A ${R} ${R} 0 0 0 ${cx + half} ${y}`; };
  return `<svg class="arc-svg arc-full" viewBox="0 0 ${W} ${H}" aria-label="${label}">
    <defs><path id="arc1" d="${flat(ARC_Y[0], 300)}" /><path id="arc2" d="${flat(ARC_Y[1], 300)}" /></defs>
    <path class="arc-line" d="${flat(ARC_Y[2], 232)}" />
    <text class="arc-big"><textPath href="#arc1" startOffset="50%" text-anchor="middle">BLACKJACK PAYS ${bj}</textPath></text>
    <text class="arc-mid"><textPath href="#arc2" startOffset="50%" text-anchor="middle">${line2}</textPath></text>
  </svg>`;
}

// The hands of one seat inside a box of fixed size, so nothing around them ever moves. One to four
// hands sit side by side with a gap (two rows when that keeps the cards larger), first hand on the
// right. The card width shrinks until every hand fits. Room for a doubled card is always kept above.
function handsHTML(st, s, i, mode, W, H) {
  let B = HAND_BOX[mode];
  const n = s.hands.length;
  if (!n) return mode === 'seat' && s.playerId === S.myId ? `<div class="hands" style="height:${Math.round(H * 1.45)}px"></div>` : '<div class="hands"></div>';
  const turn = st.turn && st.turn.seat === i && !(S.dealing && S.dealMany);
  // A small seat with three or four hands has no room for cards: it shows each hand's total, and a tap shows the cards large.
  if (mode === 'mini' && n > 2) {
    return `<div class="hands totals-only">${s.hands.map((h, j) => `<div class="hand ${turn && st.turn.hand === j ? 'active' : ''}"><span class="total ${h.total > 21 ? 'bust' : ''} ${h.result ? 'r-' + h.result.toLowerCase() : ''}">${h.total}${h.doubled ? ' ×2' : ''}</span></div>`).join('')}<small>Tap to see the cards</small></div>`;
  }
  const units = s.hands.map((h) => fanUnits(h.cards.length, h.doubled));
  let best = null;
  // A seat on the arc with three or four hands: two rows, and the box grows toward the dealer (the
  // middle of the table is free), so the cards stay as large as with two hands.
  const tall = mode === 'seat' && n > 2;
  // My own seats have the same circle as everyone's, but their cards may reach further toward the
  // dealer and be larger, as far as the width of the seat's lane allows.
  const mineBig = mode === 'seat' && s.playerId === S.myId;
  const B0 = B;
  if (mineBig) { B = { ...B0, cwMax: 54 }; H = Math.round(H * 1.45); }
  if (tall) H = H * 2 + 2;
  for (const rows of tall ? (n > 6 ? [2, 3] : [2]) : n > 2 ? [1, 2] : [1]) {
    const per = Math.ceil(n / rows), meta = rows > 1 ? B.meta1 : B.meta;
    let cw = Math.min(B.cwMax, (H / rows - meta - 2) / 2.26);
    for (let r = 0; r < rows; r++) {
      const u = units.slice(r * per, (r + 1) * per);
      if (!u.length) continue;
      const room = W - (u.length - 1) * B.gap;
      while (cw > 10 && u.reduce((a, x) => a + Math.max(x * cw, B.minW), 0) > room) cw -= 0.5;
    }
    if (!best || cw > best.cw + 1) best = { rows, per, cw, meta };
  }
  const { rows, per, meta } = best;
  const cw = Math.floor(best.cw * 2) / 2, ch = cw * 1.4;
  const split = n > 1;
  const hand = (h, j) => {
    const active = turn && st.turn.hand === j;
    // The hand in play lifts off the felt. The hand that was just in play comes back down once.
    const lk = `${st.round}:${i}:${j}`;
    if (active && S.liftKey !== lk) { S.dropKey = S.liftKey; S.dropAt = Date.now(); S.liftKey = lk; S.liftAt = Date.now(); }
    const fresh = active && Date.now() - S.liftAt < 500, dropping = !active && S.dropKey === lk && Date.now() - S.dropAt < 500;
    const k = h.doubled ? h.cards.length - 1 : h.cards.length;
    const fanW = fanUnits(h.cards.length, h.doubled) * cw;
    const w = Math.max(fanW, B.minW);
    const step = h.doubled || k < 2 ? 0 : Math.min(0.14 * cw, (0.86 * cw) / (k - 1));
    const x0 = (fanW - (1 + (k - 1) * FAN_DX) * cw) / 2;
    const cardsHtml = h.cards.map((c, q) => {
      const html = cardHTML(c, false, `${st.round}-${i}-${j}-${q}`, [q + j * 10, i]);
      // A doubled hand's last card is dealt sideways across the top, covering about a tenth of the cards under it.
      if (h.doubled && q === h.cards.length - 1) return `<div class="sideways" style="bottom:${(ch * 0.9).toFixed(1)}px">${html}</div>`;
      return placed(html, `left:${(x0 + q * FAN_DX * cw).toFixed(1)}px;bottom:${(q * step).toFixed(1)}px`);
    }).join('');
    const narrow = w < 70;
    const busy = inFlight(h.cards.map((c, q) => `${st.round}-${i}-${j}-${q}`));
    const res = S.dealing ? '' : h.result ? `<span class="result ${h.result.toLowerCase()}">${narrow || mode === 'mini' ? shortResult(h) : handResultText(h)}</span>` : (h.blackjack ? `<span class="result blackjack">${narrow ? 'BJ' : 'Blackjack'}</span>` : '');
    const total = h.cards.length && !busy ? `<span class="total ${h.total > 21 ? 'bust' : ''}">${h.total > 21 ? 'Bust ' + h.total : h.total + (h.soft && h.total < 21 ? ' soft' : '')}</span>` : '';
    const bet = split ? `<span class="hand-bet" title="Bet on this hand"><span class="chipv hb-chip ${chipClass(h.bet)}"></span><span class="hb-amt">${money(h.bet)}</span></span>` : (h.doubled ? `<span class="dbl-tag">Doubled ${money(h.bet)}</span>` : '');
    const line2 = mode === 'mini' || rows > 1 ? (split && mode !== 'mini' ? bet : '') : `${bet}${mode === 'seat' && (split || h.doubled) ? '' : oddsHTML(`${i}-${j}`)}`;
    return `<div class="hand ${active ? 'active' + (fresh ? ' lift' : '') : ''} ${dropping ? 'drop' : ''} ${split ? 'split' : ''} ${h.doubled ? 'dbl' : ''} ${narrow ? 'narrow' : ''}" style="--cw:${cw}px;width:${w.toFixed(1)}px">
      <div class="cards fan" style="width:${fanW.toFixed(1)}px;height:${(cw * 2.26).toFixed(1)}px">${cardsHtml}</div>
      <div class="meta" style="height:${meta}px"><div class="meta-1">${total}${res}</div>${line2 ? `<div class="meta-2">${line2}</div>` : ''}</div>
    </div>`;
  };
  const rowsHtml = Array.from({ length: rows }, (_, r) => `<div class="hrow">${s.hands.map((h, j) => (Math.floor(j / per) === r ? hand(h, j) : '')).join('')}</div>`).join('');
  return `<div class="hands ${rows > 1 ? 'two-rows' : ''}" ${tall || mineBig ? `style="height:${H}px"` : ''}>${rowsHtml}</div>`;
}

// One seat on the felt. `spot` says where it goes and how it is drawn: 'focus' is your own big seat,
// 'seat' a normal seat, 'mini' the small card used on phones, 'zoom' the large view of a mini seat.
function seatHTML(st, s, i, focus, spot) {
  const { me, isBanker } = myInfo(st);
  const mode = spot.mode || (focus ? 'focus' : 'seat');
  const mini = mode === 'mini';
  // A seat far round the table is turned a long way. Its name plate is turned part of the way back (--pr) so the name still reads.
  const lean0 = Number(spot.r) || 0;
  const place = spot.x === undefined ? '' : `style="${spotStyle(spot)}${Math.abs(lean0) > 28 ? `;--pr:${(Math.sign(lean0) * 28 - lean0).toFixed(1)}deg` : ''}"`;
  const cls = `${mode === 'zoom' ? 'zoomed' : mode === 'seat' ? 'std' : mode}${spot.phone ? ' pfocus' : ''}`;
  if (!s) {
    const canSit = me && !isBanker;
    const more = canSit && me.seat !== null;
    return `<div class="seat empty ${cls}" id="seat-${i}" ${place}>${mini ? '' : `<div class="hands"></div>${spotAreaHTML(st, null, i, false, 0)}`}${canSit ? `<button class="btn small ${more ? 'add-seat' : ''}" data-act="sit" data-seat="${i}" ${more ? 'data-add="1" title="Play this seat as well. Each seat has its own bet and hand."' : ''}>${st.phase === 'betting' || st.phase === 'settled' ? '<span class="sit-float"><span>Sit<i>▼</i></span></span>' : ''}${more ? '+ Seat' : 'Sit here'}</button>` : `<span class="seat-no">Seat ${i + 1}</span>`}</div>`;
  }
  const isMe = s.playerId === S.myId;
  // Whose turn it is shows once the deal is finished, not while the first cards are still going round.
  const turn = st.turn && st.turn.seat === i && !(S.dealing && S.dealMany);
  const hands = handsHTML(st, s, i, mini ? 'mini' : spot.phone ? 'pfocus' : mode === 'seat' ? 'seat' : 'focus', spot.hw, spot.hh);
  // What the seat won or lost this round, beside its chips on the name plate.
  const net = st.phase === 'settled' && s.net && s.hands.length && !S.dealing ? ` <i class="net-in ${s.net > 0 ? 'up' : 'down'}">${signed(s.net)}</i>` : '';
  const ready = s.out ? '<span class="ready-tag out-tag">Sitting out</span>' : st.phase === 'betting' && s.ready ? '<span class="ready-tag">Ready</span>' : '';
  const mineN = isMe ? (st.players.find((p) => p.id === S.myId)?.seats || []).length : 0;
  const inHand = isMe && mineN > 1 && st.players.find((p) => p.id === S.myId)?.seat === i;
  const shownBet = s.hands.length > 1 ? s.bet.main : s.hands.length ? s.hands[0].bet : s.bet.main;
  const hot = s.streak >= 3 ? `hot ${s.streak >= 5 ? 'blazing' : ''}` : '';
  let bets;
  if (mini) {
    const side = Object.values(s.bet.sides || {}).reduce((a, b) => a + b, 0);
    bets = `<div class="mini-bet"><span class="mb-chip" id="spot-${i}">${shownBet ? `<span class="chipv hb-chip ${chipClass(shownBet)}"></span>` : '<span class="mini-ring"></span>'}</span>${shownBet ? `<b>${money(shownBet)}</b>` : ''}${side ? `<small title="Side bets">+${money(side)}</small>` : ''}${s.insurance ? '<small>Ins</small>' : ''}</div>`;
  } else bets = spotAreaHTML(st, s, i, isMe, shownBet);
  const many = mode === 'seat' && s.hands.length > 2;
  return `<div class="seat ${cls} ${many ? 'many' : ''} ${hot} ${isMe ? 'me' : ''} ${turn ? 'turn' : ''} ${inHand ? 'inhand' : ''} ${s.out ? 'out' : ''} ${s.connected ? '' : 'away'}" id="seat-${i}" ${place} ${mini || many ? 'title="Tap to see this seat large"' : ''}>
    ${hands}
    ${bets}
    <div class="who" ${isMe ? '' : `data-throw-at="${s.playerId}" title="Tap to throw something at ${esc(s.name)}"`}><span class="name">${s.streak >= 3 ? `<span class="fire">🔥</span>${s.streak} ` : ''}${s.playerId === st.hostId ? '♛ ' : ''}${esc(s.name)}${isMe ? ' (you)' : ''}${s.connected ? '' : ' (away)'}</span><span class="chips">${money(s.chips)}${net}</span>${ready}${isMe && st.banker?.id !== S.myId ? `<button class="seat-out-tag ${s.out ? 'on' : ''}" data-act="sit-out" data-seat="${i}" data-on="${s.out ? 0 : 1}" title="${s.out ? 'Play this seat again from the next round' : 'Skip rounds on this seat. You keep the seat, and a hand in play is still finished.'}">${s.out ? 'Sit in' : 'Sit out'}</button>` : ''}</div>
  </div>`;
}

// What each of your side bets did this round, listed in the tray so it never covers the table.
function sideResultsHTML(st) {
  const { seat } = myInfo(st);
  // When the round is over the tray's own summary lists them, so they are not shown twice.
  if (!seat || !seat.sideResults?.length || S.dealing || st.phase === 'settled') return '';
  return `<div class="side-results"><div class="sr-title">Side bets</div>${seat.sideResults.map((r) =>
    `<div class="side-res ${r.win ? 'win' : ''}" title="${esc(r.name)}: ${esc(r.label)}"><span><b>${esc(r.name)}</b> ${esc(r.label)}</span><b>${sideAmount(r)}</b></div>`).join('')}</div>`;
}
// The same in the fewest letters, for a narrow hand: "+50", "-50", "Push".
function shortResult(h) { return signed(handNet(h)) || h.result; }
// What one hand won or lost, shown on the hand when the round is settled: "Win +50", "Push", "Lose -50".
function handNet(h) { return (h.paid || 0) - h.bet; }
function signed(n) { return n > 0 ? '+' + money(n) : n < 0 ? '-' + money(-n) : ''; }
function handResultText(h) { return h.result + (handNet(h) ? ' ' + signed(handNet(h)) : ''); }
function handResultHTML(h) {
  if (!h.result) return h.blackjack ? '<span class="result blackjack">Blackjack</span>' : '';
  return `<span class="result ${h.result.toLowerCase()}">${handResultText(h)}</span>`;
}
// What a side bet won or lost. A bet that came back (the friend was not dealt in) shows as returned.
function sideAmount(r) { return r.win ? '+' + money(r.pay - r.stake) : r.push ? 'Back ' + money(r.pay) : '-' + money(r.stake); }

// Side bets this table offers (the host picks them in the settings).
function sideKeys(st) { return (st?.settings?.sideBets || SIDE_KEYS).filter((k) => SIDE_BETS[k]); }

// The main betting circle with the side bets in a ring around it.
function spotAreaHTML(st, s, i, isMe, mainAmt) {
  const canBet = isMe && st.phase === 'betting';
  // Once the round is over the label on the circle says what this seat won or lost, side bets included.
  const settledNet = st.phase === 'settled' && s?.hands?.length && !S.dealing && typeof s.net === 'number' ? s.net : null;
  const keys = sideKeys(st).filter((k) => !SIDE_BETS[k].pvp); // bets on your own cards only; the PvP bet has its own button
  const n = Math.max(1, keys.length);
  // Side bets are slices of one ring around the main bet.
  const R1 = 47, R2 = 79, GAP = 1.6;
  const pt = (r, deg) => { const a = (deg * Math.PI) / 180; return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`; };
  const floats = []; // a side bet that won shows its gain on a tag standing over the chips, which cover the ring
  const slices = keys.map((k, idx) => {
    const amt = s?.bet.sides[k] || 0;
    const res = S.dealing ? null : s?.sideResults.find((r) => r.key === k);
    const a0 = -90 + (360 / n) * idx + GAP / 2, a1 = -90 + (360 / n) * (idx + 1) - GAP / 2, mid = (a0 + a1) / 2;
    const d = `M ${pt(R2, a0)} A ${R2} ${R2} 0 0 1 ${pt(R2, a1)} L ${pt(R1, a1)} A ${R1} ${R1} 0 0 0 ${pt(R1, a0)} Z`;
    const [lx, ly] = pt((R1 + R2) / 2, mid).split(' ');
    const sb = SIDE_BETS[k];
    if (res?.win) floats.push(`<span class="side-float" style="left:${(((Number(lx) + 82) / 164) * 100).toFixed(1)}%;top:${(((Number(ly) + 82) / 164) * 100).toFixed(1)}%">${sb.icon || ''} +${money(res.pay - res.stake)}</span>`);
    const friend = k === 'friendBust' && amt && s?.bet.target != null ? st.seats[s.bet.target]?.name : null;
    const big = n <= 5;
    const label = amt || res
      ? `<text x="${lx}" y="${Number(ly) - 4}" class="ring-amt ${res ? (res.win ? 'up' : 'down') : ''}">${res ? (res.win ? '+' + money(res.pay - res.stake) : '-' + money(res.stake)) : money(amt)}</text><text x="${lx}" y="${Number(ly) + 8}" class="ring-name small">${sb.icon || ''} ${esc(friend ? '→ ' + friend.slice(0, 7) : sb.short)}</text>`
      : `<text x="${lx}" y="${Number(ly) - (big ? 3 : 0)}" class="ring-icon ${big ? '' : 'sm'}">${sb.icon || ''}</text><text x="${lx}" y="${Number(ly) + (big ? 10 : 9)}" class="ring-name ${big ? '' : 'small'}">${sb.short}</text>`;
    return `<g class="ring-slice ${canBet ? 'live' : ''} ${amt ? 'on' : ''} ${res ? (res.win ? 'won' : 'lost') : ''}" ${canBet ? `data-act="side-spot" data-k="${k}"` : ''} id="sb-${i}-${k}"><title>${esc(SIDE_BETS[k].name)}: ${esc(SIDE_BETS[k].about)}</title><path d="${d}" />${label}</g>`;
  }).join('');
  const sides = `<svg class="bet-ring" viewBox="-82 -82 164 164">${slices}</svg>`;
  const ins = s?.insurance ? `<span class="ins-tag">Insurance ${money(s.insurance)}</span>` : '';
  return `<div class="spot-area ${canBet ? 'live' : ''}">
    ${sides}${floats.join('')}
    <div class="spot" id="spot-${i}" ${canBet ? `data-act="main-spot" title="${S.chip ? `Tap to add a ${money(S.chip)} chip` : 'Tap to take your last chip off. Pick a chip below to add instead.'}"` : ''}>${stackHTML(mainAmt)}${settledNet !== null ? `<span class="spot-amt spot-net ${settledNet > 0 ? 'up' : settledNet < 0 ? 'down' : ''}" title="This seat's result for the round, side bets included">${settledNet > 0 ? 'Won +' + money(settledNet) : settledNet < 0 ? 'Lost ' + money(-settledNet) : 'Even'}</span>` : `<span class="spot-amt">${mainAmt ? money(mainAmt) : ''}</span>`}</div>
    ${ins}
    ${pvpTagsHTML(st, i)}
  </div>`;
}
// How much of a chip can still be bet: never more than the chips left, the table maximum for the main
// bet, or the side bet maximum. Returns 0 (with a short message) when nothing more fits.
function fitBet(v, where) {
  const st = S.state, me = st.players.find((p) => p.id === S.myId), seat = st.seats[me.seat];
  const left = me.chips - betTotal(seat.bet);
  const cap = where === 'main' ? (st.settings.maxBet ?? Infinity) - seat.bet.main : (st.settings.maxSideBet ?? Infinity) - (seat.bet.sides[where] || 0);
  const put = Math.max(0, Math.min(v, left, cap));
  if (!put) toast(left <= 0 ? 'All your chips are already bet.' : 'That bet is at the table maximum.');
  else if (put < v) toast(`Bet ${money(put)}: that is all that fits.`);
  return put;
}
// PvP bets shown on the seat they are about, so everyone sees who bet on whom.
function pvpTagsHTML(st, i) {
  const tags = st.seats.map((o, j) => (o && j !== i && o.bet?.sides?.friendBust && o.bet.target === i ? `<span class="pvp-tag" title="A bet between players. It pays ${5} to 1 if this hand busts.">⚔️ ${esc(o.name)}: ${money(o.bet.sides.friendBust)} on a bust</span>` : '')).join('');
  const res = st.seats[i]?.sideResults?.find((r) => r.key === 'friendBust');
  const own = st.seats[i]?.bet?.sides?.friendBust && !res ? `<span class="pvp-tag mine">⚔️ ${money(st.seats[i].bet.sides.friendBust)} on ${esc(st.seats[st.seats[i].bet.target]?.name || 'a friend')} busting</span>` : '';
  return tags || own ? `<div class="pvp-tags">${own}${tags}</div>` : '';
}
function pvpBtnHTML(st, seat) {
  if (!sideKeys(st).includes('friendBust')) return '';
  const amt = seat.bet.sides.friendBust || 0, who = amt ? st.seats[seat.bet.target]?.name : null;
  return `<span class="pvp-ctl"><button class="btn pvp-btn" data-act="pvp" title="A bet between players, not on your cards. Pays 5 to 1 if the friend you pick busts.">⚔️ ${amt ? `PvP: ${money(amt)} on ${esc(who || 'a friend')} busting (tap to add)` : 'PvP bet: a friend busts'}</button>${amt ? '<button class="btn pvp-x" data-act="pvp-clear" title="Take the PvP bet off">✕</button>' : ''}</span>`;
}

// The tray in the middle under the table: chips while betting, play buttons on your turn.
function hintsOn() { return safeGet('bj-hints') !== '0'; }
// Count training is off unless the host switches it on for the whole table in the settings.
function trainingOn() { return !!S.state?.settings?.countTraining; }

// Count training: running count, true count and how often your moves match basic strategy.
function countBadgeHTML(st) {
  if (!trainingOn() || !st.count) return '';
  const rc = st.count.running;
  const decks = Math.max(0.25, st.count.decksLeft);
  const tc = rc / decks;
  const csm = st.settings.decks === 'csm';
  const tr = S.train;
  const pct = tr.total ? Math.round((100 * tr.right) / tr.total) : null;
  const sign = (n) => (n > 0 ? '+' : '') + n;
  return `<div class="count-badge">
    <div><small>Running</small><b>${sign(rc)}</b></div>
    <div><small>True</small><b>${sign(Math.round(tc * 10) / 10)}</b></div>
    <div><small>Decks left</small><b>${decks.toFixed(1)}</b></div>
    <div><small>Strategy</small><b>${tr.total ? `${tr.right}/${tr.total}` : '-'}</b>${pct !== null ? `<small>${pct}%</small>` : ''}</div>
    ${csm ? '<div class="hint">Randomized shoe: the count resets every round.</div>' : ''}
  </div>`;
}

function coach(text, good) {
  let el = $('#coach');
  if (!el) { el = document.createElement('div'); el.id = 'coach'; document.body.appendChild(el); }
  el.className = 'coach ' + (good ? 'good' : 'bad');
  el.innerHTML = text;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.08 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 4200, fill: 'forwards' });
}

// The basic strategy chart, drawn from the same rules the hints use.
function openChart() {
  const st = S.state;
  const c = strategyChart(st?.settings || {});
  const cls = { H: 'h', S: 's', D: 'd', Ds: 'd', P: 'p', R: 'r', Rs: 'r', Rp: 'r' };
  const table = (title, rows) => `<div class="chart-block"><div class="chart-title">${title}</div><table class="chart">
    <tr><th></th>${c.up.map((u) => `<th>${u}</th>`).join('')}</tr>
    ${rows.map((r) => `<tr><th>${r.label}</th>${r.cells.map((x) => `<td class="${cls[x.code]}">${x.code}</td>`).join('')}</tr>`).join('')}
  </table></div>`;
  let pop = $('#chart-pop');
  if (!pop) { pop = document.createElement('div'); pop.id = 'chart-pop'; pop.className = 'chart-pop'; document.body.appendChild(pop); }
  pop.innerHTML = `<div class="chart-card">
    <div class="chart-head"><b>Basic strategy</b><span class="hint">${st?.settings?.dealerHitsSoft17 ? 'Dealer hits soft 17' : 'Dealer stands on all 17s'}, double after split, late surrender, 4 to 8 decks. Top row is the dealer's up card.</span><button class="btn small" data-chart="close">Close</button></div>
    <div class="chart-grid">${table('Hard totals', c.hard)}${table('Soft totals', c.soft)}${table('Pairs', c.pairs)}</div>
    <div class="chart-key"><span class="h">H</span> Hit <span class="s">S</span> Stand <span class="d">D</span> Double, or hit if you can't <span class="d">Ds</span> Double, or stand if you can't <span class="p">P</span> Split <span class="r">R</span> Surrender, or hit if you can't</div>
  </div>`;
  pop.hidden = false;
  pop.onclick = (e) => { if (e.target === pop || e.target.closest('[data-chart=close]')) pop.hidden = true; };
}

// For someone who is watching: ask a seated player for their seat.
function askOutHTML(st) {
  const seen = new Set(), list = [];
  for (const x of st.seats) if (x && x.playerId !== S.myId && !seen.has(x.playerId)) { seen.add(x.playerId); list.push(x); }
  if (!list.length) return '';
  return `<div class="ask-row"><span class="hint">Ask for a seat:</span>${list.map((x) => `<button class="btn small" data-act="ask-out" data-id="${x.playerId}">${esc(x.name)}</button>`).join('')}</div>`;
}
// Practice only (frozen ledger): the table can bet and play your seats by itself with basic strategy.
// It looks at your cards and the dealer's up card, nothing else. It never uses a count.
const AUTO_SPEEDS = { slow: 2600, normal: 1300, fast: 450 };
// Sit out: one button for each of your own seats, always there, kept off the table so nothing covers it.
// A seat that sits out keeps its place, gets no cards, and nobody waits for it.
function sitOutHTML(st) {
  const me = st.players.find((p) => p.id === S.myId);
  const mine = (me?.seats || []).filter((i) => st.seats[i]);
  if (!mine.length || st.banker?.id === S.myId) return '';
  return mine.map((i) => { const o = st.seats[i].out; return `<button class="seat-out ${o ? 'on' : ''}" data-act="sit-out" data-seat="${i}" data-on="${o ? 0 : 1}" title="${o ? 'Play this seat again from the next round' : 'Skip rounds on this seat. You keep the seat, and a hand in play is still finished.'}">${mine.length > 1 ? `Seat ${i + 1}: ` : ''}${o ? 'Sit back in' : 'Sit out'}</button>`; }).join('');
}
// ---------- Live chat ----------
// Text chat for everyone at the table, players and watchers. It travels over the table's own
// connection: a guest sends a line to the host, and the host passes it to everyone. Nothing is stored online.
function relayChat(from, msg) {
  const p = S.table?.players[from];
  const text = String(msg.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!p || !text) return;
  S.chatAt ||= {};
  const now = Date.now();
  if (now - (S.chatAt[from] || 0) < 700) return; // at most one line every 0.7 seconds per person
  S.chatAt[from] = now;
  const out = { t: 'chat', id: from, name: String(p.name).slice(0, 16), text, at: now };
  for (const c of Object.values(S.conns || {})) { if (c?.open) { try { c.send(out); } catch {} } }
  gotChat(out);
}
function gotChat(m, old = false) {
  S.chat ||= [];
  S.chat.push({ id: String(m.id || ''), name: String(m.name || 'Someone').slice(0, 16), text: String(m.text || '').slice(0, 200), at: Number(m.at) || Date.now() });
  if (S.chat.length > 100) S.chat.splice(0, S.chat.length - 100);
  if (old) return;
  if (S.chatOpen) drawChat();
  else if (m.id !== S.myId) { S.chatUnread = (S.chatUnread || 0) + 1; chatPeek(S.chat[S.chat.length - 1]); if (S.state) drawSitOut(S.state); }
}
const chatLine = (m) => `<div class="chat-line ${m.id === S.myId ? 'mine' : ''}"><b>${esc(m.name)}</b> ${esc(m.text)}</div>`;
function drawChat() {
  const list = $('#chat-list');
  if (!list) return;
  list.innerHTML = (S.chat || []).map(chatLine).join('') || '<div class="chat-empty">Say hello to the table.</div>';
  list.scrollTop = list.scrollHeight;
}
// A new line while the chat is closed shows for a few seconds beside the chat button, then goes.
function chatPeek(m) {
  let el = $('#chat-peek');
  if (!el || !el.isConnected) { el = document.createElement('div'); el.id = 'chat-peek'; app.appendChild(el); }
  el.innerHTML = chatLine(m);
  el.classList.add('show');
  clearTimeout(S.chatPeekT);
  S.chatPeekT = setTimeout(() => el.classList.remove('show'), 6000);
}
function toggleChat(on = !S.chatOpen) {
  S.chatOpen = !!on;
  if (on) $('#voice-panel')?.remove();
  let el = $('#chat-panel');
  if (!on) { el?.remove(); if (S.state) drawSitOut(S.state); return; }
  if (!el || !el.isConnected) {
    el = document.createElement('div'); el.id = 'chat-panel';
    el.innerHTML = '<div class="chat-head"><b>Table chat</b><button class="chat-x" data-act="chat-close" aria-label="Close chat">✕</button></div><div id="chat-list"></div><form id="chat-form"><input id="chat-input" maxlength="200" autocomplete="off" placeholder="Type a message" /><button class="btn small" type="submit">Send</button></form>';
    app.appendChild(el);
    el.querySelector('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('#chat-input'), text = inp.value.trim();
      if (!text) return;
      send({ t: 'chat', text }); inp.value = ''; inp.focus();
    });
    el.querySelector('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleChat(false); });
  }
  S.chatUnread = 0; $('#chat-peek')?.classList.remove('show');
  drawChat();
  if (S.state) drawSitOut(S.state);
  if (!matchMedia('(max-width: 700px)').matches) $('#chat-input')?.focus();
}

// ---------- Voice chat ----------
// Sound goes straight from each person's browser to every other person in voice, over the same kind of
// link the table already uses. The host only keeps the list of who is in voice. Joining lets you
// listen; your microphone stays off until you turn it on, and the browser asks for it only then.
const V = { on: false, mic: false, out: null, ctx: null, micTrack: null, calls: {}, list: [], muted: {}, peer: null, timer: null };
// Host side: who is in voice.
function voiceList() {
  const t = S.table;
  return Object.entries(S.voice || {}).filter(([id]) => t?.players[id]).map(([id, v]) => ({ id, name: String(t.players[id].name).slice(0, 16), peer: v.peer, mic: !!v.mic }));
}
function voiceCast() {
  const out = { t: 'voice-list', list: voiceList() };
  for (const c of Object.values(S.conns || {})) { if (c?.open) { try { c.send(out); } catch {} } }
  gotVoiceList(out.list);
}
function voiceSet(id, peer, on, mic) {
  S.voice ||= {};
  if (!S.table?.players[id] || !peer) return;
  if (on) { if (Object.keys(S.voice).length >= 12 && !S.voice[id]) { sayTo(id, 'Voice is full (12 people).'); return; } S.voice[id] = { peer: String(peer), mic }; }
  else delete S.voice[id];
  voiceCast();
}
// Everyone: keep one sound link to each other person in voice. Of two people, the one whose link name sorts first makes the call.
function gotVoiceList(list) {
  V.list = Array.isArray(list) ? list.slice(0, 12).map((m) => ({ id: String(m.id), name: String(m.name || '').slice(0, 16), peer: String(m.peer), mic: !!m.mic })) : [];
  if (V.on) syncCalls();
  drawVoice();
  if (S.state) drawSitOut(S.state);
}
function syncCalls() {
  const mine = S.peer?.id;
  if (!mine || !V.out) return;
  const want = new Set(V.list.filter((m) => m.id !== S.myId).map((m) => m.peer));
  for (const [p, c] of Object.entries(V.calls)) if (!want.has(p)) { try { c.close(); } catch {} dropCall(c); }
  for (const p of want) if (!V.calls[p] && mine < p) { try { wireCall(S.peer.call(p, V.out)); } catch {} }
}
function dropCall(c) { if (V.calls[c.peer] === c) delete V.calls[c.peer]; if (c._audio) { c._audio.srcObject = null; c._audio.remove(); c._audio = null; } }
function wireCall(c) {
  if (!c) return;
  const old = V.calls[c.peer];
  if (old && old !== c) { try { old.close(); } catch {} dropCall(old); }
  V.calls[c.peer] = c;
  c.on('stream', (stream) => {
    if (!c._audio) { c._audio = document.createElement('audio'); c._audio.autoplay = true; c._audio.style.display = 'none'; document.body.appendChild(c._audio); }
    c._audio.srcObject = stream;
    applyMutes();
    c._audio.play?.().catch(() => {});
  });
  c.on('close', () => dropCall(c));
  c.on('error', () => dropCall(c));
}
function applyMutes() {
  for (const c of Object.values(V.calls)) { const m = V.list.find((x) => x.peer === c.peer); if (c._audio) c._audio.muted = !!(m && V.muted[m.id]); }
}
function wireVoicePeer() {
  const peer = S.peer;
  if (!peer || peer._voice) return;
  peer._voice = true;
  peer.on('call', (c) => { if (!V.on || !V.out || !V.list.some((m) => m.peer === c.peer)) { try { c.close(); } catch {} return; } c.answer(V.out); wireCall(c); });
}
function joinVoice() {
  if (V.on) return;
  if (!S.peer || typeof RTCPeerConnection === 'undefined') { toast('Voice does not work in this browser.'); return; }
  try {
    // Until the microphone is on, a silent track is sent, so the browser does not ask for the microphone just to listen.
    V.ctx = new (window.AudioContext || window.webkitAudioContext)();
    V.out = V.ctx.createMediaStreamDestination().stream;
  } catch { toast('Voice does not work in this browser.'); return; }
  V.on = true; V.mic = false; V.peer = S.peer;
  wireVoicePeer();
  send({ t: 'voice', on: true, mic: false });
  // The table can change hands or the link can drop. Every few seconds, make sure the table still lists me and my links are up.
  clearInterval(V.timer);
  V.timer = setInterval(() => {
    if (!V.on) return;
    if (V.peer !== S.peer) { for (const c of Object.values(V.calls)) { try { c.close(); } catch {} dropCall(c); } V.peer = S.peer; wireVoicePeer(); }
    const me = V.list.find((m) => m.id === S.myId);
    if (!me || me.peer !== S.peer?.id) { if (S.role === 'host' || S.conn?.open) send({ t: 'voice', on: true, mic: V.mic }); }
    else syncCalls();
  }, 4000);
  drawVoice(); if (S.state) drawSitOut(S.state);
}
function leaveVoice() {
  if (!V.on) return;
  V.on = false; V.mic = false;
  clearInterval(V.timer);
  for (const c of Object.values(V.calls)) { try { c.close(); } catch {} dropCall(c); }
  try { V.micTrack?.stop(); } catch {}
  try { V.ctx?.close(); } catch {}
  V.micTrack = null; V.out = null; V.ctx = null;
  if (S.role === 'host' || S.conn?.open) send({ t: 'voice', on: false });
  drawVoice(); if (S.state) drawSitOut(S.state);
}
async function setMic(on) {
  if (!V.on) return;
  if (on && !V.micTrack) {
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!V.on) { ms.getTracks().forEach((t) => t.stop()); return; }
      V.micTrack = ms.getAudioTracks()[0];
      V.out = new MediaStream([V.micTrack]);
      for (const c of Object.values(V.calls)) { const sender = c.peerConnection?.getSenders().find((x) => !x.track || x.track.kind === 'audio'); try { await sender?.replaceTrack(V.micTrack); } catch {} }
    } catch { toast('The browser did not allow the microphone. Allow it in the address bar, then try again.'); return; }
  }
  if (V.micTrack) V.micTrack.enabled = on;
  V.mic = on && !!V.micTrack;
  send({ t: 'voice', on: true, mic: V.mic });
  drawVoice(); if (S.state) drawSitOut(S.state);
}
function drawVoice() {
  const el = $('#voice-panel');
  if (!el) return;
  const others = V.list.filter((m) => m.id !== S.myId);
  const row = (m) => `<div class="voice-row"><span>${m.mic ? '🎤' : '🔇'} <b>${esc(m.name)}</b></span>${V.on ? `<button class="btn small ghost" data-act="voice-mute" data-id="${esc(m.id)}">${V.muted[m.id] ? 'Unmute' : 'Mute'}</button>` : ''}</div>`;
  el.querySelector('#voice-body').innerHTML = V.on
    ? `<button class="btn ${V.mic ? '' : 'ghost'} voice-mic" data-act="voice-mic">${V.mic ? '🎤 Your mic is on. Tap to turn it off' : '🔇 Your mic is off. Tap to talk'}</button>
       <div class="voice-list">${others.map(row).join('') || '<div class="chat-empty">Nobody else is in voice yet.</div>'}</div>
       <button class="btn small danger" data-act="voice-leave">Leave voice</button>`
    : `<div class="chat-empty">Talk with the table. You join with your mic off, and the browser asks for the mic only when you turn it on.</div>
       <div class="voice-list">${V.list.map(row).join('') || '<div class="chat-empty">Nobody is in voice yet.</div>'}</div>
       <button class="btn" data-act="voice-join">Join voice</button>`;
}
function toggleVoicePanel(on = !$('#voice-panel')) {
  let el = $('#voice-panel');
  if (!on) { el?.remove(); return; }
  toggleChat(false);
  if (!el) { el = document.createElement('div'); el.id = 'voice-panel'; el.innerHTML = '<div class="chat-head"><b>Voice chat</b><button class="chat-x" data-act="voice-close" aria-label="Close voice">✕</button></div><div id="voice-body"></div>'; app.appendChild(el); }
  drawVoice();
}

function drawSitOut(st) {
  let el = $('#sitout-bar');
  if (el && !el.isConnected) el = null;
  if (!el) { el = document.createElement('div'); el.id = 'sitout-bar'; app.appendChild(el); }
  const h = st ? `<button class="chat-btn ${S.chatOpen ? 'on' : ''}" data-act="chat" title="Chat with everyone at the table">💬 Chat${S.chatUnread ? `<i>${S.chatUnread > 9 ? '9+' : S.chatUnread}</i>` : ''}</button>`
    + `<button class="chat-btn ${V.on ? 'on' : ''}" data-act="voice" title="Voice chat with the table">🎧 Voice${V.list.length ? ` (${V.list.length})` : ''}</button>`
    + (V.on ? `<button class="chat-btn mic-btn ${V.mic ? 'live' : ''}" data-act="voice-mic" title="Turn your microphone on or off">${V.mic ? '🎤 Mic on' : '🔇 Mic off'}</button>` : '') : '';
  if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; }
}
function autoBarHTML(st) {
  const { seat, isBanker } = myInfo(st);
  if (!st.frozen || !seat || isBanker) return '';
  const A = S.auto || {};
  if (!A.on) return '<div class="auto-bar"><button class="seat-tab" data-act="auto" title="Practice: bets and plays your hands by basic strategy. Only while the ledger is frozen.">🤖 Auto play</button></div>';
  return `<div class="auto-bar on"><span title="Basic strategy only. It never counts cards.">🤖 Auto</span>${Object.keys(AUTO_SPEEDS).map((k) => `<button class="seat-tab ${(A.speed || 'normal') === k ? 'on' : ''}" data-act="auto-speed" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}<button class="seat-tab stop" data-act="auto">Stop</button></div>`;
}
function autoStep() {
  const st = S.state, A = S.auto;
  if (!A?.on || !st) return;
  const { me, seat, isBanker } = myInfo(st);
  if (!st.frozen || !seat || isBanker) { A.on = false; clearTimeout(A.timer); A.key = null; if (!st.frozen) toast('Auto play stopped: the ledger is no longer frozen.'); return; }
  const turnMine = st.phase === 'playing' && st.actions?.length && st.turn;
  const hand = turnMine ? st.seats[st.turn.seat].hands[st.turn.hand] : null;
  const key = [st.phase, st.round, me.seat, seat.ready, seat.insuranceDecided, turnMine ? `${st.turn.seat}-${st.turn.hand}-${hand.cards.length}` : '', S.dealing ? 1 : 0].join('|');
  if (A.key === key) return;
  A.key = key;
  clearTimeout(A.timer);
  A.timer = setTimeout(() => {
    A.key = null;
    const now = S.state;
    if (!A.on || !now || !now.frozen) return;
    const { me: m, seat: x } = myInfo(now);
    if (!x) return;
    if (dealingNow()) { autoStep(); return; }
    if (now.phase === 'betting' && !x.ready && !x.out) {
      const min = now.settings.minBet;
      const bet = betTotal(x.bet) && x.bet.main >= min ? x.bet : now.rebet && now.rebet.main >= min ? now.rebet : { main: min, sides: {} };
      const others = (m.seats || []).reduce((a, i) => a + (i === m.seat || !now.seats[i] ? 0 : betTotal(now.seats[i].bet)), 0);
      if (betTotal(bet) + others > m.chips) { A.on = false; toast('Auto play stopped: not enough chips for the next bet.'); render(); return; }
      placeBet(bet, true);
    } else if (now.phase === 'insurance' && x.hands.length && !x.insuranceDecided) send({ t: 'insurance', take: false, seat: m.seat });
    else if (now.phase === 'playing' && now.actions?.length && now.turn) {
      const h = now.seats[now.turn.seat].hands[now.turn.hand];
      const a = bestMove(h.cards, now.dealer.cards[0], now.actions, now.settings) || 'stand';
      send({ t: 'action', a, auto: true });
    }
  }, AUTO_SPEEDS[A.speed || 'normal']);
}
// With two or more seats: one small tab per seat, above the tray. The seat in hand is lit.
function seatTabsHTML(st) {
  const { me } = myInfo(st);
  if (!me || (me.seats || []).length < 2) return '';
  const free = st.phase === 'betting' || st.phase === 'settled';
  return `<div class="seat-tabs">${me.seats.map((i) => { const x = st.seats[i]; const b = x ? betTotal(x.bet) : 0; return `<button class="seat-tab ${i === me.seat ? 'on' : ''}" data-act="pick-seat" data-seat="${i}" ${free ? '' : 'disabled'}>Seat ${i + 1}${free && b ? ` · ${money(b)}${x.ready ? ' ✓' : ''}` : ''}</button>`; }).join('')}</div>`;
}
function trayHTML(st) { const h = trayInner(st); return h ? seatTabsHTML(st) + h : h; }
function trayInner(st) {
  const { me, seat, isBanker } = myInfo(st);
  if (!me) return '';
  const ph = st.phase;
  if (isBanker) {
    if (!(ph === 'betting' || ph === 'settled')) return '';
    return `<div class="tray-msg">${st.banker.chips < 0 ? `You are the dealer and you owe ${money(-st.banker.chips)} chips. Tap your balance to buy in.` : 'You are the dealer. Your chips pay winners and collect losing bets.'}</div>
      <div class="actions dealer-max"><label for="dealer-max">Max bet</label><input id="dealer-max" type="number" inputmode="numeric" min="${st.settings.minBet}" step="1" value="${st.settings.maxBet}" /><label for="dealer-max-side">Max side bet</label><input id="dealer-max-side" type="number" inputmode="numeric" min="0" step="1" value="${st.settings.maxSideBet}" /><button class="btn small" data-act="dealer-max">Set</button><button class="btn" data-act="leave-dealer">Leave dealer seat</button></div>`;
  }
  if (!seat) {
    return `<div class="tray-msg">${S.role === 'host' ? 'You are hosting. Press "Sit here" to play, or "Ask to be dealer" to be the bank.' : 'Press "Sit here" on an empty seat to play, or "Ask to be dealer" to be the bank.'} You have ${money(me.chips)} chips.</div>${askOutHTML(st)}`;
  }
  if (ph === 'settled') {
    // The round is over. Say what it paid; the bets on the table are last round's, not new ones.
    if (S.dealing) return `<div class="tray-msg round-result"><b>${S.dealMany ? 'Dealing the cards' : 'Dealer is playing'}</b></div>`;
    const parts = seat.hands.map((h, j) => `<span class="rr-part ${handNet(h) > 0 ? 'up' : handNet(h) < 0 ? 'down' : ''}">${seat.hands.length > 1 ? `Hand ${j + 1}: ` : ''}${handResultText(h)}</span>`)
      .concat(seat.hands.length ? seat.sideResults.map((r) => `<span class="rr-part ${r.win ? 'up' : r.push ? '' : 'down'}">${esc(r.name)}: ${sideAmount(r)}</span>`) : []);
    // The headline counts all of my seats in this round together.
    const ownIdx = (myInfo(st).me?.seats || []).filter((i) => st.seats[i] && st.seats[i].hands.length);
    const ownS = ownIdx.map((i) => st.seats[i]);
    // Several seats: one line per seat with every hand and side bet of that seat.
    const seatLine = (x, i) => `<div class="rr-seat"><span class="rr-name">Seat ${i + 1} <b class="${x.net > 0 ? 'up' : x.net < 0 ? 'down' : ''}">${x.net ? signed(x.net) : 'even'}</b></span>${x.hands.map((h, j) => `<span class="rr-part ${handNet(h) > 0 ? 'up' : handNet(h) < 0 ? 'down' : ''}">${x.hands.length > 1 ? `Hand ${j + 1}: ` : ''}${handResultText(h)}</span>`).concat(x.sideResults.map((r) => `<span class="rr-part ${r.win ? 'up' : r.push ? '' : 'down'}">${esc(r.name)}: ${sideAmount(r)}</span>`)).join('')}</div>`;
    const breakdown = ownS.length > 1 ? `<div class="rr-all">${ownIdx.map((i) => seatLine(st.seats[i], i)).join('')}</div>` : parts.length ? `<div class="rr-parts">${parts.join('')}</div>` : '';
    const rnet = ownS.length > 1 ? ownS.reduce((a, x) => a + (x.net || 0), 0) : seat.net;
    const many = ownS.length > 1 ? ` on ${ownS.length} hands` : '';
    const head = !seat.hands.length && ownS.length < 2 ? 'You sat this round out' : rnet > 0 ? `You won ${money(rnet)}${many}` : rnet < 0 ? `You lost ${money(-rnet)}${many}` : 'You broke even';
    const queued = S.rebetWhenOpen === st.round;
    const rb = st.rebet ? `<button class="btn gold rebet-btn ${queued ? 'on' : ''}" data-act="rebet" title="Bet the same as last round (B)">${queued ? `✓ Rebet ${money(rebetSum(st))}${rebetHands(st)} goes down when betting opens. Tap to cancel` : `↻ Rebet ${money(rebetSum(st))}${rebetHands(st)}`}</button>` : '';
    return `<div class="tray-msg round-result"><b class="${rnet > 0 ? 'up' : rnet < 0 ? 'down' : ''}">${head}</b>${breakdown}</div>
      <div class="actions">${rb}<span class="hint">Betting opens when the cards are cleared.</span></div>`;
  }
  if (ph === 'betting') {
    const b = seat.bet;
    const s = st.settings;
    const limits = `<small>Table limits</small><span>Bet ${money(s.minBet)} to ${money(s.maxBet)}</span>${sideKeys(st).length ? `<span>Side bets up to ${money(s.maxSideBet)}</span>` : ''}`;
    // With no bet down there is nothing to clear, so that place offers last round's bet again.
    const rebet = st.rebet && !betTotal(b) ? `<button class="btn gold rebet-btn" data-act="rebet" title="Bet the same as last round (B)">↻ Rebet ${money(rebetSum(st))}${rebetHands(st)}</button>` : '';
    return `
      <div class="tray-row">
        <div class="balance limits">${limits}</div>
        <div class="chip-rack">
          <button class="icon-btn" data-act="undo" ${S.undo.length ? '' : 'disabled'} title="Undo your last chip"><span class="ico">↶</span>Undo</button>
          ${CHIPS.map((v) => `<button class="chipv ${chipClass(v)} ${S.chip === v ? 'sel' : ''}" data-act="chip" data-v="${v}" title="Bet ${v}"><span>${v}</span></button>`).join('')}
          <button class="icon-btn" data-act="double-bet" ${b.main ? '' : 'disabled'} title="Double all your bets"><span class="ico">×2</span>Double</button>
        </div>
        <div class="balance"><small>Total bet</small><b>${money(betTotal(b))}</b></div>
      </div>
      <div class="actions">
        ${pvpBtnHTML(st, seat)}
        
        ${sideKeys(st).length ? '<button class="btn" data-act="sides-plus" title="Adds 1 to every side bet on all your hands">+1 all side bets</button>' : ''}
        ${rebet || `<button class="btn" data-act="clear" ${(myInfo(st).me?.seats || []).some((i) => betTotal(st.seats[i]?.bet)) || betTotal(b) ? '' : 'disabled'}>Clear all</button>`}
        <button class="btn danger" data-act="stand-up">${(myInfo(st).me?.seats || []).length > 1 ? `Leave seat ${myInfo(st).me.seat + 1}` : 'Leave seat'}</button>
        ${(myInfo(st).me?.seats || []).length > 1 ? '<button class="btn danger" data-act="stand-up-all">Leave all seats</button>' : ''}
      </div>`;
  }
  if (ph === 'insurance') {
    if (!seat.hands.length) return S.room ? '' : '<div class="tray-msg wait-msg">You are not in this round. You can bet when it ends.</div>';
    if (seat.insuranceDecided) return S.room ? '' : '<div class="tray-msg wait-msg">Waiting for the others to choose on insurance</div>';
    const cost = Math.ceil(seat.bet.main / 2);
    return `<div class="tray-msg">The dealer shows an ace. Insurance costs <b>${money(cost)}</b> and pays 2 to 1 if the dealer has blackjack.</div>
      <div class="actions"><button class="btn primary big" data-act="ins" data-take="1">Take insurance</button><button class="btn big" data-act="ins" data-take="0">No thanks</button></div>`;
  }
  if (ph === 'playing' || ph === 'dealer') {
    // Not your move: one short line says what the table is waiting for.
    if (ph === 'dealer' || !st.actions.length) {
      if (S.room) return ''; // the 3D room says this on its status line
      const who = st.turn && st.seats[st.turn.seat];
      if (ph === 'dealer' || !who) return '<div class="tray-msg wait-msg">Dealer is playing</div>';
      if (who.playerId === S.myId) return '';
      const mine = !seat.hands.length ? 'You are not in this round. You can bet when it ends.' : seat.hands.every((h) => h.done) ? 'Your hand is done.' : 'Your turn is coming.';
      return `<div class="tray-msg wait-msg">${esc(who.name)} is playing. ${mine}</div>`;
    }
    const tiles = {
      surrender: ['⚑', 'Surrender', 'U'], double: ['2×', 'Double', 'D'], hit: ['+', 'Hit', 'H'],
      stand: ['−', 'Stand', 'S'], split: ['⇆', 'Split', 'P'],
    };
    const hand = seat.hands[st.turn.hand];
    const best = hintsOn() && !trainingOn() ? bestMove(hand.cards, st.dealer.cards[0], st.actions, st.settings) : null;
    const { total, soft } = hand;
    return `<div class="decide">
      <div class="decide-title">Make your decision <span class="decide-hand">${soft && total < 21 ? 'soft ' : ''}${total}${seat.hands.length > 1 ? ` · hand ${st.turn.hand + 1} of ${seat.hands.length}` : ''}</span></div>
      <div class="decide-row">${[['surrender', 'double'], ['hit', 'stand'], ['split']].map((grp, gi) => `<div class="decide-grp g${gi}">${grp.map((a) => {
        const ok = st.actions.includes(a);
        const cls = !ok ? '' : best ? (a === best ? 'best' : 'dim') : '';
        const big = a === 'hit' || a === 'stand' ? 'big' : '';
        // Split and double cost one more bet. Say so when the balance is the only thing in the way.
        const isPair = hand.cards.length === 2 && (hand.cards[0].r === hand.cards[1].r || (['10', 'J', 'Q', 'K'].includes(hand.cards[0].r) && ['10', 'J', 'Q', 'K'].includes(hand.cards[1].r)));
        const broke = !ok && me.chips < hand.bet && ((a === 'double' && hand.cards.length === 2) || (a === 'split' && isPair));
        const short = broke ? shortFor(a) : 0;
        return `<button class="move-btn tile ${a} ${big} ${cls} ${short ? 'buy' : broke ? 'broke' : ''}" data-act="play" data-a="${a}" data-key="${tiles[a][2]}" ${ok || short ? '' : 'disabled'} title="${short ? `You are ${money(short)} short. Tap to buy in and ${a}.` : `${tiles[a][1]} (${tiles[a][2]})`}"><span class="sym">${tiles[a][0]}</span><span class="lbl">${short ? 'Buy in' : tiles[a][1]}</span></button>`;
      }).join('')}</div>`).join('')}</div>
      
      <div class="decide-timer" id="decide-timer"><span class="bar"><i id="decide-bar"></i></span><span class="num" id="decide-num"></span></div>
      <div class="decide-warn" id="decide-warn" role="alert" hidden></div>
    </div>`;
  }
  return '';
}

function controlsHTML() { return ''; }

// A folder in the menu that opens and closes, and stays the way you left it.
function fold(id, title, body, sub = false) {
  return `<details class="fold ${sub ? 'sub' : ''}" data-fold="${id}" ${S.open.has(id) ? 'open' : ''}><summary>${title}</summary><div class="fold-body">${body}</div></details>`;
}
document.addEventListener('toggle', (e) => {
  const id = e.target?.dataset?.fold;
  if (!id) return;
  if (e.target.open) S.open.add(id); else S.open.delete(id);
}, true);

function renderHostPanel(st) {
  const t = S.table;
  const ph = st.phase;
  const ready = t.seats.filter((s) => s && s.ready).length;
  const bettors = t.seats.filter((s) => s && s.bet.main > 0).length;
  $('#host-round').innerHTML = `
    <div class="actions" style="justify-content:flex-start">
      <button class="btn primary" data-act="h-deal" ${ph === 'betting' && t.canDeal() ? '' : 'disabled'}>Deal</button>
      <button class="btn" data-act="h-ins" ${ph === 'insurance' ? '' : 'disabled'}>Close insurance</button>
      <button class="btn" data-act="h-skip" ${ph === 'playing' ? '' : 'disabled'}>Stand for slow player</button>
    </div>
    <div class="hint" style="margin-top:8px">${bettors} player${bettors === 1 ? '' : 's'} betting, ${ready} ready. ${t.settings.betTimer ? `The dealer deals on its own ${t.settings.betTimer} seconds after bets go down` : 'Press Deal to start the round'}${t.settings.autoDeal !== false ? ', or as soon as everyone is ready' : ''}.${t.settings.turnTimer ? ` Players get ${t.settings.turnTimer} seconds per move.` : ''}</div>`;
  $('#host-players').innerHTML = st.players.map((p) => `
    <div class="player-row">
      <div><b>${p.id === st.hostId ? '<span class="crown" title="Host">♛</span> ' : ''}${esc(p.name)}</b>${p.id === S.myId ? ' (you)' : ''}${p.id === st.hostId ? ' <span class="role-tag host">Host</span>' : ''}${st.banker?.id === p.id ? ' <span class="role-tag">Dealer</span>' : ''}<br><span class="hint">${money(p.chips)} chips${p.boughtIn ? ` (bought in ${money(p.boughtIn)} extra)` : ''} · ${p.seat === null ? 'not seated' : 'seat ' + (p.seat + 1)} · ${p.connected ? 'online' : 'away'}</span></div>
      <div class="tools">
        <button class="btn small" data-act="h-give" data-id="${p.id}" data-sign="1">Give</button>
        <button class="btn small" data-act="h-give" data-id="${p.id}" data-sign="-1">Take</button>
        ${t.seats.map((x, i) => (x && x.playerId === p.id ? `<button class="btn small" data-act="h-sitout" data-id="${p.id}" data-seat="${i}" data-on="${x.out ? 0 : 1}" title="${x.out ? 'Deal this seat in again from the next round' : 'This seat gets no cards from the next round. The player keeps the seat.'}">${x.out ? 'Sit in' : 'Sit out'} seat ${i + 1}</button>` : '')).join('')}
        ${p.id === S.myId ? '' : `<button class="btn small danger" data-act="h-kick" data-id="${p.id}">Kick</button>`}
      </div>
    </div>`).join('') || '<div class="hint">Nobody yet. Send the invite link.</div>';
  $('#host-log').innerHTML = st.log.slice().reverse().map((l) => `<div>${esc(l)}</div>`).join('');

  // Settings are only redrawn when they change, so typing in them is not interrupted.
  const locked = !(ph === 'betting' || ph === 'settled');
  const key = JSON.stringify(st.settings) + locked;
  const box = $('#host-settings');
  if (key === S.settingsKey || box.contains(document.activeElement)) return;
  S.settingsKey = key;
  const s = st.settings;
  const dis = locked ? 'disabled' : '';
  box.innerHTML = `
    ${locked ? '<div class="hint" style="margin-bottom:8px">Settings unlock when the round ends.</div>' : ''}
    ${fold('set-cards', '🂠 Cards and reshuffle', `<div class="settings-grid">
      <label class="full">Cards in the shoe
        <select id="set-decks">
          ${[[1, '1 deck'], [2, '2 decks'], [6, '6 decks'], [8, '8 decks'], [20, '20 decks'], ['csm', 'Randomized (full shuffle every round)']].map(([v, l]) => `<option value="${v}" ${String(s.decks) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <label class="full">When to reshuffle
        <select id="set-mode">
          <option value="penetration" ${s.shuffleMode === 'penetration' ? 'selected' : ''}>After a share of the shoe is used</option>
          <option value="rounds" ${s.shuffleMode === 'rounds' ? 'selected' : ''}>Every few rounds</option>
        </select></label>
      <label class="full mode-pen" ${s.shuffleMode === 'rounds' ? 'hidden' : ''}>Reshuffle when <span id="pen-val">${s.penetration}%</span> of the shoe is used
        <input id="set-pen" type="range" min="20" max="95" step="5" value="${s.penetration}" /></label>
      <label class="full mode-rounds" ${s.shuffleMode === 'rounds' ? '' : 'hidden'}>Reshuffle every N rounds<input id="set-every" type="number" min="1" max="50" value="${s.shuffleEvery}" /></label>
      <button class="btn full" data-act="h-shuffle">${locked ? 'Shuffle before next hand' : 'Shuffle now'}</button>
    </div>`, true)}
    ${fold('set-seats', '🪑 Seats', `<div class="settings-grid">
      <label class="full">Seats at the table<input id="set-seats" type="number" min="1" step="1" inputmode="numeric" value="${s.seats}" ${dis} /></label>
      <div class="hint full">Most casino tables have 7. A seat can only be taken away when nobody is sitting in it.</div>
    </div>`, true)}
    ${fold('set-bets', '💵 Chips and bet limits', `<div class="settings-grid">
      <label>Starting chips<input id="set-start" type="number" min="1" value="${s.startChips}" ${dis} /></label>
      <label>Max side bet<input id="set-maxside" type="number" min="0" value="${s.maxSideBet}" ${dis} /></label>
      <label>Min bet<input id="set-min" type="number" min="1" value="${s.minBet}" ${dis} /></label>
      <label>Max bet<input id="set-max" type="number" min="1" value="${s.maxBet}" ${dis} /></label>
      <div class="hint full">Starting chips apply to new players.</div>
    </div>`, true)}
    ${fold('set-rules', '📏 Rules', `<div class="settings-grid">
      <label class="check full"><input id="set-h17" type="checkbox" ${s.dealerHitsSoft17 ? 'checked' : ''} ${dis} /> Dealer hits soft 17</label>
      <label class="check full"><input id="set-sur" type="checkbox" ${s.allowSurrender ? 'checked' : ''} ${dis} /> Allow surrender (get half your bet back)</label>
      <button class="btn full" data-act="h-strip" ${dis}>Reset to Las Vegas Strip rules</button>
    </div>`, true)}
    ${fold('set-sides', '🎲 Side bets offered', `<div class="settings-grid">
      <label class="check full sb-all"><input type="checkbox" id="sb-all" ${SIDE_KEYS.every((k) => sideKeys(st).includes(k)) ? 'checked' : ''} ${dis} /> <b>All side bets</b></label>
      ${SIDE_KEYS.map((k) => `<label class="check full"><input type="checkbox" data-sidebet="${k}" ${sideKeys(st).includes(k) ? 'checked' : ''} ${dis} /> ${SIDE_BETS[k].icon || ''} ${SIDE_BETS[k].name}</label>`).join('')}
    </div>`, true)}
    ${fold('set-auto', '⏱️ Automatic dealer and timers', `<div class="settings-grid">
      <label class="check full"><input id="set-auto" type="checkbox" ${s.autoDeal !== false ? 'checked' : ''} ${dis} /> Deal as soon as everyone is ready</label>
      <label>Betting time<select id="set-bettimer" ${dis}>${timerOpts(s.betTimer)}</select></label>
      <label>Time per move<select id="set-turntimer" ${dis}>${timerOpts(s.turnTimer)}</select></label>
      <div class="hint full">When betting time runs out, the dealer deals to everyone with a bet. When time per move runs out, the dealer stands for that player.</div>
    </div>`, true)}
    <button class="btn primary" style="width:100%;margin-top:10px" data-act="h-settings" ${dis}>Save settings</button>`;
  $('#set-mode').addEventListener('change', (e) => {
    $('.mode-pen').hidden = e.target.value === 'rounds';
    $('.mode-rounds').hidden = e.target.value !== 'rounds';
  });
  // The deck choice saves as soon as it is picked; during a hand it starts when the hand ends.
  $('#set-decks').addEventListener('change', (e) => {
    const v = e.target.value === 'csm' ? 'csm' : Number(e.target.value);
    e.target.blur();
    proposeSettings({ decks: v });
  });
  // The reshuffle choices save as soon as they are changed too.
  const saveShuffle = (e) => { e.target.blur(); proposeSettings({ shuffleMode: $('#set-mode').value, penetration: Number($('#set-pen').value), shuffleEvery: Number($('#set-every').value) }); };
  for (const id of ['set-mode', 'set-pen', 'set-every']) $('#' + id).addEventListener('change', saveShuffle);
  $('#set-pen').addEventListener('input', (e) => ($('#pen-val').textContent = e.target.value + '%'));
}

// Classic Las Vegas Strip rules: 4+ decks, dealer stands on all 17s, 3 to 2 blackjack,
// double any two cards and after splits, split as often as pairs come, aces split once, late surrender.
// Settings changes go to a vote: every other player must say yes.
const SETTING_NAMES = {
  seats: ['Seats at the table', (v) => String(v)],
  decks: ['Cards', (v) => (v === 'csm' ? 'randomized' : `${v} deck${v > 1 ? 's' : ''}`)],
  shuffleMode: ['Reshuffle', (v) => (v === 'rounds' ? 'every few rounds' : 'by share of shoe used')],
  penetration: ['Reshuffle at', (v) => v + '% used'],
  shuffleEvery: ['Reshuffle every', (v) => v + ' rounds'],
  startChips: ['Starting chips', money], minBet: ['Min bet', money], maxBet: ['Max bet', money], maxSideBet: ['Max side bet', money],
  dealerHitsSoft17: ['Dealer', (v) => (v ? 'hits soft 17' : 'stands on all 17s')],
  countTraining: ['Count training', (v) => (v ? 'on for everyone' : 'off')],
  allowSurrender: ['Surrender', (v) => (v ? 'allowed' : 'not allowed')],
  autoDeal: ['Deal when all ready', (v) => (v ? 'on' : 'off')],
  betTimer: ['Betting time', (v) => (v ? v + 's' : 'off')], turnTimer: ['Time per move', (v) => (v ? v + 's' : 'off')],
  blackjackPays: ['Blackjack pays', (v) => (v === 1.5 ? '3 to 2' : v + ' to 1')],
  sideBets: ['Side bets', (v) => (v.length ? v.map((k) => SIDE_BETS[k]?.name).join(', ') : 'none')],
};
function proposeSettings(patch) {
  const cur = S.table.settings;
  const changes = Object.keys(patch).filter((k) => SETTING_NAMES[k] && String(patch[k]) !== String(cur[k]))
    .filter((k) => !(k === 'penetration' && (patch.shuffleMode || cur.shuffleMode) === 'rounds') && !(k === 'shuffleEvery' && (patch.shuffleMode || cur.shuffleMode) !== 'rounds'));
  if (!changes.length) { toast('Nothing changed.'); return; }
  const summary = changes.map((k) => `${SETTING_NAMES[k][0]}: ${SETTING_NAMES[k][1](patch[k])}`);
  hostDo((t) => {
    const id = t.proposeSettings(S.myId, patch, summary);
    if (id) {
      S.voteEnds = Date.now() + VOTE_SECONDS * 1000;
      setTimeout(() => hostDo((tb) => tb.expireVote(id)), VOTE_SECONDS * 1000);
      toast('Sent to the table for a vote.');
    } else toast(t.pendingSettings ? 'Saved. It starts when this hand ends.' : 'Settings saved.');
  });
  S.settingsKey = '';
}

function isStrip(s) {
  return (s.decks === 'csm' || Number(s.decks) >= 4) && !s.dealerHitsSoft17 && s.blackjackPays === 1.5 && s.allowSurrender;
}
function timerOpts(v) {
  return [[0, 'Off'], [10, '10 seconds'], [15, '15 seconds'], [20, '20 seconds'], [30, '30 seconds'], [45, '45 seconds'], [60, '60 seconds']]
    .map(([x, l]) => `<option value="${x}" ${Number(v) === x ? 'selected' : ''}>${l}</option>`).join('');
}

// ---------- Fair shuffle checks ----------
// Every browser keeps its own notes, so a player does not have to believe the host.
// S.fair.mine: the seed I sent for each promised hash. S.fair.checks: the result for each finished shoe.
function fairWatch(st) {
  const f = st.fair;
  if (!f) return;
  const F = (S.fair ||= { mine: {}, cur: {}, checks: {} });
  // The host promised a new hash: answer with a fresh seed of my own, made only after seeing that hash.
  if (f.nextCommit && !F.mine[f.nextCommit]) {
    const buf = new Uint8Array(16); crypto.getRandomValues(buf);
    const seed = Array.from(buf, (x) => x.toString(16).padStart(2, '0')).join('');
    F.mine[f.nextCommit] = seed;
    setTimeout(() => { if (S.role === 'host') S.table?.setClientSeed(S.myId, seed); else if (S.conn?.open) S.conn.send({ t: 'seed', seed }); }, 0);
  }
  // The shoe now in play: note which player seeds the host says went into it, before any card is known.
  if (f.current && !F.cur[f.current.commit]) F.cur[f.current.commit] = JSON.stringify(f.current.clientSeeds);
  // A finished shoe: its seed is now shown, so redo the checks.
  const L = f.last;
  if (L && !F.checks[L.n]) {
    const hashOk = sha256(L.serverSeed) === L.commit;
    const sawPromise = !!F.mine[L.commit];
    const mineIn = sawPromise && L.clientSeeds[S.myId] === F.mine[L.commit];
    const sameSeeds = !F.cur[L.commit] || F.cur[L.commit] === JSON.stringify(L.clientSeeds);
    const ok = hashOk && sameSeeds && (!sawPromise || mineIn);
    F.checks[L.n] = { ok, hashOk, sawPromise, mineIn, sameSeeds };
    if (!ok) toast(`Shuffle check failed for shoe ${L.n}. Tap "Provably fair" at the top right.`);
  }
}
function fairHTML() {
  const f = S.state?.fair, F = S.fair;
  if (!f || !F) return '<h3>🔐 Provably fair</h3><p>No shoe yet.</p>';
  const tick = (b) => (b ? '✅' : '❌');
  let h = `<h3>🔐 Provably fair</h3>
    <p class="fair-p">One shuffle sets the whole shoe. The order comes from a hidden code in the host's browser mixed with hidden codes from the players' browsers, so no single person picked it and nobody can read it early. Each card can only be opened at the moment it is dealt. When a shoe is finished, your browser checks that the shuffle was the one promised at the start.</p>`;
  if (F.alert) h += `<div class="fair-box"><b>❌ The host's browser asked for more card keys than the table needed.</b><div>Your browser refused. A normal table never does this, so the host's copy of the game may have been changed.</div></div>`;
  if (f.current) {
    const c = f.current, mine = F.mine[c.commit];
    h += `<div class="fair-box"><b>Shoe ${c.n} (in play now)</b>
      <div>Players mixed into this shuffle: ${Object.keys(c.clientSeeds).length}. Cards dealt so far: ${c.dealt || 0}.</div>
      <div>${mine ? `${tick(c.clientSeeds[S.myId] === mine)} Your browser's code ${c.clientSeeds[S.myId] === mine ? 'is in this shuffle.' : 'is missing from this shuffle.'}` : 'You joined after this shoe was shuffled. Your code goes into the next one.'}</div></div>`;
  }
  const done = Object.keys(F.checks).map(Number).sort((a, b) => b - a).slice(0, 8);
  for (const n of done) {
    const k = F.checks[n];
    h += `<div class="fair-box"><b>${tick(k.ok)} Shoe ${n} (finished)</b>
      <div>${tick(k.hashOk)} The shuffle matches the one promised before the shoe started.</div>
      <div>${k.sawPromise ? `${tick(k.mineIn)} Your browser's code was mixed in.` : 'You were not at the table when this shoe was shuffled.'}</div>
      <div>${tick(k.sameSeeds)} Nothing was swapped while the shoe was in play.</div></div>`;
  }
  if (!done.length) h += '<p class="fair-dim">No shoe has finished yet. Checks appear here after the next shuffle.</p>';
  return h;
}

function rulesHTML() {
  return `<h2 style="margin-top:0">Side bets</h2><div class="paytable">
    <div class="hint">Payouts are "to 1": a 10 chip bet that pays 25 to 1 wins 250 and you get your 10 back. There is no rake or fee.</div>
    ${sideKeys(S.state).map((k) => {
      const sb = SIDE_BETS[k];
      return `<div><h4>${sb.icon || ''} ${sb.name}</h4><p>${esc(sb.about)}</p><table>${sb.table.map(([l, m]) => `<tr><td>${esc(l)}</td><td>${m} to 1</td></tr>`).join('')}</table></div>`;
    }).join('')}
    <div><h4>Insurance</h4><p>Offered when the dealer shows an ace. Costs half your main bet.</p><table><tr><td>Dealer has blackjack</td><td>2 to 1</td></tr></table></div>
    <div><h4>Main game</h4><p>Blackjack pays 3 to 2. Double on any first two cards, also after a split. Split every pair, with no limit on the number of hands; split aces get one card each. Surrender gives back half your bet when the host allows it.</p><p>Chips are whole. With an odd bet, a win or a refund is rounded down and insurance is rounded up. A blackjack on 25 pays 37, and insurance on 25 costs 13.</p></div>
  </div>`;
}

// ---------- Clicks ----------
// Chips, betting spots and move buttons act the moment the finger or mouse goes down. The table is
// redrawn whenever anyone at it does something, and a button that is swapped between press and
// release never gets its click, so waiting for the click loses taps at a busy table. The click that
// follows a press is then ignored. A click with no press before it (Enter or Space on a focused
// button, or a screen reader) still works as before.
const FAST_ACTS = new Set(['chip', 'main-spot', 'side-spot', 'take-chip', 'undo', 'double-bet', 'clear', 'sides-plus', 'rebet', 'ready', 'ins', 'play', 'pvp-clear']);
const BET_ACTS = new Set(['chip', 'main-spot', 'side-spot', 'take-chip', 'undo', 'double-bet', 'clear', 'sides-plus', 'ready', 'side-clear', 'pvp', 'pvp-clear']);
let pressHandled = false;
// The middle mouse button puts last hand's bet back while betting is open.
document.addEventListener('auxclick', (e) => {
  if (e.button !== 1 || e.target.closest?.('input, textarea, a')) return;
  const st = S.state;
  if (st?.rebet && (st.phase === 'betting' || st.phase === 'settled') && myInfo(st).seat) { e.preventDefault(); doRebet(); }
});
document.addEventListener('mousedown', (e) => { if (e.button === 1 && S.state?.rebet && !e.target.closest?.('input, textarea, a')) e.preventDefault(); }); // no scroll cursor
document.addEventListener('pointerdown', (e) => {
  pressHandled = false;
  if (e.button !== 0 || e.isPrimary === false || S.aim) return; // while aiming a reaction, taps on the table throw it
  const el = e.target.closest?.('[data-act]');
  if (!el || el.disabled || !app.contains(el) || !FAST_ACTS.has(el.dataset.act)) return;
  pressHandled = true;
  runAct(el);
}, true);
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  // e.detail is 0 for a click made by the keyboard or by code, 1 or more for a mouse or touch click.
  if (FAST_ACTS.has(el.dataset.act) && e.detail > 0 && pressHandled) { pressHandled = false; return; }
  runAct(el);
});
function runAct(el) {
  const act = el.dataset.act;
  const st = S.state;
  const me = st?.players.find((p) => p.id === S.myId);
  // A tap on the circle or a side bet of another of my seats: that seat becomes the seat in hand first, so the chip goes where I tapped.
  if (me && st.phase === 'betting' && (act === 'main-spot' || act === 'side-spot')) {
    const m = /^(?:spot|sb)-(\d+)/.exec(el.id || '');
    const i = m ? Number(m[1]) : null;
    if (i !== null && i !== me.seat && (me.seats || []).includes(i) && st.seats[i] && !st.seats[i].out) { S.seatAim = i; S.undo = []; aimSeat(st); }
  }
  const seat = me && me.seat !== null ? st.seats[me.seat] : null;
  // Bets are only taken while betting is open.
  if (BET_ACTS.has(act) && seat && st.phase !== 'betting') return;
  const bet = seat ? structuredClone(seat.bet) : { main: 0, sides: {} };
  const sendBet = (ready = false) => placeBet(bet, ready);
  switch (act) {
    case 'look': {
      const l = readLook(); l[el.dataset.kind] = Number(el.dataset.i);
      safeSet('bj-look', JSON.stringify(l));
      $('#look-pick').outerHTML = lookPickerHTML();
      break;
    }
    case 'host': startHost(false); break;
    case 'resume': startHost(true); break;
    case 'join': startPlayer(params.get('room')); break;
    case 'join-code': {
      const code = ($('#code').value || '').trim();
      if (!code) { toast('Type the table code.'); break; }
      params.set('room', code);
      history.replaceState(null, '', '?' + params.toString());
      startPlayer(code);
      break;
    }
    case 'copy': {
      const link = shareLink();
      (navigator.clipboard?.writeText(link) || Promise.reject()).then(() => toast('Invite link copied. Send it to your friends.'), () => { $('#share').select(); toast('Copy the link from the box.'); });
      break;
    }
    case 'rules': $('#modal-body').innerHTML = rulesHTML(); $('#modal').showModal(); break;
    case 'fair': $('#modal-body').innerHTML = fairHTML(); $('#modal').showModal(); break;
    case 'four': document.body.classList.toggle('four-colour'); safeSet('bj-four', document.body.classList.contains('four-colour') ? '1' : '0'); break;
    case 'sit': send({ t: 'sit', seat: Number(el.dataset.seat), add: el.dataset.add === '1' }); if (el.dataset.add === '1') S.seatAim = Number(el.dataset.seat); break;
    case 'stand-up': send({ t: 'stand-up', seat: myInfo(S.state).me?.seat }); break;
    case 'stand-up-all': send({ t: 'stand-up' }); break;
    case 'sit-out': send({ t: 'sit-out', seat: Number(el.dataset.seat), on: el.dataset.on === '1' }); break;
    case 'pick-seat': pickSeat(Number(el.dataset.seat)); break;
    case 'ask-out': send({ t: 'ask-out', to: el.dataset.id }); break;
    case 'auto': S.auto = { speed: 'normal', ...(S.auto || {}), on: !S.auto?.on, key: null }; clearTimeout(S.auto.timer); render(); autoStep(); break;
    case 'auto-speed': if (S.auto) { S.auto.speed = el.dataset.v; S.auto.key = null; clearTimeout(S.auto.timer); render(); autoStep(); } break;
    case 'chip': {
            const v = Number(el.dataset.v);
      // A tap on another chip only picks it up: nothing is bet. The chip in hand then goes where you tap:
      // the main circle or a side bet. A tap on the chip already in hand adds one to the main bet.
      if (S.chip !== v) {
        S.chip = v;
        if (seat && !safeGet('bj-chip-tip')) { safeSet('bj-chip-tip', '1'); toast('Chip picked. Tap your circle or a side bet to place it. Tap the same chip again to add it to your main bet.'); }
        render(); break;
      }
      if (!seat) { render(); break; }
      const put = fitBet(v, 'main'); // with fewer chips left than the chip is worth, bet what is left
      if (!put) { render(); break; }
      S.undo.push(structuredClone(seat.bet));
      bet.main += put;
      S.mainChips.push(put);
      flyChip(el, $(`#spot-${me.seat}`), v);
      sendBet();
      break;
    }
    case 'side-spot': {
      const k = el.dataset.k;
      S.sideChips[k] = S.sideChips[k] || [];
      if (!S.chip) {
        // No chip picked: tapping a side bet takes its last chip off.
        if (!bet.sides[k]) { toast('Pick a chip first, then tap a bet to add it.'); break; }
        let v = S.sideChips[k].pop();
        if (!v || v > bet.sides[k]) v = [500, 100, 25, 5, 1].find((x) => x <= bet.sides[k]);
        S.undo.push(structuredClone(seat.bet));
        bet.sides[k] -= v;
        if (!bet.sides[k]) delete bet.sides[k];
        flyChip(el, $(`.chip-rack [data-v="${v}"]`) || $('.chip-rack'), v);
        sendBet();
        break;
      }
      if (k === 'friendBust' && (bet.target == null || !st.seats[bet.target] || bet.target === me.seat)) {
        pickFriend(st, me.seat, (target) => {
          const b2 = structuredClone(S.state.seats[me.seat].bet);
          S.undo.push(structuredClone(b2));
          b2.sides.friendBust = (b2.sides.friendBust || 0) + S.chip;
          b2.target = target;
          (S.sideChips.friendBust = S.sideChips.friendBust || []).push(S.chip);
          flyChip($(`.chip-rack [data-v="${S.chip}"]`) || el, el, S.chip);
          placeBet(b2);
        });
        break;
      }
      if (!bet.main) { toast('Put chips on your circle first. A side bet needs a main bet.'); break; }
      const put = fitBet(S.chip, k);
      if (!put) break;
      S.undo.push(structuredClone(seat.bet));
      bet.sides[k] = (bet.sides[k] || 0) + put;
      S.sideChips[k].push(put);
      flyChip($(`.chip-rack [data-v="${S.chip}"]`) || el, el, S.chip);
      sendBet();
      break;
    }
    case 'main-spot': {
      if (!seat) break;
      // With a chip picked, tapping the circle adds that chip. With none picked, it takes the last chip off.
      if (!S.chip) {
        if (!bet.main && st.rebet && !betTotal(bet)) { doRebet(); break; } // empty circle on a new hand: the same bet as last hand
        if (!bet.main) { toast('Pick a chip first, then tap a bet to add it.'); break; }
        let v = S.mainChips.pop();
        if (!v || v > bet.main) v = [500, 100, 25, 5, 1].find((x) => x <= bet.main);
        S.undo.push(structuredClone(seat.bet));
        bet.main -= v;
        // Side bets need a main bet under them.
        if (!bet.main) bet.sides = {};
        flyChip(el, $(`.chip-rack [data-v="${v}"]`) || $('.chip-rack'), v);
        sendBet();
        break;
      }
      const put = fitBet(S.chip, 'main');
      if (!put) break;
      S.undo.push(structuredClone(seat.bet));
      bet.main += put;
      S.mainChips.push(put);
      flyChip($(`.chip-rack [data-v="${S.chip}"]`) || el, el, S.chip);
      sendBet();
      break;
    }
    case 'take-chip': {
      // Take chips off in reverse order: the last one placed comes off first.
      if (!bet.main) break;
      let v = S.mainChips.pop();
      if (!v || v > bet.main) v = [500, 100, 25, 5, 1].find((x) => x <= bet.main);
      S.undo.push(structuredClone(seat.bet));
      bet.main -= v;
      flyChip(el, $(`.chip-rack [data-v="${v}"]`) || $('.chip-rack'), v);
      sendBet();
      break;
    }
    case 'undo': if (S.undo.length) { S.mainChips.pop(); const last = S.undo.pop(); chipSound(); placeBet(last); } break;
    case 'rebet': doRebet(); break;
    case 'keys': $('#modal-body').innerHTML = keysHTML(); $('#modal').showModal(); break;
    case 'history': showHistory(); break;
    case 'view-pad': safeSet('bj-view-pad', viewPadOn() ? '0' : '1'); if (!viewPadOn() && S.room?.walking?.()) S.room.walk(false); document.body.classList.toggle('view-hidden', !viewPadOn()); for (const b of document.querySelectorAll('.menu-item[data-act=view-pad]')) b.textContent = '🎥 View buttons: ' + (viewPadOn() ? 'on' : 'off'); break;
    case 'hist-panel': safeSet('bj-hist-panel', histOn() ? '0' : '1'); drawHistPanel(true); for (const b of document.querySelectorAll('.menu-item[data-act=hist-panel]')) b.textContent = '🕘 Hand history: ' + (histOn() ? 'on' : 'off'); break;
    case 'export': showExport(); break;
    case 'double-bet': {
      S.undo.push(structuredClone(seat.bet));
      S.mainChips = S.mainChips.concat(S.mainChips);
      bet.main *= 2;
      for (const k in bet.sides) bet.sides[k] *= 2;
      flyChip($(`.chip-rack [data-v="${S.chip || 25}"]`), $(`#spot-${me.seat}`), S.chip || 25);
      sendBet();
      break;
    }
    case 'train': safeSet('bj-train', trainingOn() ? '0' : '1'); el.textContent = trainingOn() ? '🧮 Count training: on' : '🧮 Count training: off'; S.train = { right: 0, total: 0 }; render(); break;
    case 'chat': toggleChat(); break;
    case 'voice': toggleVoicePanel(); break;
    case 'voice-close': toggleVoicePanel(false); break;
    case 'voice-join': joinVoice(); break;
    case 'voice-leave': leaveVoice(); break;
    case 'voice-mic': setMic(!V.mic); break;
    case 'voice-mute': V.muted[el.dataset.id] = !V.muted[el.dataset.id]; applyMutes(); drawVoice(); break;
    case 'chat-close': toggleChat(false); break;
    case 'hints': safeSet('bj-hints', hintsOn() ? '0' : '1'); el.textContent = hintsOn() ? '💡 Strategy hints: on' : '💡 Strategy hints: off'; render(); break;
    case 'buyin-open': openBuyIn(); break;
    case 'ledger-toggle': { const l = $('#ledger'); l.classList.toggle('closed'); safeSet('bj-ledger', l.classList.contains('closed') ? '0' : '1'); renderLedger(S.state); break; }
    case 'buyin-answer': hostDo((t) => t.answerBuyIn(Number(el.dataset.id), el.dataset.yes === '1')); break;
    case 'throw-open': openThrowPanel(el); break;
    case 'hurry': send({ t: 'hurry', say: SHOUTS[el.dataset.say] ? el.dataset.say : 'hurry' }); break;
    case 'poop-dealer': send({ t: 'throw', item: 'poop', to: st.banker ? st.banker.id : 'house' }); el.closest('.badbeat')?.remove(); break;
    case 'view-reset': S.room?.home(); $('.view-walk')?.classList.remove('on'); break;
    case 'turn': S.room?.look(Number(el.dataset.d)); break;
    case 'walk': if (S.room) { const on = S.room.walk(!S.room.walking()); el.classList.toggle('on', on); if (on) toast(matchMedia('(pointer: coarse)').matches ? 'Walking: drag to move through the office. Two fingers turn and zoom. ⟲ takes you back to your seat.' : 'Walking: drag to move through the office. Right button turns, the wheel zooms. Reset view takes you back to your seat.'); } break;
    case 'pixel': safeSet('bj-pixel', pixelOn() ? '0' : '1'); el.textContent = pixelOn() ? '👾 Pixel look: on' : '👾 Pixel look: off'; S.room?.setPixel(pixelOn()); break;
    case 'room3d': safeSet('bj-3d', use3D() ? '0' : '1'); location.reload(); break;
    case 'zoom': if (S.room) { S.room.zoomBy(Number(el.dataset.d)); break; } safeSet('bj-zoom', String(Math.round(Math.min(1.6, Math.max(0.6, getZoom() + 0.1 * Number(el.dataset.d))) * 10) / 10)); applyZoom(); break;
    case 'menu': $('#menu-wrap').classList.toggle('open'); break;
    case 'mute': setMuted(!isMuted()); el.textContent = isMuted() ? '🔇 Sound: off' : '🔊 Sound: on'; if (!isMuted()) chipSound(); break;
    case 'sit-dealer': send({ t: 'sit-dealer' }); break;
    case 'leave-dealer': send({ t: 'leave-dealer' }); break;
    case 'd-shuffle': send({ t: 'dealer-shuffle' }); toast(st.phase === 'betting' || st.phase === 'settled' ? 'The shoe was shuffled.' : 'The shoe will be shuffled before the next hand.'); break;
    case 'dealer-max': {
      const v = Math.round(Number($('#dealer-max')?.value)), sv = Math.round(Number($('#dealer-max-side')?.value));
      if (!(v >= st.settings.minBet)) { toast(`The maximum bet cannot be below the minimum bet of ${money(st.settings.minBet)}.`); break; }
      if (!(sv >= 0)) { toast('The maximum side bet cannot be below 0.'); break; }
      send({ t: 'dealer-max', amount: v, side: sv });
      toast(`Maximum bet ${money(v)}, side bets up to ${money(sv)}.`);
      break;
    }
    case 'side-clear': delete bet.sides[el.dataset.k]; sendBet(); break;
    case 'clear': {
      // Clear all: the main bet and every side bet, on each of my seats that is still open for betting.
      const mine = myInfo(st).me;
      for (const i of mine?.seats || []) {
        const o = st.seats[i];
        if (i === mine.seat || !o || o.ready || o.hands?.length || !betTotal(o.bet)) continue;
        send({ t: 'bet', main: 0, sides: {}, ready: false, seq: ++S.betSeq, seat: i, auto: !!S.auto?.on });
        if (S.role !== 'host') o.bet = { main: 0, sides: {} };
      }
      S.mainChips = []; S.undo.push(structuredClone(seat.bet)); bet.main = 0; bet.sides = {}; sendBet(); chipSound(2); break;
    }
    case 'sides-plus': {
      // One more chip on every side bet the table offers, on each of my seats that holds a main bet.
      const mine = myInfo(st).me, keys = sideKeys(st).filter((k) => k !== 'friendBust'), cap = st.settings.maxSideBet ?? Infinity;
      const own = (mine?.seats?.length ? mine.seats : [mine.seat]).filter((i) => { const o = st.seats[i]; return o && !o.out && !o.ready && !o.hands?.length && o.bet.main > 0; });
      if (!own.length) { toast('Place a main bet first. Side bets go with a main bet.'); break; }
      let left = mine.chips - (mine?.seats?.length ? mine.seats : [mine.seat]).reduce((x, i) => x + betTotal(st.seats[i]?.bet), 0), added = 0;
      for (const i of own) {
        const o = st.seats[i], cur = i === mine.seat ? bet : o.bet, sides = { ...cur.sides };
        let n = 0;
        for (const k of keys) { if ((sides[k] || 0) + 1 > cap || left < 1) continue; sides[k] = (sides[k] || 0) + 1; left -= 1; n++; }
        if (!n) continue;
        added += n;
        if (i === mine.seat) { S.undo.push(structuredClone(seat.bet)); bet.sides = sides; sendBet(); }
        else { send({ t: 'bet', main: o.bet.main, sides, target: o.bet.target, ready: false, seq: ++S.betSeq, seat: i, auto: !!S.auto?.on }); if (S.role !== 'host') o.bet = { ...o.bet, sides }; }
      }
      if (added) chipSound(); else toast(left < 1 ? 'All your chips are already bet.' : 'The side bets are at the table maximum.');
      break;
    }
    case 'pvp': {
      if (!bet.main) { toast('Place your own bet first.'); break; }
      const amount = fitBet(S.chip || CHIPS[1], 'friendBust');
      if (!amount) break;
      const add = (target) => {
        const b2 = structuredClone(S.state.seats[me.seat].bet);
        S.undo.push(structuredClone(b2));
        b2.sides.friendBust = (b2.sides.friendBust || 0) + amount;
        b2.target = target;
        chipSound(1);
        placeBet(b2);
      };
      if (bet.sides.friendBust && bet.target != null && st.seats[bet.target] && bet.target !== me.seat) add(bet.target);
      else pickFriend(st, me.seat, add);
      break;
    }
    case 'pvp-clear': S.undo.push(structuredClone(seat.bet)); delete bet.sides.friendBust; sendBet(); chipSound(1); break;
    case 'ready': {
      // Deal me in counts for all my seats with a bet down, not only the seat in hand.
      if (!seat.ready) for (const i of me.seats || []) {
        const o = st.seats[i];
        if (i === me.seat || !o || o.out || o.ready || o.bet.main < st.settings.minBet) continue;
        send({ t: 'bet', main: o.bet.main, sides: { ...o.bet.sides }, target: o.bet.target, ready: true, seq: ++S.betSeq, seat: i, auto: !!S.auto?.on });
        if (S.role !== 'host') o.ready = true; // shown at once; the table's answer follows
      }
      sendBet(!seat.ready);
      break;
    }
    case 'ins': send({ t: 'insurance', take: el.dataset.take === '1', seat: myInfo(S.state).me?.seat }); break;
    case 'play': playMove(el.dataset.a); break;
    // Host only
    case 'h-deal': fresh((t) => t.dealCount(), () => hostDo((t) => t.deal())); break;
    case 'h-frozen': hostDo((t) => {
      if (!(t.phase === 'betting' || t.phase === 'settled')) throw new Error('Change this between rounds.');
      t.setFrozen(el.dataset.on === '1');
      t.addLog(t.frozen ? 'The host froze the ledger: the house deals and those hands are practice.' : 'The ledger freeze is off. Chips and buy-ins are back to where they were before it.');
    }); break;
    case 'h-ins': hostDo((t) => t.forceInsurance()); break;
    case 'h-skip': fresh(() => 0, () => hostDo((t) => t.skipTurn())); break;
    case 'h-shuffle': hostDo((t) => toast(t.askShuffle() ? 'The shoe was shuffled.' : 'The shoe will be shuffled before the next hand.')); break;
    case 'h-give': {
      const amt = Math.abs(Number($('#give-amt').value) || 0) * Number(el.dataset.sign);
      hostDo((t) => t.giveChips(el.dataset.id, amt));
      break;
    }
    case 'h-sitout': {
      const id = el.dataset.id, seat = Number(el.dataset.seat), on = el.dataset.on === '1';
      hostDo((t) => { t.sitOut(id, seat, on); t.addLog(`The host ${on ? 'sat' : 'put'} ${t.players[id]?.name || 'a player'} ${on ? 'out on' : 'back in on'} seat ${seat + 1}.`); });
      break;
    }
    case 'h-kick': {
      const id = el.dataset.id;
      hostDo((t) => t.kick(id));
      const c = S.conns[id];
      if (c) { c.send({ t: 'kicked' }); setTimeout(() => c.close(), 300); delete S.conns[id]; }
      break;
    }
    case 'h-strip':
      proposeSettings({ decks: 6, dealerHitsSoft17: false, allowSurrender: true, blackjackPays: 1.5, shuffleMode: 'penetration', penetration: 75 });
      break;
    case 'h-settings': {
      const v = (id) => $('#' + id).value;
      const decks = v('set-decks') === 'csm' ? 'csm' : Number(v('set-decks'));
      const seats = Math.round(Number(v('set-seats')));
      if (!(seats >= 1)) { toast('The table needs at least 1 seat.'); break; }
      proposeSettings({
        seats, decks, shuffleMode: v('set-mode'), penetration: Number(v('set-pen')), shuffleEvery: Number(v('set-every')),
        startChips: Number(v('set-start')), minBet: Number(v('set-min')), maxBet: Number(v('set-max')), maxSideBet: Number(v('set-maxside')),
        dealerHitsSoft17: $('#set-h17').checked, countTraining: false, allowSurrender: $('#set-sur').checked, autoDeal: $('#set-auto').checked,
        betTimer: Number(v('set-bettimer')), turnTimer: Number(v('set-turntimer')),
        sideBets: [...document.querySelectorAll('[data-sidebet]')].filter((x) => x.checked).map((x) => x.dataset.sidebet),
      });
      break;
    }
  }
}

// Close the menu when clicking anywhere else.
document.addEventListener('click', (e) => {
  const w = $('#menu-wrap');
  if (w && !w.contains(e.target)) w.classList.remove('open');
});

function playMove(a) {
  const st = S.state;
  const short = shortFor(a);
  if (short) { openBuyIn(false, a, short); return; }
  // A hit on a hard 18 or more is almost always a slip, so it needs a second press within 4 seconds.
  if (a === 'hit' && st?.turn) {
    const hh = st.seats[st.turn.seat]?.hands[st.turn.hand], v = hh && handTotal(hh.cards);
    if (v && !v.soft && v.total >= 18) {
      const key = [st.round, st.turn.seat, st.turn.hand, hh.cards.length].join('-');
      if (!(S.hitSure && S.hitSure.key === key && Date.now() - S.hitSure.at < 4000)) {
        S.hitSure = { key, at: Date.now() };
        toast(`Hard ${v.total}. Press Hit again to confirm.`);
        return;
      }
      S.hitSure = null;
    }
  }
  if (trainingOn() && st?.turn) {
    const hand = st.seats[st.turn.seat].hands[st.turn.hand];
    const up = st.dealer.cards[0];
    const best = bestMove(hand.cards, up, st.actions, st.settings);
    if (best) {
      const upName = { A: 'an ace', J: 'a jack', Q: 'a queen', K: 'a king', 8: 'an 8' }[up.r] || 'a ' + up.r;
      const vs = `${describeHand(hand.cards)} against ${upName}`;
      S.train.total++;
      if (best === a) { S.train.right++; coach(`Correct: ${MOVE_NAMES[a]} on ${vs}.`, true); }
      else coach(`Basic strategy: ${MOVE_NAMES[best]} on ${vs}. You chose ${MOVE_NAMES[a]}.`, false);
    }
  }
  if (st?.turn) {
    const h = st.seats[st.turn.seat].hands[st.turn.hand];
    const best = bestMove(h.cards, st.dealer.cards[0], st.actions, st.settings);
    if (best && best !== a) S.badPlayRound = st.round;
  }
  if (a === 'hit') hitSound();
  else if (a === 'stand') standSound();
  send({ t: 'action', a });
}

// Keyboard play: H hit, S stand, D double, P split, U surrender, Y and N answer insurance,
// R type a bet (Enter confirms), B rebet, Space deal me in.
const KEY_HELP = [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double'], ['P', 'Split'], ['U', 'Surrender'], ['Y / N', 'Take insurance, or say no'],
  ['R', 'Type your bet, then Enter'], ['B', 'Rebet: the same bet as last round'], ['Space / Enter', 'Deal me in'], ['L', 'Open or close the ledger'], ['?', 'Show this list'], ['Esc', 'Put the picked chip down'], ['W / A / S / D', 'Move freely through the office (the arrow keys work too). On your turn S and D play your hand'], ['Esc', 'After moving: back to your seat']];
function keysHTML() {
  return `<h2 style="margin-top:0">Keyboard keys</h2><table class="keys-help">${KEY_HELP.map(([k, what]) => `<tr><td>${k.split(' / ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</td><td>${what}</td></tr>`).join('')}</table>
    <p class="hint">Keys work when you are not typing in a box.</p>`;
}
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if ($('#modal')?.open) return;
  const st = S.state;
  if (!st) return;
  const k = e.key.toLowerCase();
  if (e.key === '?') { $('#modal-body').innerHTML = keysHTML(); $('#modal').showModal(); return; }
  if (k === 'l') { const l = $('#ledger'); if (l) { l.classList.toggle('closed'); safeSet('bj-ledger', l.classList.contains('closed') ? '0' : '1'); renderLedger(st); } return; }
  const map = { h: 'hit', s: 'stand', d: 'double', p: 'split', u: 'surrender' };
  // While the first cards are still being dealt there is nothing to decide yet.
  const wait = dealingNow() && S.dealMany;
  if (map[k] && (st.actions?.includes(map[k]) || shortFor(map[k]))) { e.stopPropagation(); if (!wait) playMove(map[k]); return; } // on your turn S and D play the hand; otherwise they move the camera
  const { seat } = myInfo(st);
  if (!seat) return;
  if (st.phase === 'insurance' && (k === 'y' || k === 'n')) {
    if (!wait && seat.hands.length && !seat.insuranceDecided) send({ t: 'insurance', take: k === 'y', seat: myInfo(st).me?.seat });
    return;
  }
  if (k === 'b' && (st.phase === 'betting' || st.phase === 'settled')) {
    if (st.rebet) doRebet(); else toast('There is no earlier bet to repeat yet.');
    return;
  }
  if (st.phase !== 'betting') return;
  if (k === 'r') { e.preventDefault(); openRaise(); }
  else if (e.key === ' ' || e.code === 'Space' || (e.key === 'Enter' && !e.target.closest('button, a, [tabindex]'))) {
    e.preventDefault();
    if (st.noDealer) toast('The cards wait for a dealer.');
    else if (seat.bet.main >= st.settings.minBet && !seat.ready) placeBet(seat.bet, true);
    else if (!seat.bet.main) toast('Place a bet first. Press R to type one, or B to rebet.');
    else if (seat.bet.main < st.settings.minBet) toast(`Table minimum is ${money(st.settings.minBet)}.`);
  }
});

// Type your main bet. Enter confirms, Escape closes.
function openRaise() {
  const st = S.state;
  const { me, seat } = myInfo(st);
  if (!seat) return;
  $('#raise-pop')?.remove();
  const box = document.createElement('div');
  box.id = 'raise-pop';
  box.className = 'buyin-pop';
  box.innerHTML = `<div class="vote-card"><div class="vote-title">Your bet</div>
    <p>Type the amount for your main bet (${money(st.settings.minBet)} to ${money(Math.min(st.settings.maxBet, me.chips))}), then press Enter. Space deals you in.</p>
    <div class="share" style="justify-content:center"><input id="raise-amt" type="number" min="0" step="1" inputmode="numeric" value="${seat.bet.main || ''}" style="width:160px;font-size:20px;text-align:center" /></div></div>`;
  document.body.appendChild(box);
  const inp = $('#raise-amt');
  inp.focus(); inp.select();
  const close = () => box.remove();
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Enter') return;
    const amt = Math.round(Number(inp.value));
    if (!(amt >= 0)) return;
    const cur = S.state.seats[me.seat].bet;
    S.undo.push(structuredClone(cur));
    S.mainChips = [];
    chipSound(2);
    placeBet({ main: amt, sides: amt ? cur.sides : {}, target: cur.target });
    close();
  });
}

// ---------- Start ----------
if (params.get('host') && safeGet('bj-host')) {
  // The host refreshed the page: reopen the same table.
  if (S.name) {
    showLanding();
    startHost(true);
  } else showLanding();
} else {
  // A guest who reloads the page goes straight back to the same table with the same name, buy-in and look.
  const room = (params.get('room') || '').trim().toLowerCase();
  let back = null;
  try { back = room && JSON.parse(sessGet('bj-join-' + room) || 'null'); } catch {}
  if (back && back.name && back.buyIn >= 1) startPlayer(room, back);
  else showLanding();
}


// ---------- Throwing things at other players ----------
const THROWS = {
  punch: { e: '👊', hit: '💥', name: 'Punch' },
  egg: { e: '🥚', hit: '🍳', name: 'Egg' },
  poop: { e: '💩', hit: '💩', name: 'Poop' },
  fart: { e: '💨', hit: '💨', name: 'Fart' },
  tomato: { e: '🍅', hit: '💥', name: 'Tomato' },
  rose: { e: '🌹', hit: '🌹', name: 'Rose' },
  clap: { e: '👏', hit: '👏', name: 'Clap' },
  beer: { e: '🍺', hit: '🍻', name: 'Beer' },
  fire: { e: '🔥', hit: '🔥', name: 'On fire' },
  cry: { e: '😭', hit: '😭', name: 'Tears' },
};
const lastThrow = {};
// The host checks the throw and passes it to everyone at the table, at most one per second per person.
function relayThrow(from, msg) {
  const item = String(msg.item);
  const to = String(msg.to);
  if (!THROWS[item] || !(to === 'house' || S.table.players[to]) || !S.table.players[from]) return;
  const now = Date.now();
  if (now - (lastThrow[from] || 0) < 1000) return;
  lastThrow[from] = now;
  // Throwing poop at the dealer is free for everyone.
  // The seat that was tapped, when the player holds more than one.
  const seat = Number.isInteger(msg.seat) && S.table.seats[msg.seat]?.playerId === to ? msg.seat : undefined;
  const fx = { t: 'fx', from, to, item, seat };
  for (const conn of Object.values(S.conns)) if (conn.open) conn.send(fx);
  showThrow(fx);
}

// "Hurry up": the host passes it to everyone. It may be pressed again and again (at most 8 a second per person).
const lastHurry = {};
const SHOUTS = { hurry: ['⏰', 'HURRY UP!'], bus: ['💥', 'BUSSSS!!!'], split: ['✂️', 'SPLIT THAT SHIT!!!'], insure: ['🛡️', 'INSURE THAT SHIT!!'] };
function relayHurry(from, say) {
  const p = S.table.players[from];
  if (!p) return;
  const now = Date.now();
  if (now - (lastHurry[from] || 0) < 120) return;
  lastHurry[from] = now;
  const fx = { t: 'fx', kind: 'hurry', say: SHOUTS[say] ? say : 'hurry', from, name: p.name };
  for (const conn of Object.values(S.conns)) if (conn.open) conn.send(fx);
  showHurry(fx);
}
function showHurry({ from, name, say }) {
  const el = document.createElement('div');
  const [ico, words] = SHOUTS[say] || SHOUTS.hurry;
  el.className = 'hurry-pop' + (say === 'bus' ? ' bus' : say === 'split' ? ' split' : say === 'insure' ? ' insure' : '');
  el.textContent = `${ico} ${from === S.myId ? 'You' : String(name || 'Someone').slice(0, 16)}: ${words}`;
  el.style.left = 50 + (Math.random() * 44 - 22) + '%';
  el.style.top = 24 + Math.random() * 30 + '%';
  el.style.setProperty('--tilt', (Math.random() * 16 - 8).toFixed(1) + 'deg');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
  hitSound();
}
// The Hurry up button stays right beside the Reactions button, wherever that is on this screen.
function placeHurry() {
  const a = $('.float-throw'), bs = [...document.querySelectorAll('.float-hurry')];
  if (!a || !bs.length) return;
  if (getComputedStyle(bs[0]).position !== 'fixed') { for (const b of bs) { b.hidden = false; b.style.left = b.style.top = b.style.height = ''; } return; } // on phones they are part of the top row
  // The bar these buttons are in may be zoomed, so the places are worked out in its own units.
  const r = a.getBoundingClientRect(), k = r.width ? a.offsetWidth / r.width : 1, wide = innerWidth * k, h = a.offsetHeight;
  // Side by side where there is room; on a narrow screen the later buttons go on a second line.
  let x = a.offsetLeft + a.offsetWidth + 6, y = a.offsetTop;
  for (const b of bs) {
    b.hidden = !r.width;
    b.style.height = h + 'px';
    const w = b.offsetWidth;
    if (x + w > wide - 4 || (b === bs[1] && innerWidth < 700)) { x = b === bs[1] ? bs[0].offsetLeft : a.offsetLeft; y += h + 4; }
    b.style.left = Math.round(x) + 'px';
    b.style.top = Math.round(y) + 'px';
    x += w + 6;
  }
}
setInterval(placeHurry, 500);

// Where a player is on my screen: their seat, the dealer seat, or the bottom middle if they are just watching.
function placeOf(id, at) {
  const st = S.state;
  if (!st) return null;
  if (id === 'house' || st.banker?.id === id) return $('#dealer-zone .cards') || $('#dealer-zone');
  const seat = Number.isInteger(at) && st.seats[at]?.playerId === id ? at : st.seats.findIndex((x) => x && x.playerId === id);
  if (seat >= 0) return $(`#seat-${seat} .who`) || $(`#seat-${seat}`);
  return { left: innerWidth / 2 - 20, top: innerHeight - 60, width: 40, height: 40 };
}

function showThrow({ from, to, item, seat }) {
  const def = THROWS[item];
  if (!def) return;
  const a = placeOf(from), b = placeOf(to, seat);
  if (!a || !b) return;
  const ra = a.getBoundingClientRect ? a.getBoundingClientRect() : a;
  const rb = b.getBoundingClientRect ? b.getBoundingClientRect() : b;
  const el = document.createElement('div');
  el.className = 'thrown';
  el.textContent = def.e;
  const x0 = ra.left + ra.width / 2 - 22, y0 = ra.top + ra.height / 2 - 22;
  const x1 = rb.left + rb.width / 2 - 22, y1 = rb.top + rb.height / 2 - 22;
  el.style.left = x0 + 'px';
  el.style.top = y0 + 'px';
  document.body.appendChild(el);
  const dx = x1 - x0, dy = y1 - y0;
  const lift = 120 + Math.hypot(dx, dy) / 5;
  throwSound(item, 'whoosh');
  el.animate([
    { transform: 'translate(0,0) rotate(0) scale(.8)' },
    { transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) rotate(360deg) scale(1.3)`, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) rotate(720deg) scale(1)` },
  ], { duration: 750, easing: 'cubic-bezier(.35,.1,.6,1)', fill: 'forwards' }).onfinish = () => {
    el.remove();
    throwSound(item, 'hit');
    const splat = document.createElement('div');
    splat.className = `splat splat-${item}`;
    splat.textContent = def.hit;
    splat.style.left = x1 + 'px';
    splat.style.top = y1 + 'px';
    document.body.appendChild(splat);
    setTimeout(() => splat.remove(), 2600);
  };
}

// Pick-what-to-throw popup when you tap another player's name.
function openThrow(target, anchor) {
  const seatEl = anchor.closest('.seat[id^="seat-"]'), seat = seatEl ? Number(seatEl.id.slice(5)) : undefined;
  closeThrow();
  const st = S.state;
  const p = st.players.find((x) => x.id === target);
  const box = document.createElement('div');
  box.className = 'throw-pop';
  box.id = 'throw-pop';
  box.innerHTML = `<div class="throw-title">Throw at ${esc(p?.name || 'player')}</div>
    <div class="throw-grid">${Object.entries(THROWS).map(([k, v]) => `<button data-throw="${k}" title="${v.name}">${v.e}</button>`).join('')}</div>`;
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(innerWidth - 230, r.left + r.width / 2 - 110)) + 'px';
  box.style.top = Math.max(8, r.top - 130) + 'px';
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-throw]');
    if (!b) return;
    send({ t: 'throw', item: b.dataset.throw, to: target, seat });
    closeThrow();
  });
}
function closeThrow() { $('#throw-pop')?.remove(); }
document.addEventListener('click', (e) => {
  const who = e.target.closest('[data-throw-at]');
  if (who) { e.stopPropagation(); if (who.dataset.throwAt !== S.myId) openThrow(who.dataset.throwAt, who); return; }
  if (!e.target.closest('#throw-pop') && !S.aim) closeThrow();
}, true);

document.addEventListener('input', (e) => {
  if (e.target.id !== 'tilt') return;
  safeSet('bj-tilt', String(e.target.value));
  applyZoom();
});

addEventListener('resize', () => { applyZoom(); placeSeats(); placePanels(); });

// Camera: drag an empty part of the table to tilt and turn it, scroll to zoom.
(() => {
  let drag = null;
  addEventListener('pointerdown', (e) => {
    const stage = e.target.closest?.('#stage');
    if (!stage || e.button !== 0 || e.target.closest('button, [data-act], [data-throw-at], input, select, .felt-actions > *')) return;
    drag = { x: e.clientX, y: e.clientY, tilt: getTilt(), spin: Number(safeGet('bj-spin')) || 0, moved: false };
  });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    safeSet('bj-tilt', String(Math.round(Math.max(0, Math.min(50, drag.tilt + dy / 6)))));
    safeSet('bj-spin', String(Math.round(Math.max(-30, Math.min(30, drag.spin + dx / 10)))));
    applyZoom();
  });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('wheel', (e) => {
    if (!e.target.closest?.('#stage')) return;
    e.preventDefault();
    const z = Math.min(1.6, Math.max(0.6, getZoom() - Math.sign(e.deltaY) * 0.05));
    safeSet('bj-zoom', String(Math.round(z * 100) / 100));
    applyZoom();
  }, { passive: false });
  addEventListener('dblclick', (e) => {
    if (!e.target.closest?.('#stage') || e.target.closest('button, [data-act]')) return;
    safeSet('bj-spin', '0'); safeSet('bj-tilt', '30'); safeSet('bj-zoom', '1'); applyZoom();
  });
})();


// Friend Bust: choose which friend you are betting will bust.
function pickFriend(st, mySeat, done) {
  const others = st.seats.map((x, i) => (x && i !== mySeat ? { i, name: x.name } : null)).filter(Boolean);
  if (!others.length) { toast('Nobody else is sitting at the table yet.'); return; }
  const box = document.createElement('div');
  box.className = 'throw-pop friend-pop';
  box.innerHTML = `<div class="throw-title">⚔️ PvP bet: who will bust?</div><div class="friend-list">${others.map((o) => `<button class="btn" data-friend="${o.i}">${esc(o.name)}</button>`).join('')}</div>`;
  document.body.appendChild(box);
  box.style.left = Math.max(8, innerWidth / 2 - 110) + 'px';
  box.style.top = Math.max(70, innerHeight * 0.35) + 'px';
  box.id = 'throw-pop';
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-friend]');
    if (!b) return;
    box.remove();
    done(Number(b.dataset.friend));
  });
}


// Top-left guide to the side bets this table offers.
function renderGuide(st) {
  const body = $('#sb-guide-body');
  if (!body) return;
  const key = sideKeys(st).join(',');
  if (body.dataset.key === key) return;
  body.dataset.key = key;
  body.innerHTML = sideKeys(st).map((k) => {
    const sb = SIDE_BETS[k];
    return `<div class="g-item ${sb.pvp ? 'pvp' : ''}"><div class="g-head">${sb.icon || ''} <b>${sb.name}</b>${sb.pvp ? ' <span class="pvp-chip">Player against player</span>' : ''}</div><p>${esc(sb.about)}</p>
      <table>${sb.table.map(([l, m]) => `<tr><td>${esc(l)}</td><td>${m} to 1</td></tr>`).join('')}</table></div>`;
  }).join('') || '<p>No side bets at this table.</p>';
}


// "See the next card" button and the private look at it.
function peekBtnHTML(st) {
  if (!st.canPeek) return ''; // only right after a round, until the first bet of the next one
  const cost = st.settings.peekCost ?? 10;
  const free = !st.banker || st.banker.id === S.myId;
  return `<button class="btn peek-btn" data-act="peek" title="Everyone sees the card that would have come next. It then leaves the shoe.">👁 Show next card to all${free ? '' : ` · ${money(cost)}`}</button>`;
}
function showPeek(card, by) {
  if (!card) return;
  $('#peek-pop')?.remove();
  const box = document.createElement('div');
  box.id = 'peek-pop';
  box.className = 'peek-pop';
  box.innerHTML = `<div class="peek-title">👁 The card that would have come next</div>${cardHTML(card, true)}<div class="hint">${esc(by || 'Someone')} asked to see it. Everyone sees it, and it is out of the shoe now.</div>`;
  document.body.appendChild(box);
  cardSound();
  setTimeout(() => box.classList.add('out'), 3200);
  setTimeout(() => box.remove(), 3700);
}


// Reactions menu: pick what to throw, then tap a player or the dealer on the table.
function openThrowPanel(anchor) {
  if ($('#throw-pop')) { stopAim(); return; }
  const box = document.createElement('div');
  box.className = 'throw-pop wide';
  box.id = 'throw-pop';
  const draw = () => {
    box.innerHTML = `<div class="throw-head"><div class="throw-title">${S.aim ? `${THROWS[S.aim].e} Now tap a player or the dealer` : 'Pick a reaction'}</div><button class="throw-x" data-aim-close aria-label="Close reactions" title="Close">✕</button></div>
      <div class="throw-grid">${Object.entries(THROWS).map(([k, v]) => `<button data-aim="${k}" class="${S.aim === k ? 'sel' : ''}" title="${v.name}">${v.e}</button>`).join('')}</div>
      <div class="hint" style="text-align:center;margin-top:6px">${S.aim ? 'One tap sends it and closes this box.' : 'Then tap a player or the dealer.'}</div>`;
  };
  draw();
  document.body.appendChild(box);
  // The box opens beside the Reactions button, never on top of it: below it when the button is near the top of the screen, above it otherwise.
  const r = anchor.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, r.left)) + 'px';
  box.style.top = (r.top < innerHeight / 2 ? r.bottom + 8 : Math.max(70, r.top - box.offsetHeight - 10)) + 'px';
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-aim-close]')) { stopAim(); return; }
    const b = e.target.closest('[data-aim]');
    if (!b) return;
    S.aim = b.dataset.aim;
    document.body.classList.add('aiming');
    draw();
  });
}
function stopAim() { S.aim = null; document.body.classList.remove('aiming'); $('#throw-pop')?.remove(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape') { stopAim(); if (S.chip) { S.chip = null; render(); } } });
document.addEventListener('click', (e) => {
  if (S.chip && e.target.closest('#tray') && !e.target.closest('button, [data-act]')) { S.chip = null; render(); }
});
// While aiming, a tap on another player's seat or on the dealer throws the picked reaction there, once.
// Taps on your own seat are left alone, so your bets still work.
document.addEventListener('click', (e) => {
  if (!S.aim || !S.state || e.target.closest('#throw-pop, .float-throw')) return;
  const st = S.state;
  let to = null, seat;
  const seatEl = e.target.closest('.seat[id^="seat-"]');
  if (seatEl) to = st.seats[seat = Number(seatEl.id.slice(5))]?.playerId || null;
  else if (e.target.closest('#dealer-zone')) to = st.banker ? st.banker.id : 'house';
  if (!to || to === S.myId) return;
  e.stopPropagation(); e.preventDefault();
  send({ t: 'throw', item: S.aim, to, seat });
  stopAim();
}, true);
// Phone: tap a small seat to see it large, tap again anywhere to put it back.
document.addEventListener('click', (e) => {
  if (S.aim || !S.state) return;
  const was = S.zoomSeat ?? null;
  const mini = e.target.closest('.seat.mini:not(.empty), .seat.std.many');
  let now = null;
  if (mini && !e.target.closest('[data-throw-at], button')) now = Number(mini.id.slice(5));
  if (now === was) now = null;
  if (now === was) return;
  S.zoomSeat = now;
  render();
});

// Bad beat: you lose a strong hand (19 or 20) to a dealer 21 made with four or more cards.
function badBeat(st) {
  const { seat } = myInfo(st);
  const d = st.dealer;
  if (!seat || !seat.hands.length || d.total !== 21 || d.cards.length < 4) return;
  if (!seat.hands.some((h) => h.total >= 19 && h.total <= 21 && h.result === 'Lose')) return;
  const el = document.createElement('div');
  el.className = 'badbeat';
  el.innerHTML = `<b>Bad beat!</b> Dealer made 21 with ${d.cards.length} cards. <button class="btn gold" data-act="poop-dealer">💩 Throw poop at the dealer</button>`;
  app.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}


// Short message across the middle of the table.
function banner(title, sub, kind, ms = 2700) {
  const el = document.createElement('div');
  el.className = 'table-banner ' + (kind || '');
  el.setAttribute('role', 'status');
  el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), ms - 500);
  setTimeout(() => el.remove(), ms);
}

document.addEventListener('change', (e) => {
  if (e.target.id !== 'look-flag') return;
  const l = readLook(); l.flag = e.target.value; safeSet('bj-look', JSON.stringify(l));
});

// "All side bets" in the host settings ticks or clears every side bet; ticking them one by one keeps it in step.
document.addEventListener('change', (e) => {
  const boxes = [...document.querySelectorAll('[data-sidebet]')];
  if (e.target.id === 'sb-all') for (const b of boxes) b.checked = e.target.checked;
  else if (e.target.dataset?.sidebet && $('#sb-all')) $('#sb-all').checked = boxes.every((b) => b.checked);
});

// The game switch at the top left: the poker table of the same room code. The host of this table opens it.
document.addEventListener('change', (e) => {
  if (e.target.id !== 'game-switch' || !['poker', 'baccarat', 'roulette'].includes(e.target.value)) return;
  goGame(e.target.value);
});
function goGame(game) {
  const q = new URLSearchParams();
  q.set('from', 'blackjack');
  if (S.code) { q.set('room', S.code); q.set('go', '1'); if (S.role === 'host') q.set('open', '1'); sessSet('games-from-bj', S.code); }
  for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure', '3d', 'flat', 'roomdebug']) if (params.get(k)) q.set(k, params.get(k));
  location.href = game + '.html' + (q.toString() ? '?' + q : '');
}

// The other tables of the office: who plays there is drawn at their table in the room.
S.others = {};
watchOffice('blackjack', () => S.code, (g, list) => { S.others[g] = list.filter((p) => p.id.split('#')[0] !== S.myId); S.room?.setOthers(S.others); });
