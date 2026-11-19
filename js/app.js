// Screens and networking. The host's browser runs the Table (js/game.js) and sends
// each player a copy of what they are allowed to see. Players send their moves back.
// Browsers talk to each other directly with PeerJS (WebRTC), so no game server is needed.
import { Table, SIDE_BETS, SIDE_KEYS, MAX_SEATS, handTotal } from './game.js';
import { chipSound, cardSound, flyChip, stackHTML, chipClass, isMuted, setMuted } from './fx.js';

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
  chip: 25,
  seen: new Set(),
  undo: [],          // my bet before each chip, for Undo
  mainChips: [],     // chips I put on my main bet, in order
  cardAt: new Map(), // card key -> time it is dealt
  pendingNew: [],
  nextCardAt: 0,
  holeHidden: new Set(),
  prevView: null,
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
function safeDel(k) { try { localStorage.removeItem(k); } catch {} }
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
function peerOptions() {
  // Optional: ?peerhost=... lets you use your own PeerJS server instead of the free public one.
  const host = params.get('peerhost');
  if (!host) return { debug: 1 };
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
      <h1>Blackjack Table</h1>
      <p>${room ? `You were invited to table <b>${esc(room)}</b>. Pick a name and join.` : 'Host a table, send the link to up to 4 friends, and play live. Play money only.'}</p>
      <div class="box">
        <label for="name">Your name</label>
        <input id="name" maxlength="16" placeholder="e.g. Sam" value="${esc(S.name)}" autocomplete="nickname" />
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

function readName() {
  const n = ($('#name')?.value || '').trim();
  if (!n) { toast('Type your name first.'); return null; }
  S.name = n.slice(0, 16);
  safeSet('bj-name', S.name);
  return S.name;
}

// ---------- Host ----------
function startHost(resume) {
  if (!readName()) return;
  S.role = 'host';
  if (resume) {
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
  S.table.join(S.myId, S.name);
  history.replaceState(null, '', location.pathname + '?' + new URLSearchParams({ ...Object.fromEntries(params), host: S.code }).toString());
  buildLayout();
  openHostPeer(0);
  hostChanged();
}

function openHostPeer(attempt) {
  const peer = new Peer(ROOM_PREFIX + S.code, peerOptions());
  S.peer = peer;
  peer.on('open', () => { S.online = true; render(); });
  peer.on('connection', (conn) => {
    conn.on('data', (msg) => onHostMessage(conn, msg));
    conn.on('close', () => {
      if (conn.clientId && S.conns[conn.clientId] === conn) {
        delete S.conns[conn.clientId];
        S.table.disconnect(conn.clientId);
        S.table.addLog(`${S.table.players[conn.clientId]?.name || 'A player'} left.`);
        // If it was their turn, move on.
        const t = S.table.turn;
        if (t && S.table.seats[t.seat]?.playerId === conn.clientId) S.table.skipTurn();
        if (S.table.phase === 'insurance') {
          const seat = S.table.seats[S.table.players[conn.clientId]?.seat];
          if (seat) { try { S.table.insurance(conn.clientId, false); } catch {} }
        }
        hostChanged();
      }
    });
  });
  peer.on('disconnected', () => { S.online = false; render(); setTimeout(() => !peer.destroyed && peer.reconnect(), 1500); });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id' && attempt < 15) {
      // After a page refresh the old table name can stay reserved for a few seconds.
      peer.destroy();
      setTimeout(() => openHostPeer(attempt + 1), 2000);
      toast('Reopening your table...');
      return;
    }
    if (e.type === 'peer-unavailable') return;
    toast('Connection problem: ' + (e.type || e.message));
  });
}

function onHostMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'join') {
    const id = String(msg.clientId || '').slice(0, 20);
    if (!id || id === S.myId) { conn.send({ t: 'error', msg: 'Open the link in another browser or device.' }); return; }
    const p = S.table.players[id];
    if (p?.kicked) { conn.send({ t: 'kicked' }); setTimeout(() => conn.close(), 300); return; }
    const old = S.conns[id];
    if (old && old !== old.closed) { old.clientId = null; try { old.close(); } catch {} }
    conn.clientId = id;
    S.conns[id] = conn;
    S.table.join(id, msg.name);
    hostChanged();
    return;
  }
  if (!conn.clientId) return;
  runAction(conn.clientId, msg, (err) => conn.open && conn.send({ t: 'error', msg: err }));
}

// Moves any player (including the host as a player) can make.
function runAction(id, msg, onError) {
  const t = S.table;
  try {
    switch (msg.t) {
      case 'sit': t.sit(id, Number(msg.seat)); break;
      case 'stand-up': t.standUp(id); break;
      case 'bet': t.setBet(id, msg); break;
      case 'insurance': t.insurance(id, !!msg.take); break;
      case 'action': t.action(id, String(msg.a)); break;
      case 'sit-dealer': {
        const voteId = t.requestDealer(id);
        if (voteId) setTimeout(() => hostDo((tb) => tb.expireVote(voteId)), VOTE_SECONDS * 1000);
        S.voteEnds = Date.now() + VOTE_SECONDS * 1000;
        break;
      }
      case 'vote': t.castVote(id, !!msg.yes); break;
      case 'leave-dealer': t.leaveDealer(id); break;
      default: return;
    }
  } catch (e) {
    onError(e.message);
  }
  hostChanged();
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
    const step = () => {
      t.dealerStep();
      if (t.phase === 'dealer') S.dealerTimer = setTimeout(step, 950);
      else S.dealerTimer = null;
      hostChanged();
    };
    S.dealerTimer = setTimeout(step, 1000);
  }
  // Auto deal once every seated, connected player has pressed Ready.
  if (t.settings.autoDeal !== false && t.phase === 'betting' && !S.autoDealTimer) {
    const seated = t.seats.filter((s) => s && t.players[s.playerId].connected);
    if (seated.length && seated.every((s) => s.ready && s.bet.main > 0)) {
      S.autoDealTimer = setTimeout(() => {
        S.autoDealTimer = null;
        const still = t.seats.filter((s) => s && t.players[s.playerId].connected);
        if (t.phase === 'betting' && still.length && still.every((s) => s.ready)) hostDo((tb) => tb.deal());
      }, 900);
    }
  }
  scheduleTimer();
  const timer = S.timer ? { kind: S.timer.kind, endsIn: S.timer.ends - Date.now() } : null;
  const voteEndsIn = t.vote ? Math.max(0, S.voteEnds - Date.now()) : 0;
  for (const [id, conn] of Object.entries(S.conns)) {
    if (conn.open) conn.send({ t: 'state', state: { ...t.publicState(id), timer, voteEndsIn } });
  }
  S.state = { ...t.publicState(S.myId), timer, voteEndsIn };
  setTimerFromState(S.state);
  safeSet('bj-host', JSON.stringify({ code: S.code, table: t }));
  render();
}

// The automatic dealer: deals when the betting time is up, and stands for a
// player who has not acted in time.
function scheduleTimer() {
  const t = S.table;
  const s = t.settings;
  let want = null;
  if ((t.phase === 'betting' || t.phase === 'settled') && s.betTimer > 0 &&
      t.seats.some((x) => x && x.bet.main > 0 && t.players[x.playerId].connected)) {
    want = { key: `deal-${t.round}-${t.phase}`, kind: 'deal', secs: t.phase === 'settled' ? s.betTimer + 4 : s.betTimer };
  } else if (t.phase === 'insurance' && s.turnTimer > 0) {
    want = { key: `ins-${t.round}`, kind: 'insurance', secs: Math.min(s.turnTimer, 15) };
  } else if (t.phase === 'playing' && t.turn && s.turnTimer > 0) {
    const h = t.seats[t.turn.seat].hands[t.turn.hand];
    want = { key: `turn-${t.round}-${t.turn.seat}-${t.turn.hand}-${h.cards.length}`, kind: 'turn', secs: s.turnTimer };
  }
  if (S.timer && want && S.timer.key === want.key) return;
  if (S.timer) { clearTimeout(S.timer.handle); S.timer = null; }
  if (!want) return;
  const fire = () => {
    S.timer = null;
    if (want.kind === 'deal') hostDo((tb) => { if (tb.phase === 'settled') tb.startBetting(); if (tb.canDeal()) tb.deal(); });
    else if (want.kind === 'insurance') hostDo((tb) => tb.forceInsurance());
    else hostDo((tb) => { tb.addLog(`Time ran out for ${tb.seats[tb.turn.seat].playerId === S.myId ? 'you' : tb.players[tb.seats[tb.turn.seat].playerId].name}, dealer stands.`); tb.skipTurn(); });
  };
  S.timer = { key: want.key, kind: want.kind, ends: Date.now() + want.secs * 1000, handle: setTimeout(fire, want.secs * 1000) };
}

function setTimerFromState(st) {
  S.timerKind = st.timer?.kind || null;
  S.timerEnds = st.timer ? Date.now() + st.timer.endsIn : 0;
  updateTimer();
}

function updateTimer() {
  const el = $('#timer');
  if (!el) return;
  const left = Math.max(0, Math.ceil((S.timerEnds - Date.now()) / 1000));
  if (!S.timerKind || !S.timerEnds) { el.hidden = true; return; }
  el.hidden = false;
  el.classList.toggle('urgent', left <= 5);
  el.textContent = S.timerKind === 'deal' ? `Dealing in ${left}s` : S.timerKind === 'insurance' ? `Insurance closes in ${left}s` : `${left}s to act`;
}
setInterval(updateTimer, 250);

// ---------- Player ----------
function startPlayer(code) {
  if (!readName()) return;
  S.role = 'player';
  S.code = code.trim().toLowerCase();
  buildLayout();
  render();
  const peer = new Peer(peerOptions());
  S.peer = peer;
  peer.on('open', () => connectToHost());
  peer.on('disconnected', () => setTimeout(() => !peer.destroyed && peer.reconnect(), 1500));
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      S.online = false;
      render('The table was not found. The host may be offline. Trying again...');
      setTimeout(connectToHost, 3000);
      return;
    }
    toast('Connection problem: ' + (e.type || e.message));
  });
}

function connectToHost() {
  if (S.peer.disconnected) return;
  const conn = S.peer.connect(ROOM_PREFIX + S.code, { reliable: true });
  S.conn = conn;
  conn.on('open', () => {
    S.online = true;
    S.retry = 0;
    conn.send({ t: 'join', clientId: S.myId, name: S.name });
  });
  conn.on('data', (msg) => {
    if (msg.t === 'state') { S.state = msg.state; render(); setTimerFromState(msg.state); }
    else if (msg.t === 'error') toast(msg.msg);
    else if (msg.t === 'kicked') { S.kicked = true; S.peer.destroy(); app.innerHTML = '<div class="center-msg"><h2>You were removed from the table.</h2></div>'; }
  });
  conn.on('close', () => {
    if (S.kicked || S.conn !== conn) return;
    S.online = false;
    render();
    S.retry++;
    setTimeout(connectToHost, Math.min(10000, 1500 * S.retry));
  });
}

// Send a move: players send it to the host, the host runs it directly.
function send(msg) {
  if (S.role === 'host') runAction(S.myId, msg, toast);
  else if (S.conn?.open) S.conn.send(msg);
  else toast('Not connected to the table.');
}

// ---------- Layout and rendering ----------
function buildLayout() {
  const host = S.role === 'host';
  app.innerHTML = `
    <div class="topbar">
      <span class="title">Blackjack</span>
      <span id="conn-pill" class="pill">Connecting</span>
      <span class="spacer"></span>
      <button class="btn small gold" data-act="copy">Invite</button>
      <div class="menu-wrap" id="menu-wrap">
        <button class="hamburger" data-act="menu" aria-label="Menu" aria-haspopup="true"><span></span><span></span><span></span></button>
        <div class="menu" id="menu">
          <div class="menu-sec">
            <div class="menu-title">Invite link</div>
            <div class="share"><input id="share" readonly /><button class="btn small" data-act="copy">Copy</button></div>
          </div>
          <div class="menu-sec menu-items">
            <button class="menu-item" data-act="rules">Side bet payouts</button>
            <button class="menu-item" data-act="four">Four colour cards</button>
            <button class="menu-item" data-act="mute" id="mute-btn">${isMuted() ? 'Sound: off' : 'Sound: on'}</button>
          </div>
          ${host ? `
          <div class="menu-sec"><div class="menu-title">Host controls</div><div id="host-round"></div></div>
          <div class="menu-sec"><div class="menu-title">Players</div>
            <div class="hint" style="margin-bottom:8px">Chips for Give / Take: <input id="give-amt" type="number" value="500" min="1" style="width:90px" /></div>
            <div id="host-players" class="player-list"></div></div>
          <div class="menu-sec"><div class="menu-title">Table settings (only you can change these)</div><div id="host-settings"></div></div>
          <div class="menu-sec"><div class="menu-title">Table log</div><div id="host-log" class="log"></div></div>` : `
          <div class="menu-sec hint">Only the host can change the table settings.</div>`}
        </div>
      </div>
    </div>
    <div class="main player">
      <div>
        <div class="felt" id="felt"></div>
        <div class="tray" id="tray"></div>
        <div class="panel controls" id="controls"></div>
      </div>
    </div>`;
}

function render(note) {
  if (!S.role) return;
  const st = S.state;
  const pill = $('#conn-pill');
  if (pill) {
    pill.className = 'pill ' + (S.online ? 'live' : 'off');
    pill.textContent = S.online ? `Table ${S.code}` : (S.role === 'host' ? 'Opening table...' : 'Reconnecting...');
  }
  const share = $('#share');
  if (share && share.value !== shareLink()) share.value = shareLink();
  if (!st) {
    $('#felt').innerHTML = `<div class="center-msg">${esc(note || 'Connecting to the table...')}</div>`;
    $('#tray').innerHTML = '';
    $('#controls').innerHTML = '';
    return;
  }
  const prev = S.prevView;
  if (prev && st.round !== prev.round) { S.undo = []; S.mainChips = []; }
  $('#felt').innerHTML = feltHTML(st);
  $('#tray').innerHTML = trayHTML(st);
  $('#controls').innerHTML = controlsHTML(st);
  $('#controls').hidden = !$('#controls').innerHTML.trim();
  if (S.role === 'host') renderHostPanel(st);
  renderVote(st);
  updateTimer();
  runDealQueue();
  animateChanges(prev, st);
  S.prevView = { phase: st.phase, round: st.round, bets: Object.fromEntries(st.seats.filter(Boolean).map((s) => [s.playerId, betTotal(s.bet)])) };
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
  box.innerHTML = `<div class="vote-card">
    <div class="vote-title">${mine ? 'Waiting for votes' : `${esc(v.name)} wants to be the dealer`}</div>
    <p>${mine ? `Everyone else has to say yes. ${v.yes} of ${v.voters} said yes so far.` : 'They would pay all winning bets and collect all losing bets. Everyone has to say yes. No answer counts as no.'}</p>
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
  if (st.phase === 'settled' && prev.phase !== 'settled') showResult(st);
  const dealer = $('#dealer-zone .cards') || $('#dealer-zone');
  st.seats.forEach((s, i) => {
    if (!s) return;
    const spot = $(`#spot-${i}`);
    const before = prev.bets[s.playerId] || 0;
    const now = betTotal(s.bet);
    // My own chips already flew when I clicked them.
    if (s.playerId !== S.myId && now > before && (st.phase === 'betting' || st.phase === 'settled') && prev.round === st.round) {
      flyChip($(`#seat-${i} .who`), spot, now - before);
    }
    if (st.phase === 'settled' && prev.phase !== 'settled' && s.hands.length && s.net) {
      const n = Math.min(5, 1 + Math.floor(Math.abs(s.net) / 50));
      for (let k = 0; k < n; k++) {
        if (s.net > 0) flyChip(dealer, spot, Math.abs(s.net), 300 + k * 90, k === n - 1);
        else flyChip(spot, dealer, Math.abs(s.net), 300 + k * 90, k === n - 1);
      }
      if (s.net > 0 && s.playerId === S.myId) setTimeout(() => chipSound(5), 300 + n * 90);
    }
  });
}

// Big "You win / You lose" message over the table that fades away.
function showResult(st) {
  const { seat, isBanker } = myInfo(st);
  let net = null;
  if (isBanker) net = st.banker.net;
  else if (seat && seat.hands.length) net = seat.net;
  if (net === null || net === undefined) return;
  const el = document.createElement('div');
  el.className = 'result-pop ' + (net > 0 ? 'win' : net < 0 ? 'lose' : 'push');
  el.innerHTML = net > 0 ? `<small>You win</small><b>${money(net)}</b>` : net < 0 ? `<small>You lose</small><b>${money(-net)}</b>` : '<small>Push</small><b>Even</b>';
  const felt = document.body;
  // Wait for the last cards and chips to land first.
  setTimeout(() => {
    felt.appendChild(el);
    if (net > 0) chipSound(6);
    el.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.6)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.05)', offset: 0.12 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.75 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
    ], { duration: 3200, easing: 'ease-out', fill: 'forwards' }).onfinish = () => el.remove();
  }, Math.max(600, S.nextCardAt - performance.now() + 400));
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
    if (!S.cardAt.has(key)) {
      S.cardAt.set(key, null); // time is set after sorting this render's new cards
      S.pendingNew.push({ key, order: order || [0, 0] });
    }
    const at = S.cardAt.get(key);
    if (at === null || at > now - 50) { cls += ' pending'; extra = ` data-key="${key}"`; }
    // The dealer's hole card turns over in place.
    if (c.hidden) S.holeHidden.add(key);
    else if (S.holeHidden.has(key)) { S.holeHidden.delete(key); cls += ' flip'; setTimeout(cardSound, 0); }
  }
  if (c.hidden) return `<div class="${cls} back"${extra}></div>`;
  return `<div class="${cls} ${suitClass(c.s)}"${extra}><span class="rk">${c.r}</span><span class="st">${c.s}</span></div>`;
}

function runDealQueue() {
  const now = performance.now();
  // Deal in casino order: first card to each seat, then the dealer, then the second card.
  S.pendingNew.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  for (const p of S.pendingNew) {
    const at = Math.max(now, S.nextCardAt);
    S.cardAt.set(p.key, at);
    S.nextCardAt = at + DEAL_GAP;
  }
  S.pendingNew = [];
  const shoe = $('#shoe');
  document.querySelectorAll('.card.pending[data-key]').forEach((el) => {
    const at = S.cardAt.get(el.dataset.key);
    const delay = Math.max(0, at - performance.now());
    setTimeout(() => {
      if (!el.isConnected) return;
      const a = shoe?.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      el.classList.remove('pending');
      cardSound();
      if (!a) return;
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(-25deg) scale(.6)`, opacity: 0.6 },
        { transform: 'none', opacity: 1 },
      ], { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }, delay);
  });
}

function statusText(st) {
  const turnSeat = st.turn && st.seats[st.turn.seat];
  switch (st.phase) {
    case 'betting': return 'Place your bets';
    case 'insurance': return 'Dealer shows an ace. Insurance?';
    case 'playing': return turnSeat ? (turnSeat.playerId === S.myId ? 'Your turn' : `${turnSeat.name} is playing`) : '';
    case 'dealer': return 'Dealer is playing';
    case 'settled': return 'Round over. Place your next bet';
  }
  return '';
}

function myInfo(st) {
  const me = st.players.find((p) => p.id === S.myId);
  const seat = me && me.seat !== null ? st.seats[me.seat] : null;
  const isBanker = st.banker?.id === S.myId;
  return { me, seat, isBanker };
}

// Each person sees their own seat in the middle, with friends around them in table order.
function seatOrder(st) {
  const { me } = myInfo(st);
  const center = Math.floor(MAX_SEATS / 2);
  const shift = me && me.seat !== null ? me.seat - center : 0;
  return Array.from({ length: MAX_SEATS }, (_, pos) => (pos + shift + MAX_SEATS) % MAX_SEATS);
}

function feltHTML(st) {
  const d = st.dealer;
  const r = st.round;
  const { me, isBanker } = myInfo(st);
  const between = st.phase === 'betting' || st.phase === 'settled';
  const shoeTxt = st.settings.decks === 'csm' ? 'Randomized: shuffled every round' :
    `${st.settings.decks} deck${st.settings.decks > 1 ? 's' : ''} · ${st.shoe.left} cards left · ` +
    (st.settings.shuffleMode === 'rounds' ? `shuffle every ${st.settings.shuffleEvery} rounds` : `shuffle at ${st.settings.penetration}%`);
  const dealerTotal = d.cards.length ? `<span class="total">${d.total > 21 ? 'Bust ' + d.total : d.total + (d.soft && d.total < 21 ? ' soft' : '')}</span>` : '';
  const b = st.banker;
  let dealerSeat;
  if (b) {
    const net = b.net ? `<span class="net ${b.net > 0 ? 'up' : 'down'}">${b.net > 0 ? '+' : ''}${money(b.net)}</span>` : '';
    dealerSeat = `<div class="dealer-name">${esc(b.name)}${isBanker ? ' (you)' : ''} is the dealer <span class="chips">${money(b.chips)}</span> ${net}
</div>`;
  } else {
    dealerSeat = `<div class="dealer-name">Dealer: house (automatic)
      ${me && !st.vote ? '<button class="btn small gold" data-act="sit-dealer">Ask to be dealer</button>' : ''}</div>`;
  }
  const order = seatOrder(st);
  return `
    <div class="shoe-box"><div class="shoe" id="shoe"><div class="shoe-cards"></div><div class="shoe-fill" style="--fill:${Math.round(100 * st.shoe.left / (st.shoe.size || 1))}%"></div></div><div class="shoe-info">${shoeTxt}</div></div>
    <div class="dealer" id="dealer-zone">
      ${dealerSeat}
      <div class="cards">${d.cards.map((c, i) => cardHTML(c, true, `${r}-d-${i}`, [i, MAX_SEATS])).join('')}</div>
      <div class="dealer-total">${dealerTotal}</div>
    </div>
    <div class="arc-text">${isStrip(st.settings) ? 'Las Vegas Strip rules' : 'House rules'} · Blackjack pays ${st.settings.blackjackPays === 1.5 ? '3 to 2' : st.settings.blackjackPays + ' to 1'}</div>
    <div class="arc-text small">Dealer must draw to 16 and ${st.settings.dealerHitsSoft17 ? 'hit soft 17' : 'stand on all 17s'} · Insurance pays 2 to 1</div>
    <div class="status">${esc(statusText(st))} <span id="timer" class="timer" hidden></span></div>
    ${dealMeInHTML(st)}
    <div class="seats">${order.map((i, pos) => seatHTML(st, st.seats[i], i, pos)).join('')}</div>`;
}

// Big "Deal me in" button on the table once you have a bet down.
function dealMeInHTML(st) {
  const { seat, isBanker } = myInfo(st);
  if (isBanker || !seat || !(st.phase === 'betting' || st.phase === 'settled') || !seat.bet.main) return '';
  if (seat.ready) return `<div class="deal-me-in waiting"><span>Waiting for the others...</span><button class="btn small" data-act="ready">Not ready</button></div>`;
  return `<div class="deal-me-in"><button class="deal-btn" data-act="ready">Deal me in</button></div>`;
}

function seatHTML(st, s, i, pos) {
  const { me, isBanker } = myInfo(st);
  if (!s) {
    const canSit = me && me.seat === null && !isBanker;
    return `<div class="seat empty pos${pos}" id="seat-${i}">${spotAreaHTML(st, null, i, false, 0)}${canSit ? `<button class="btn small" data-act="sit" data-seat="${i}">Sit here</button>` : `<span>Seat ${i + 1}</span>`}</div>`;
  }
  const isMe = s.playerId === S.myId;
  const turn = st.turn && st.turn.seat === i;
  const hands = s.hands.map((h, j) => {
    const active = turn && st.turn.hand === j;
    const res = h.result ? `<span class="result ${h.result.toLowerCase()}">${h.result}</span>` : (h.blackjack ? '<span class="result blackjack">Blackjack</span>' : '');
    const total = h.cards.length ? `<span class="total">${h.total > 21 ? 'Bust ' + h.total : h.total + (h.soft && h.total < 21 ? ' soft' : '')}</span>` : '';
    return `<div class="hand ${active ? 'active' : ''}">
      <div class="cards fan">${h.cards.map((c, k) => cardHTML(c, false, `${st.round}-${i}-${j}-${k}`, [k + j * 10, i])).join('')}</div>
      <div class="meta">${total}${s.hands.length > 1 || h.doubled ? `<span>${money(h.bet)}${h.doubled ? ' x2' : ''}</span>` : ''}${res}</div>
    </div>`;
  }).join('');
  const sides = isMe && s.sideResults.length ? `<div class="side-results">${s.sideResults.map((r) =>
    `<div class="side-res ${r.win ? 'win' : ''}" title="${esc(r.label)}"><span>${esc(r.name)}: ${esc(r.label)}</span><b>${r.win ? '+' + money(r.pay - r.stake) : '-' + money(r.stake)}</b></div>`).join('')}</div>` : '';
  const net = st.phase === 'settled' && s.net !== null && s.hands.length ? `<div class="net ${s.net > 0 ? 'up' : s.net < 0 ? 'down' : ''}">${s.net > 0 ? 'Won ' + money(s.net) : s.net < 0 ? 'Lost ' + money(-s.net) : 'Even'}</div>` : '';
  const ready = st.phase === 'betting' && s.ready ? '<span class="ready-tag">Ready</span>' : '';
  const shownBet = s.hands.length ? s.hands.reduce((a, h) => a + h.bet, 0) : s.bet.main;
  return `<div class="seat pos${pos} ${isMe ? 'me' : ''} ${turn ? 'turn' : ''} ${s.connected ? '' : 'away'}" id="seat-${i}">
    ${hands}
    ${spotAreaHTML(st, s, i, isMe, shownBet)}
    ${sides}${net}
    <div class="who"><span class="name">${esc(s.name)}${isMe ? ' (you)' : ''}${s.connected ? '' : ' (away)'}</span><span class="chips">${money(s.chips)}</span>${ready}</div>
  </div>`;
}

// The main betting circle with the side bets in small circles around it.
function spotAreaHTML(st, s, i, isMe, mainAmt) {
  const canBet = isMe && (st.phase === 'betting' || st.phase === 'settled');
  const n = SIDE_KEYS.length;
  const sides = SIDE_KEYS.map((k, idx) => {
    const amt = s?.bet.sides[k] || 0;
    const res = s?.sideResults.find((r) => r.key === k);
    const tag = canBet ? 'button' : 'div';
    const angle = -90 + (360 / n) * idx + 180 / n;
    return `<${tag} class="sb ${amt ? 'on' : ''} ${res ? (res.win ? 'won' : 'lost') : ''}" ${canBet ? `data-act="side-spot" data-k="${k}"` : ''} id="sb-${i}-${k}" style="--a:${angle}deg" title="${esc(SIDE_BETS[k].name)}: ${esc(SIDE_BETS[k].about)}">
      <span class="sb-name">${SIDE_BETS[k].short}</span>${amt ? `<span class="sb-amt">${money(amt)}</span>` : ''}</${tag}>`;
  }).join('');
  const ins = s?.insurance ? `<span class="ins-tag">Insurance ${money(s.insurance)}</span>` : '';
  return `<div class="spot-area ${canBet ? 'live' : ''}">
    ${sides}
    <div class="spot" id="spot-${i}" ${canBet && mainAmt ? 'data-act="take-chip" title="Tap to take off your last chip"' : ''}>${stackHTML(mainAmt)}<span class="spot-amt">${mainAmt ? money(mainAmt) : ''}</span></div>
    ${ins}
  </div>`;
}

// The tray in the middle under the table: chips while betting, play buttons on your turn.
function trayHTML(st) {
  const { me, seat, isBanker } = myInfo(st);
  if (!me) return '';
  const ph = st.phase;
  if (isBanker) {
    return `<div class="tray-msg">You are the dealer. The cards are dealt by the fixed rules, and your ${money(st.banker.chips)} chips pay the winners and collect the losing bets.</div>
      ${st.phase === 'betting' || st.phase === 'settled' ? '<div class="actions"><button class="btn" data-act="leave-dealer">Leave dealer seat</button></div>' : ''}`;
  }
  if (!seat) {
    return `<div class="tray-msg">${S.role === 'host' ? 'You are hosting. Press "Sit here" to play, or "Ask to be dealer" to be the bank.' : 'Press "Sit here" on an empty seat to play, or "Ask to be dealer" to be the bank.'} You have ${money(me.chips)} chips.</div>`;
  }
  if (ph === 'betting' || ph === 'settled') {
    const b = seat.bet;
    return `
      <div class="tray-row">
        <div class="balance"><small>Balance</small><b>${money(me.chips - betTotal(b))}</b></div>
        <div class="chip-rack">
          <button class="icon-btn" data-act="undo" ${S.undo.length ? '' : 'disabled'} title="Undo your last chip"><span class="ico">↶</span>Undo</button>
          ${CHIPS.map((v) => `<button class="chipv ${chipClass(v)} ${S.chip === v ? 'sel' : ''}" data-act="chip" data-v="${v}" title="Bet ${v}"><span>${v}</span></button>`).join('')}
          <button class="icon-btn" data-act="double-bet" ${b.main ? '' : 'disabled'} title="Double all your bets"><span class="ico">×2</span>Double</button>
        </div>
        <div class="balance"><small>Total bet</small><b>${money(betTotal(b))}</b></div>
      </div>
      <div class="actions">
        <button class="btn" data-act="clear" ${betTotal(b) ? '' : 'disabled'}>Clear all</button>
        <button class="btn danger" data-act="stand-up">Leave seat</button>
      </div>
      <div class="hint tray-hint">Tap a chip to add it to your main bet (min ${st.settings.minBet}, max ${st.settings.maxBet}). Tap the middle of your bet to take the last chip off. Tap a small circle around your bet to add the last chip you picked as a side bet (at most ${st.settings.maxSideBet} each). Side bet payouts are under the button at the top.</div>`;
  }
  if (ph === 'insurance') {
    if (!seat.hands.length) return '<div class="tray-msg">You are sitting out this round.</div>';
    if (seat.insuranceDecided) return '<div class="tray-msg">Waiting for the other players to decide on insurance...</div>';
    const cost = Math.ceil(seat.bet.main / 2);
    return `<div class="tray-msg">The dealer shows an ace. Insurance costs <b>${money(cost)}</b> and pays 2 to 1 if the dealer has blackjack.</div>
      <div class="actions"><button class="btn primary big" data-act="ins" data-take="1">Take insurance</button><button class="btn big" data-act="ins" data-take="0">No thanks</button></div>`;
  }
  if (ph === 'playing') {
    if (!st.actions.length) return `<div class="tray-msg">${seat.hands.length ? 'Waiting for your turn...' : 'You are sitting out this round.'}</div>`;
    const labels = { hit: ['Hit', 'H'], stand: ['Stand', 'S'], double: ['Double', 'D'], split: ['Split', 'P'], surrender: ['Surrender', 'R'] };
    return `<div class="actions play">${['surrender', 'double', 'hit', 'stand', 'split'].map((a) =>
      `<button class="round-btn ${a}" data-act="play" data-a="${a}" ${st.actions.includes(a) ? '' : 'disabled'}><b>${labels[a][0]}</b><span class="kbd">${labels[a][1]}</span></button>`).join('')}</div>`;
  }
  return '<div class="tray-msg">The dealer is playing...</div>';
}

function controlsHTML() { return ''; }

function renderHostPanel(st) {
  const t = S.table;
  const ph = st.phase;
  const ready = t.seats.filter((s) => s && s.ready).length;
  const bettors = t.seats.filter((s) => s && s.bet.main > 0).length;
  $('#host-round').innerHTML = `
    <div class="actions" style="justify-content:flex-start">
      <button class="btn primary" data-act="h-deal" ${(ph === 'betting' || ph === 'settled') && bettors ? '' : 'disabled'}>Deal</button>
      <button class="btn" data-act="h-ins" ${ph === 'insurance' ? '' : 'disabled'}>Close insurance</button>
      <button class="btn" data-act="h-skip" ${ph === 'playing' ? '' : 'disabled'}>Stand for slow player</button>
      <button class="btn" data-act="h-shuffle" ${ph === 'betting' || ph === 'settled' ? '' : 'disabled'}>Shuffle now</button>
    </div>
    <div class="hint" style="margin-top:8px">${bettors} player${bettors === 1 ? '' : 's'} betting, ${ready} ready. ${t.settings.betTimer ? `The dealer deals on its own ${t.settings.betTimer} seconds after bets go down` : 'Press Deal to start the round'}${t.settings.autoDeal !== false ? ', or as soon as everyone is ready' : ''}.${t.settings.turnTimer ? ` Players get ${t.settings.turnTimer} seconds per move.` : ''}</div>`;
  $('#host-players').innerHTML = st.players.map((p) => `
    <div class="player-row">
      <div><b>${esc(p.name)}</b>${p.id === S.myId ? ' (you)' : ''}<br><span class="hint">${money(p.chips)} chips · ${p.seat === null ? 'not seated' : 'seat ' + (p.seat + 1)} · ${p.connected ? 'online' : 'away'}</span></div>
      <div class="tools">
        <button class="btn small" data-act="h-give" data-id="${p.id}" data-sign="1">Give</button>
        <button class="btn small" data-act="h-give" data-id="${p.id}" data-sign="-1">Take</button>
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
    <div class="settings-grid">
      <label class="full">Cards
        <select id="set-decks" ${dis}>
          ${[[1, '1 deck'], [2, '2 decks'], [6, '6 decks'], [8, '8 decks'], ['csm', 'Randomized (full shuffle every round)']].map(([v, l]) => `<option value="${v}" ${String(s.decks) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <label class="full">When to reshuffle
        <select id="set-mode" ${dis}>
          <option value="penetration" ${s.shuffleMode === 'penetration' ? 'selected' : ''}>After a share of the shoe is used</option>
          <option value="rounds" ${s.shuffleMode === 'rounds' ? 'selected' : ''}>Every few rounds</option>
        </select></label>
      <label>Reshuffle at <span id="pen-val">${s.penetration}%</span> used
        <input id="set-pen" type="range" min="20" max="95" step="5" value="${s.penetration}" ${dis} /></label>
      <label>Or every N rounds<input id="set-every" type="number" min="1" max="50" value="${s.shuffleEvery}" ${dis} /></label>
      <label>Starting chips<input id="set-start" type="number" min="1" value="${s.startChips}" ${dis} /></label>
      <label>Max side bet<input id="set-maxside" type="number" min="0" value="${s.maxSideBet}" ${dis} /></label>
      <label>Min bet<input id="set-min" type="number" min="1" value="${s.minBet}" ${dis} /></label>
      <label>Max bet<input id="set-max" type="number" min="1" value="${s.maxBet}" ${dis} /></label>
      <label class="check full"><input id="set-h17" type="checkbox" ${s.dealerHitsSoft17 ? 'checked' : ''} ${dis} /> Dealer hits soft 17</label>
      <label class="check full"><input id="set-sur" type="checkbox" ${s.allowSurrender ? 'checked' : ''} ${dis} /> Allow surrender (get half your bet back)</label>
      <div class="full" style="font-weight:700;color:var(--text);margin-top:4px">Automatic dealer</div>
      <label class="check full"><input id="set-auto" type="checkbox" ${s.autoDeal !== false ? 'checked' : ''} ${dis} /> Deal as soon as everyone is ready</label>
      <label>Betting time<select id="set-bettimer" ${dis}>${timerOpts(s.betTimer)}</select></label>
      <label>Time per move<select id="set-turntimer" ${dis}>${timerOpts(s.turnTimer)}</select></label>
      <div class="hint full">When betting time runs out, the dealer deals to everyone with a bet (last round's bet stays on unless changed). When time per move runs out, the dealer stands for that player.</div>
      <button class="btn full" data-act="h-strip" ${dis}>Reset to Las Vegas Strip rules</button>
      <button class="btn primary full" data-act="h-settings" ${dis}>Save settings</button>
      <div class="hint full">${locked ? 'Settings unlock when the round ends.' : 'Starting chips apply to new players. Changing the number of decks reshuffles.'}</div>
    </div>`;
  $('#set-pen').addEventListener('input', (e) => ($('#pen-val').textContent = e.target.value + '%'));
}

// Classic Las Vegas Strip rules: 4+ decks, dealer stands on all 17s, 3 to 2 blackjack,
// double any two cards and after splits, split to 4 hands, aces split once, late surrender.
function isStrip(s) {
  return (s.decks === 'csm' || Number(s.decks) >= 4) && !s.dealerHitsSoft17 && s.blackjackPays === 1.5 && s.allowSurrender;
}
function timerOpts(v) {
  return [[0, 'Off'], [10, '10 seconds'], [15, '15 seconds'], [20, '20 seconds'], [30, '30 seconds'], [45, '45 seconds'], [60, '60 seconds']]
    .map(([x, l]) => `<option value="${x}" ${Number(v) === x ? 'selected' : ''}>${l}</option>`).join('');
}

function rulesHTML() {
  return `<h2 style="margin-top:0">Side bets</h2><div class="paytable">
    <div class="hint">Payouts are "to 1": a 10 chip bet that pays 25 to 1 wins 250 and you get your 10 back. There is no rake or fee.</div>
    ${SIDE_KEYS.map((k) => {
      const sb = SIDE_BETS[k];
      return `<div><h4>${sb.name}</h4><p>${esc(sb.about)}</p><table>${sb.table.map(([l, m]) => `<tr><td>${esc(l)}</td><td>${m} to 1</td></tr>`).join('')}</table></div>`;
    }).join('')}
    <div><h4>Insurance</h4><p>Offered when the dealer shows an ace. Costs half your main bet.</p><table><tr><td>Dealer has blackjack</td><td>2 to 1</td></tr></table></div>
    <div><h4>Main game</h4><p>Blackjack pays 3 to 2. Double on any first two cards, also after a split. Split up to 4 hands; split aces get one card each. Surrender gives back half your bet when the host allows it.</p></div>
  </div>`;
}

// ---------- Clicks ----------
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const st = S.state;
  const me = st?.players.find((p) => p.id === S.myId);
  const seat = me && me.seat !== null ? st.seats[me.seat] : null;
  const bet = seat ? structuredClone(seat.bet) : { main: 0, sides: {} };
  const sendBet = (ready = false) => send({ t: 'bet', main: bet.main, sides: bet.sides, ready });
  switch (act) {
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
    case 'four': document.body.classList.toggle('four-colour'); safeSet('bj-four', document.body.classList.contains('four-colour') ? '1' : '0'); break;
    case 'sit': send({ t: 'sit', seat: Number(el.dataset.seat) }); break;
    case 'stand-up': send({ t: 'stand-up' }); break;
    case 'chip': {
      S.chip = Number(el.dataset.v);
      if (!seat) { render(); break; }
      S.undo.push(structuredClone(seat.bet));
      bet.main += S.chip;
      S.mainChips.push(S.chip);
      flyChip(el, $(`#spot-${me.seat}`), S.chip);
      sendBet();
      break;
    }
    case 'side-spot': {
      const k = el.dataset.k;
      S.undo.push(structuredClone(seat.bet));
      bet.sides[k] = (bet.sides[k] || 0) + S.chip;
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
    case 'undo': if (S.undo.length) { S.mainChips.pop(); const last = S.undo.pop(); send({ t: 'bet', main: last.main, sides: last.sides, ready: false }); chipSound(); } break;
    case 'double-bet': {
      S.undo.push(structuredClone(seat.bet));
      S.mainChips = S.mainChips.concat(S.mainChips);
      bet.main *= 2;
      for (const k in bet.sides) bet.sides[k] *= 2;
      flyChip($(`.chip-rack [data-v="${S.chip}"]`), $(`#spot-${me.seat}`), S.chip);
      sendBet();
      break;
    }
    case 'menu': $('#menu-wrap').classList.toggle('open'); break;
    case 'mute': setMuted(!isMuted()); el.textContent = isMuted() ? 'Sound: off' : 'Sound: on'; if (!isMuted()) chipSound(); break;
    case 'sit-dealer': send({ t: 'sit-dealer' }); break;
    case 'leave-dealer': send({ t: 'leave-dealer' }); break;
    case 'side-clear': delete bet.sides[el.dataset.k]; sendBet(); break;
    case 'clear': S.mainChips = []; S.undo.push(structuredClone(seat.bet)); bet.main = 0; bet.sides = {}; sendBet(); chipSound(2); break;
    case 'ready': sendBet(!seat.ready); break;
    case 'ins': send({ t: 'insurance', take: el.dataset.take === '1' }); break;
    case 'play': send({ t: 'action', a: el.dataset.a }); break;
    // Host only
    case 'h-deal': hostDo((t) => t.deal()); break;
    case 'h-ins': hostDo((t) => t.forceInsurance()); break;
    case 'h-skip': hostDo((t) => t.skipTurn()); break;
    case 'h-shuffle': hostDo((t) => t.newShoe()); break;
    case 'h-give': {
      const amt = Math.abs(Number($('#give-amt').value) || 0) * Number(el.dataset.sign);
      hostDo((t) => t.giveChips(el.dataset.id, amt));
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
      hostDo((t) => t.updateSettings({ decks: 6, dealerHitsSoft17: false, allowSurrender: true, blackjackPays: 1.5, shuffleMode: 'penetration', penetration: 75 }));
      S.settingsKey = '';
      toast('Las Vegas Strip rules set.');
      break;
    case 'h-settings': {
      const v = (id) => $('#' + id).value;
      const decks = v('set-decks') === 'csm' ? 'csm' : Number(v('set-decks'));
      hostDo((t) => t.updateSettings({
        decks, shuffleMode: v('set-mode'), penetration: Number(v('set-pen')), shuffleEvery: Number(v('set-every')),
        startChips: Number(v('set-start')), minBet: Number(v('set-min')), maxBet: Number(v('set-max')), maxSideBet: Number(v('set-maxside')),
        dealerHitsSoft17: $('#set-h17').checked, allowSurrender: $('#set-sur').checked, autoDeal: $('#set-auto').checked,
        betTimer: Number(v('set-bettimer')), turnTimer: Number(v('set-turntimer')),
      }));
      S.settingsKey = '';
      toast('Settings saved.');
      break;
    }
  }
});

// Close the menu when clicking anywhere else.
document.addEventListener('click', (e) => {
  const w = $('#menu-wrap');
  if (w && !w.contains(e.target)) w.classList.remove('open');
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const map = { h: 'hit', s: 'stand', d: 'double', p: 'split', r: 'surrender' };
  const a = map[e.key.toLowerCase()];
  if (a && S.state?.actions?.includes(a)) send({ t: 'action', a });
});

// ---------- Start ----------
if (params.get('host') && safeGet('bj-host')) {
  // The host refreshed the page: reopen the same table.
  if (S.name) {
    showLanding();
    startHost(true);
  } else showLanding();
} else {
  showLanding();
}
