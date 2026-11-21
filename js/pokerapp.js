// The poker page: a Texas Hold'em table for up to 9 in the big meeting room. The host's browser runs
// the table (js/poker.js); every other browser sends its moves there and is told only what it may see.
import { PokerTable, POKER_SEATS, pokerDeck, cardText } from './poker.js?v=20261121j';
import { sha256 } from './game.js?v=20261121j';
import { webglOK, initRoom } from './room3d.js?v=20261121j';
import { params, $, safeGet, safeSet, safeDel, getClientId, getLook, esc, money, newCode, randomHex, toast, modal, cardHTML, gameSwitchHTML, wireGameSwitch, createHost, createGuest } from './common.js?v=20261121j';

const PREFIX = 'bjt-pk-';
const app = $('#app');
const S = { name: safeGet('bj-name') || '', myId: getClientId(), code: null, role: null, table: null, st: null, net: null, room: null,
  conn: ['Connecting', false], raiseTo: null, raiseFor: '', seedFor: '', boardSeen: { hand: -1, n: 0 }, doneAt: 0, started: false, paused: false, at: 0, goneAt: {}, autoAway: {} };
if (params.has('roomdebug')) window.__P = S;
const phone = () => innerWidth < 700;
const bbOn = () => safeGet('pk-bb') === '1';
// An amount as chips, or in big blinds when the player switched that view on.
function amt(n) { const bb = S.st?.settings?.bigBlind; if (!bbOn() || !bb) return money(n); const v = n / bb; return (Math.round(v * 10) / 10).toLocaleString() + ' BB'; }
const PHONE_FLAT = true;
// A phone opens the flat table unless the 3D room was switched on in the menu; a computer opens the 3D room unless it was switched off.
const use3D = () => { if (params.get('flat') === '1' || !webglOK()) return false; if (params.get('3d') === '1') return true; const v = safeGet('bj-3d'); return PHONE_FLAT && phone() ? v === '1' : v !== '0'; };

// ---------- Landing ----------
function showLanding(note = '') {
  const room = params.get('room');
  let savedCode = null;
  try { savedCode = JSON.parse(safeGet('pk-host') || 'null')?.code; } catch {}
  document.body.classList.remove('in-room', 'room3d');
  app.innerHTML = `
    <div class="landing">
      <div class="game-switch-row">${gameSwitchHTML('poker')}</div>
      <div class="hero-cards">${cardHTML({ r: 'A', s: '♠' }, 'big')}${cardHTML({ r: 'A', s: '♥' }, 'big')}</div>
      <h1>Poker Room</h1>
      <p>${room ? `You were invited to poker table <b>${esc(room)}</b>. Pick a name and join.` : "No limit Texas Hold'em for up to 9 friends. Host a table and send the link. Play money only."}</p>
      ${note ? `<p class="hint">${esc(note)}</p>` : ''}
      <div class="box">
        <label for="name">Your name</label>
        <input id="name" maxlength="16" value="${esc(S.name)}" placeholder="Name" />
        ${room ? '<button class="btn primary big" data-act="join">Join the table</button>' : `
        <button class="btn primary big" data-act="host">Host a table</button>
        ${savedCode ? `<button class="btn" data-act="resume">Reopen my table ${esc(savedCode)}</button>` : ''}
        <div class="or">or join with a code</div>
        <div class="row"><input id="code" maxlength="12" placeholder="Table code" /><button class="btn" data-act="join">Join</button></div>`}
      </div>
    </div>`;
}
function takeName() {
  const n = ($('#name')?.value || S.name || '').replace(/[<>]/g, '').trim().slice(0, 16);
  if (!n) { toast('Type your name first.'); return false; }
  S.name = n; safeSet('bj-name', n);
  return true;
}

// ---------- Host ----------
function startHost(code, resume) {
  S.role = 'host'; S.code = code;
  let saved = null;
  try { saved = JSON.parse(safeGet('pk-host') || 'null'); } catch {}
  if (resume && saved && saved.code === code && saved.table) { S.table = PokerTable.restore(saved.table); S.started = S.table.handNo > 0; }
  else S.table = new PokerTable();
  const t = S.table;
  for (const p of Object.values(t.players)) p.connected = false;
  t.hostId = S.myId;
  t.join(S.myId, S.name, getLook());
  openHost(code);
  history.replaceState(null, '', shareLink());
  showTable();
  push();
}
function openHost(code) {
  S.net = createHost(PREFIX + code, {
    msg: hostMsg,
    gone: (id) => { S.table?.disconnect(id); S.goneAt[id] = Date.now(); push(); },
    status: (text, ok) => { S.conn = [text, ok]; drawConn(); },
    taken: () => { // someone already runs this table (your own other tab, or a player who took the table over): join it instead
      S.net.close(); clearInterval(S.clock); S.table = null; startGuest(code, true);
    },
  });
  clearInterval(S.clock);
  S.clock = setInterval(hostClock, 400);
}
// The cards and the secret word of this browser's own hand, kept so they survive a reload and a move of the table.
function keepMine(st) {
  const x = st.seats.find((q) => q && q.id === S.myId);
  if (!x || !x.inHand || !x.cards[0] || !x.cards[1] || !st.mySalt) return;
  const k = S.code + '#' + st.handNo;
  if (S.mineKey === k + st.mySalt) return;
  S.mineKey = k + st.mySalt;
  safeSet('pk-mine', JSON.stringify({ k, cards: x.cards, salt: st.mySalt }));
}
function myKept(st) {
  try { const m = JSON.parse(safeGet('pk-mine') || 'null'); return m && m.k === S.code + '#' + st.handNo ? m : null; } catch { return null; }
}
// The host's browser is gone: this browser takes the table over from what it was last told, and the hand goes on.
function takeOver() {
  const st = S.st;
  if (!st || S.role !== 'guest') return;
  try { S.net.close(); } catch {}
  const t = PokerTable.fromPublic(st, S.myId, myKept(st));
  const oldHost = st.hostId, oldName = st.players.find((p) => p.id === oldHost)?.name || 'The host';
  t.join(S.myId, S.name, getLook());
  t.addLog(`${oldName}'s browser left. The table now runs in ${S.name}'s browser${t.inHand() ? ' and the hand goes on' : ''}.`);
  const now = Date.now();
  for (const p of Object.values(t.players)) if (p.id !== S.myId) S.goneAt[p.id] = now;
  S.role = 'host'; S.table = t; S.started = st.handNo > 0; S.paused = false; S.doneAt = 0;
  // Players still in the hand get a few seconds to hand in their cards before anyone can act.
  S.waitFor = t.missingCards().map((i) => t.seats[i].id).filter((id) => id !== oldHost);
  S.waitUntil = now + 12000;
  t.waitCards = S.waitFor.length > 0;
  openHost(S.code);
  toast('The host left. The table now runs in your browser.');
  push();
}
function watchHost() {
  const st = S.st;
  if (!st || S.role !== 'guest' || S.takeT || params.get('takeover') === '0') return;
  const list = st.players.filter((p) => p.connected && p.id !== st.hostId).sort((a, b) => (a.seat < 0 ? 99 : a.seat) - (b.seat < 0 ? 99 : b.seat) || (a.id < b.id ? -1 : 1));
  let rank = list.findIndex((p) => p.id === S.myId);
  if (rank < 0) rank = list.length;
  S.takeT = setTimeout(() => { S.takeT = null; if (S.role === 'guest' && S.nohost) takeOver(); }, 1500 + rank * 4000);
}
function hostMsg(id, m) {
  const t = S.table;
  if (!t) return;
  try {
    if (m.t === 'hello') { if (t.players[id]?.kicked) { S.net.send(id, { t: 'kicked' }); return; } t.join(id, m.name, m.look); if (m.mine) t.giveCards(id, m.mine.cards, m.mine.salt); delete S.goneAt[id]; if (S.autoAway[id]) { delete S.autoAway[id]; t.sitOut(id, false); } }
    else if (!t.players[id] || t.players[id].kicked) return;
    else doMove(id, m);
  } catch (e) { S.net.send(id, { t: 'err', msg: e.message }); }
  push();
}
// One player's request, checked by the table itself.
function doMove(id, m) {
  const t = S.table;
  switch (m.t) {
    case 'sit': t.sit(id, Number(m.seat), m.buyIn); break;
    case 'stand': t.standUp(id); break;
    case 'act': if (t.waitCards) throw new Error('One moment: the table just moved to a new host.'); t.act(id, m.a, m.amount); break;
    case 'cards': t.giveCards(id, m.cards, m.salt); break;
    case 'away': t.sitOut(id, !!m.on); break;
    case 'add': t.addChips(id, m.amount); break;
    case 'take': t.takeChips(id, m.amount); break;
    case 'vaway': t.voteAway(id, String(m.id), !!m.on); break;
    case 'fx': relayFx(id, m.e); break;
    case 'show': t.showCards(id, m.which); break;
    case 'rabbit': t.rabbitHunt(id); break;
    case 'straddle': t.setStraddle(id, !!m.on); break;
    case 'runs': t.setRuns(id, m.n); break;
    case 'seed': t.setClientSeed(id, m.seed, m.commit); break;
    default: break;
  }
}
const EMOJI = ['😂', '😭', '😡', '🤡', '🔥', '💀', '👏', '🙏', '🤑', '🐟', '🦈', '💩', '🫡', '🤯', '😴', '🍀'];
// A reaction pops up over the seat of the player who sent it, on every screen.
function relayFx(id, e) {
  if (!EMOJI.includes(e)) return;
  const now = Date.now(), last = (S.fxAt ||= {});
  if (now - (last[id] || 0) < 150) return;
  last[id] = now;
  for (const pid of S.net.ids()) S.net.send(pid, { t: 'fx', from: id, e });
  showFx(id, e);
}
function showFx(fromId, e) {
  const box = $('#pk-fx'), st = S.st;
  if (!box || !st) return;
  const i = st.seats.findIndex((x) => x && x.id === fromId);
  const P = i >= 0 ? toward(seatLayout(st).at(i), 0.8) : { x: 50, y: 50 };
  const el = document.createElement('div');
  el.className = 'pk-fx pk-stand'; el.textContent = e;
  el.style.left = P.x + (Math.random() * 6 - 3) + '%'; el.style.top = P.y + '%';
  box.append(el);
  setTimeout(() => el.remove(), 2300);
}
function push() {
  const t = S.table;
  if (!t) return;
  for (const id of S.net.ids()) S.net.send(id, { t: 'state', st: t.publicState(id) });
  S.st = t.publicState(S.myId);
  keepMine(S.st);
  S.at = Date.now();
  try { safeSet('pk-host', JSON.stringify({ code: S.code, table: { ...t, log: t.log.slice(-60), hist: t.hist.slice(-40) } })); } catch {}
  render();
}
function hostClock() {
  const t = S.table;
  if (!t) return;
  const now = Date.now();
  if (t.waitCards) {
    const miss = t.missingCards().map((i) => t.seats[i].id);
    if (!t.inHand() || now > S.waitUntil || !(S.waitFor || []).some((id) => miss.includes(id))) { t.waitCards = false; t.turnStarted = now; push(); }
    return;
  }
  if (t.inHand()) {
    S.doneAt = 0;
    if (t.turn !== null) {
      const id = t.seats[t.turn].id, away = t.players[id]?.connected === false;
      let limit = t.settings.turnTimer;
      // A player whose connection dropped gets 45 more seconds to come back before the table acts for them.
      // Once the table has acted for them in this way, their later turns take 3 seconds until they are back.
      if (away) limit = S.autoAway[id] ? 3 : (limit || 30) + 45;
      else if (limit) limit += t.seats[t.turn].bank || 0; // a player who is here also has their own time bank
      if (limit && now - (t.turnStarted || now) > limit * 1000) {
        t.timeout(id);
        t.sitOut(id, true); // away until they come back, so the next hands do not wait for them
        if (away) S.autoAway[id] = true;
        push();
      }
    }
    return;
  }
  if (S.pendingSettings) { try { t.updateSettings(S.pendingSettings); } catch {} S.pendingSettings = null; push(); }
  if (t.phase === 'done' && !S.doneAt) S.doneAt = now;
  // Before a deal: a player whose browser has been gone for 40 seconds is marked away, so no blinds are taken
  // from them. They keep the seat and the chips, and are back in as soon as their browser returns.
  for (const x of t.seats) {
    if (!x || x.out) continue;
    const gone = S.goneAt[x.id];
    if (t.players[x.id]?.connected === false && gone && now - gone > 40000) { t.sitOut(x.id, true); S.autoAway[x.id] = true; t.addLog(`${t.players[x.id].name} is offline and was marked away.`); push(); }
  }
  if (!S.started || S.paused || !t.settings.autoStart || !t.canStart()) return;
  const r = t.result;
  const wait = t.phase === 'done' ? 4500 + (r?.showdown ? 2500 : 0) + (r?.runout ? (r.runout.length + (r.boards ? r.boards.length : 1)) * stepMs() : 0) : 800;
  if (now - (S.doneAt || 0) >= wait) { t.startHand(); S.doneAt = 0; push(); }
}

// ---------- Guest ----------
function startGuest(code, again) {
  S.role = 'guest'; S.code = code; S.st = null; S.nohost = false;
  history.replaceState(null, '', shareLink());
  if (!again || !$('#pk-body')) showTable(); else render();
  const mineNow = () => { try { const m = JSON.parse(safeGet('pk-mine') || 'null'); return m && String(m.k).startsWith(code + '#') ? { cards: m.cards, salt: m.salt } : undefined; } catch { return undefined; } };
  S.net = createGuest(PREFIX + code, () => ({ t: 'hello', id: S.myId, name: S.name, look: getLook(), mine: mineNow() }), {
    msg: (m) => {
      if (m.t === 'state') {
        const st = m.st;
        clearTimeout(S.takeT); S.takeT = null;
        // After a move of the table the new host does not know this browser's cards until they are handed in.
        const x = st.seats.find((q) => q && q.id === S.myId);
        if (x && x.inHand && x.cards.length === 2 && !x.cards[0]) { const k = myKept(st); if (k) { x.cards = k.cards; S.net.send({ t: 'cards', cards: k.cards, salt: k.salt }); } }
        if (S.st && st.hostId !== S.st.hostId) toast(`The table now runs in ${st.players.find((p) => p.id === st.hostId)?.name || 'another player'}'s browser.`);
        S.st = st; keepMine(st); S.at = Date.now(); S.nohost = false; render(); sendSeed();
      }
      else if (m.t === 'err') toast(m.msg);
      else if (m.t === 'fx') showFx(m.from, m.e);
      else if (m.t === 'kicked') { S.net.close(); showLanding('The host removed you from the table.'); }
    },
    status: (text, ok) => { S.conn = [text, ok]; drawConn(); },
    nohost: () => { S.nohost = true; if (!S.st) render(); else watchHost(); },
  });
}
// A fresh seed of this browser for every hand, sent once the host's promise for that hand is seen.
function sendSeed() {
  const c = S.st?.fair?.nextCommit;
  if (!c || S.seedFor === c || S.role !== 'guest') return;
  if (S.net.send({ t: 'seed', seed: randomHex(16), commit: c })) S.seedFor = c;
}
// A move of this browser: straight to the table for the host, over the link for everyone else.
function send(m) {
  if (S.role === 'host') { try { doMove(S.myId, m); } catch (e) { toast(e.message); } push(); }
  else if (!S.net?.send(m)) toast('Not connected to the host right now.');
}
function shareLink() {
  const q = new URLSearchParams();
  q.set('room', S.code);
  for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure']) if (params.get(k)) q.set(k, params.get(k));
  return location.origin + location.pathname + '?' + q.toString();
}

// ---------- The table page ----------
// The felt's size in pixels. On a phone it is upright; the flat phone table is as tall as the screen leaves above the buttons.
const FELT = () => {
  if (!phone()) return { W: 1240, H: 600 };
  const W = Math.max(300, Math.min(440, innerWidth - 20));
  return { W, H: use3D() ? 640 : Math.max(380, Math.min(640, innerHeight - 56 - 345)) };
};
function showTable() {
  document.body.classList.add('in-room');
  const d3 = use3D();
  app.innerHTML = `
    <div class="topbar">
      ${gameSwitchHTML('poker')}
      <span id="conn-pill" class="pill">Connecting</span>
      <span class="spacer"></span>
      <button class="pill fair-pill" data-act="fair" title="How the deck is kept fair">🔐<span class="fp-t"> Fair deck</span></button>
      <button class="btn small gold" data-act="copy">🔗 Invite</button>
      <div class="menu-wrap" id="menu-wrap">
        <button class="hamburger" data-act="menu" aria-label="Menu"><span></span><span></span><span></span></button>
        <div class="menu" id="menu"><div class="menu-items" id="menu-items"></div></div>
      </div>
    </div>
    <div class="main player"><div>
      ${d3 ? '<div class="room" id="room"><div class="felt pfelt" id="felt"></div></div><div class="hud3d" id="hud3d"><div class="hud-top" id="hud-top"></div><div class="tray pk-tray" id="tray"></div></div>'
        : '<div class="pk-stage" id="stage"><div class="felt pfelt" id="felt"></div></div><div class="pk-flat-hud"><div class="hud-top" id="hud-top"></div><div class="tray pk-tray" id="tray"></div></div>'}
    </div></div>`;
  const felt = $('#felt'), F = FELT();
  felt.innerHTML = '<div class="pk-body" id="pk-body"></div><div class="pk-body pk-fxs" id="pk-fx"></div>';
  felt.style.width = F.W + 'px'; felt.style.height = F.H + 'px';
  felt.classList.toggle('tall', F.H > F.W);
  if (d3) {
    document.body.classList.add('room3d');
    try {
      S.room = initRoom($('#room'), felt, { phone: phone(), pixel: safeGet('bj-pixel') === '1', hud: $('#hud3d'), size: F, game: 'poker', metres: F.H > F.W ? 2.0 * F.W / F.H : 2.4 });
      if (params.has('roomdebug')) window.__room = S.room;
      if (S.tourFor !== S.code) { S.tourFor = S.code; S.room.tour(2000); }
    } catch (e) { console.error(e); S.room = null; document.body.classList.remove('room3d'); toast('The 3D room could not start on this device.'); }
  }
  drawConn();
  render();
}
function drawConn() {
  const el = $('#conn-pill');
  if (!el) return;
  el.textContent = S.conn[0]; el.className = 'pill ' + (S.conn[1] ? 'live' : 'off');
}

// Places for the nine seats: equal steps along the table's edge, starting at the bottom middle (your own
// seat) and going round the way the deal goes. Each is { x, y } in percent of the felt.
function seatSpots(W, H) {
  const r = Math.min(W, H) / 2, wide = W >= H, L = Math.abs(W - H) / 2, pts = [];
  const N = 720, per = 4 * L + 2 * Math.PI * r;
  // Walk the edge from the bottom middle towards the left (clockwise seen from above).
  const at = (d) => {
    d = ((d % per) + per) % per;
    // Wide table, starting bottom middle going left: straight L, half circle (pi r), straight 2L, half circle, straight L.
    if (wide) {
      if (d <= L) return [-d, r];
      d -= L; if (d <= Math.PI * r) { const a = d / r; return [-L - Math.sin(a) * r, Math.cos(a) * r]; }
      d -= Math.PI * r; if (d <= 2 * L) return [-L + d, -r];
      d -= 2 * L; if (d <= Math.PI * r) { const a = d / r; return [L + Math.sin(a) * r, -Math.cos(a) * r]; }
      d -= Math.PI * r; return [L - d, r];
    }
    // Tall table: half of the bottom half circle, the left side, the top half circle, the right side, the rest.
    const q = (Math.PI * r) / 2;
    if (d <= q) { const a = d / r; return [-Math.sin(a) * r, L + Math.cos(a) * r]; }
    d -= q; if (d <= 2 * L) return [-r, L - d];
    d -= 2 * L; if (d <= Math.PI * r) { const a = d / r; return [-Math.cos(a) * r, -L - Math.sin(a) * r]; }
    d -= Math.PI * r; if (d <= 2 * L) return [r, -L + d];
    d -= 2 * L; { const a = d / r; return [Math.cos(a) * r, L + Math.sin(a) * r]; }
  };
  for (let k = 0; k < POKER_SEATS; k++) { const [x, y] = at((k / POKER_SEATS) * per); pts.push({ x: 50 + (x / W) * 100, y: 50 + (y / H) * 100 }); }
  void N;
  return pts;
}
const toward = (p, f) => ({ x: 50 + (p.x - 50) * f, y: 50 + (p.y - 50) * f });

// The badge under the board: what your own hand is right now, in its own colour by strength.
const RANKS_UI = [['Royal flush', 9, '👑'], ['Straight flush', 8, '⚡'], ['Four', 7, '💎', 'Quads'], ['Full house', 6, '🏠'], ['Flush', 5, '🌊'], ['Straight', 4, '📏'], ['Three', 3, '🔱', 'Trips'], ['Two pair', 2, '✌️'], ['Pair', 1, '👥'], ['', 0, '🂠', 'High card']];
function rankBadge(seat) {
  if (!seat || !seat.hand || !seat.inHand || seat.folded) return '';
  const parts = seat.hand.split(' | ');
  if (parts.length > 1) return `<div class="pk-rank pk-stand two t${Math.max(...parts.map((h) => RANKS_UI.find((r) => h.startsWith(r[0]))[1]))}">${parts.map((h, k) => { const [key, , icon, label] = RANKS_UI.find((r) => h.startsWith(r[0])); return `<b>${icon} Board ${k + 1}: ${label || key}</b><small>${esc(h)}</small>`; }).join('')}</div>`;
  const [key, tier, icon, label] = RANKS_UI.find((r) => seat.hand.startsWith(r[0]));
  const title = label || key, rest = seat.hand.replace(/^(Royal flush|Straight flush|Full house|Flush|Straight|Two pair),?\s*/, '').replace(/^Four /, '').replace(/^Three /, '').replace(/^Pair of /, '');
  return `<div class="pk-rank pk-stand t${tier}"><b>${icon} ${title}</b>${rest && rest !== seat.hand || tier === 0 || tier === 1 || tier === 3 || tier === 7 ? `<small>${esc(rest)}</small>` : ''}</div>`;
}
const stepMs = () => Number(params.get('step')) || { fast: 1100, normal: 1900, long: 3200 }[(S.st || S.table)?.settings?.showSpeed] || 1100; // an all in board comes one step at a time, this many milliseconds apart
// Where an all in showdown is in its show: which cards are out, whose chances to print, and whether the winners are known yet.
function runStage(st) {
  const ro = st.phase === 'done' && st.result?.runout ? st.result.runout : null;
  if (!ro) return null;
  const R = st.result.boards && !st.result.dbl ? st.result.boards.length : 1, last = ro.length + R - 1;
  if (S.run?.hand !== st.handNo) {
    S.run = { hand: st.handNo, t0: Date.now() };
    for (let k = 1; k <= last; k++) setTimeout(render, k * stepMs() + 40);
  }
  const k = Math.min(last, Math.floor((Date.now() - S.run.t0) / stepMs()));
  return { k, last, final: k >= last, n: k < ro.length ? ro[k].n : 5, odds: k < ro.length ? ro[k] : null, boards: k < ro.length ? 1 : Math.min(R, 1 + k - ro.length + (k >= last ? 1 : 0)) };
}
// The usual numbers under a name. VPIP: share of hands where the player put chips in by choice before the flop.
// PFR: share of hands the player raised before the flop.
const pc = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function statLine(t) {
  if (!t || !t.hands) return '';
  return `<small class="pk-stats" title="VPIP: hands with chips put in by choice before the flop. PFR: hands raised before the flop."><i>VPIP ${pc(t.vpip, t.pre)}</i><i>PFR ${pc(t.pfr, t.pre)}</i><i>${t.hands} hand${t.hands === 1 ? '' : 's'}</i></small>`;
}
function statsHTML(t) {
  if (!t || !t.hands) return '<p class="hint">No hands played yet.</p>';
  return `<table class="pk-table"><tr><td>Hands dealt</td><td>${t.hands}</td></tr><tr><td>VPIP (put chips in by choice before the flop)</td><td>${pc(t.vpip, t.pre)}%</td></tr><tr><td>PFR (raised before the flop)</td><td>${pc(t.pfr, t.pre)}%</td></tr><tr><td>Went to showdown</td><td>${pc(t.sd, t.hands)}%</td></tr><tr><td>Won at showdown</td><td>${pc(t.wsd, t.sd)}%</td></tr><tr><td>Hands won</td><td>${pc(t.won, t.hands)}%</td></tr></table>`;
}
function seatLayout(st) {
  const F = FELT(), spots = seatSpots(F.W, F.H);
  const mySeat = st.seats.findIndex((x) => x && x.id === S.myId);
  const rel = (i) => (i - Math.max(0, mySeat) + POKER_SEATS) % POKER_SEATS;
  return { mySeat, at: (i) => spots[rel(i)] };
}
function render() {
  const body = $('#pk-body');
  if (!body) return;
  const st = S.st;
  if (!st) {
    body.innerHTML = `<div class="pk-wait pk-stand">${S.nohost ? (params.get('open') ? 'Opening the table…' : 'The poker table is not open yet. Waiting for the host…') : 'Joining the table…'}</div>`;
    $('#tray').innerHTML = ''; $('#hud-top').innerHTML = '';
    return;
  }
  const { mySeat, at } = seatLayout(st);
  const stage = runStage(st);
  const showing = stage && !stage.final; // an all in board is still coming out
  const done = st.phase === 'done' && !showing, live = st.phase !== 'done' && st.phase !== 'waiting';
  const winBy = {};
  if (done) for (const w of st.result?.wins || []) winBy[w.seat] = (winBy[w.seat] || 0) + w.amount;
  const dbl = !!st.dbl;
  const allBoards = dbl ? [st.board, st.board2 || []] : st.result?.boards || [st.board];
  const boards = dbl ? allBoards.map((b) => (stage ? b.slice(0, stage.n) : b)) : stage ? allBoards.slice(0, stage.boards).map((b, r) => (r === 0 ? b.slice(0, stage.n) : b)) : [st.board];
  const many = dbl ? st.handNo > 0 && st.phase !== 'waiting' : allBoards.length > 1 && st.phase === 'done';
  if (S.boardSeen.hand !== st.handNo) S.boardSeen = { hand: st.handNo, n: 0, rows: 0 };
  const seen = S.boardSeen;
  const bests = done && !many ? st.result?.bests?.[0] : null;
  const inBest = (i, c) => !!(c && bests && winBy[i] && bests[i]?.cards.some((b) => b.r === c.r && b.s === c.s));
  let h = '';
  const potLine = st.pots.length > 1 ? st.pots.map((p, n) => `${n ? 'Side pot ' + n : 'Main pot'} ${amt(p.amount)}`).join(' · ') : '';
  const rab = (cs) => (cs ? `<div class="pk-rabbit">🐇 ${cs.map((c) => cardHTML(c, 'ghost')).join('')}</div>` : '');
  const rabbit = rab(st.rabbit), rabbit2 = rab(st.rabbit2);
  const potNow = st.potTotal || (st.phase === 'done' ? (st.result?.wins || []).reduce((a, w) => a + w.amount, 0) : 0);
  const rows = boards.map((b, r) => `<div class="pk-brow">${many ? `<i>${dbl ? 'Board' : 'Run'} ${r + 1}</i>` : ''}${b.map((c, i) => cardHTML(c, 'bcard' + ((r === 0 || dbl ? i >= seen.n : r >= seen.rows) ? ' deal' : '') + (Object.keys(winBy).some((k) => inBest(Number(k), c)) ? ' hi' : ''))).join('')}${r === 0 ? rabbit : dbl && r === 1 ? rabbit2 : ''}</div>`).join('');
  seen.n = boards[0].length; seen.rows = boards.length;
  h += `<div class="pk-mid${many ? ' many n' + allBoards.length : ''}">
    <div class="pk-board pk-stand"><div class="pk-pot">${st.bomb && live ? '<span class="pk-bomb">💣 Bomb pot</span>' : ''}${(st.plo || dbl) && st.phase !== 'waiting' ? `<span class="pk-variant">${st.plo ? 'PLO' : "Hold'em"}${dbl ? ' · 2 boards' : ''}</span>` : ''}<b class="pk-potnum"><i>POT</i>${amt(potNow)}</b>${potLine ? `<small>${potLine}</small>` : ''}</div>${rows}</div>
    ${dbl ? '' : rankBadge(mySeat >= 0 && !showing ? st.seats[mySeat] : null)}
    <div class="pk-spot pot" id="spot-99"></div>
  </div>`;
  const people = [], chips = [], stools = [];
  const votes = st.awayVotes || {};
  for (let i = 0; i < POKER_SEATS; i++) {
    const seat = st.seats[i], P = at(i), isMe = !!seat && seat.id === S.myId;
    // Standing things at the far side and the ends would poke out past the table's edge on the screen, so they are set further in.
    const far = P.y < 40 || Math.abs(P.x - 50) > 38;
    const top = P.y < 40, mineSpot = isMe || (mySeat < 0 && P.y > 90);
    // Flat table: everything is centred on its place, close to the rim. 3D room: the far side looks much shorter
    // from your chair, so the far seats are set well in from the edge and their bets closer to the middle.
    const fa = !S.room ? (mineSpot ? 0.9 : 0.82) : mineSpot ? 0.8 : phone() ? (top ? 0.46 : far ? 0.6 : 0.7) : top ? 0.42 : far ? 0.66 : 0.74;
    const fb = !S.room ? 0.5 : top ? 0.24 : phone() ? 0.36 : 0.44;
    // The far seats keep their place along the table and only move towards you, so they do not bunch up in the middle.
    const wide = S.room && top && !phone();
    const A = wide ? { x: 50 + (P.x - 50) * (Math.abs(P.x - 50) > 30 ? 0.84 : 0.95), y: 50 + (P.y - 50) * 0.46 } : toward(P, fa);
    const B = wide ? { x: 50 + (P.x - 50) * 0.9, y: 50 + (P.y - 50) * fb } : mineSpot && S.room ? { x: P.x + (phone() ? 16 : 9), y: 50 + (P.y - 50) * 0.5 } : toward(P, fb);
    stools.push({ seat: i, x: P.x, y: P.y });
    if (!seat) {
      if (mySeat < 0) h += `<button class="pk-sit pk-stand" style="left:${A.x}%;top:${A.y}%" data-act="sit" data-seat="${i}"><span class="sit-arrow">Sit ▼</span>Seat ${i + 1}</button>`;
      else h += `<div class="pk-empty" style="left:${A.x}%;top:${A.y}%">Empty</div>`;
      continue;
    }
    const me = seat.id === S.myId, turn = live && st.turn === i, inH = seat.inHand && !seat.folded;
    let bubble = '', bcls = '';
    if (showing && inH) {
      const o = stage.odds;
      if (o && o.pct[i] !== undefined) { bubble = `${o.pct[i]}%${o.outs[i] !== undefined ? ` · ${o.outs[i]} out${o.outs[i] === 1 ? '' : 's'}` : ''}`; bcls = 'odds'; }
      else { bubble = 'All in'; bcls = 'allin'; }
    }
    else if (done && winBy[i]) { bubble = `+${amt(winBy[i])}${!many && seat.hand ? ' · ' + esc(seat.hand) : ''}`; bcls = 'win'; }
    else if (seat.inHand && seat.folded) { bubble = 'Fold'; bcls = 'fold'; }
    else if (seat.allIn && seat.inHand && !done) { bubble = 'All in'; bcls = 'allin'; }
    else if (turn) { bubble = 'Thinking…'; bcls = 'turn'; }
    else if (!seat.connected) { bubble = 'Offline'; bcls = 'fold'; }
    else if (seat.out) { bubble = 'Away'; bcls = 'fold'; }
    else if (live && inH && seat.bet > 0 && seat.bet >= st.currentBet) { bubble = st.phase === 'preflop' && seat.bet <= st.settings.bigBlind ? 'In' : 'Called'; bcls = 'in'; }
    else if (seat.hand && done && seat.shown) { bubble = esc(seat.hand); bcls = 'in'; }
    else if (live && inH) { bubble = 'In'; bcls = 'in'; }
    if (votes[seat.id]?.length && !seat.out) bubble += ` · away vote ${votes[seat.id].length}`;
    // Your own cards are in the panel at the bottom, so in the 3D room they are not stood on the felt as well.
    const hideMine = me;
    const cards = !hideMine && seat.cards.length ? seat.cards.map((c) => cardHTML(c, (me ? 'mine ' : '') + (inBest(i, c) ? 'hi' : ''))).join('') : '';
    const timer = turn && st.turnLeft !== null ? `<i class="pk-bank" data-bank="${seat.bank}"></i><i class="pk-timer"><i style="animation-duration:${Math.max(0.1, (st.turnLeft - (Date.now() - S.at)) / 1000)}s;width:${Math.min(100, (st.turnLeft / (st.settings.turnTimer * 1000)) * 100)}%"></i></i>` : '';
    h += `<div class="pk-seat pk-stand${!me ? ' far' : ''}${me ? ' me' : ''}${turn ? ' turn' : ''}${seat.inHand && seat.folded ? ' folded' : ''}${!seat.inHand && live ? ' idle' : ''}${bcls === 'win' ? ' won' : ''}" style="left:${A.x}%;top:${A.y}%" data-seat="${i}">
      ${bubble ? `<div class="pk-bubble ${bcls}">${bubble}</div>` : ''}
      <div class="pk-cards${seat.folded ? ' dim' : ''}${seat.cards.length > 2 ? ' four' : ''}">${cards}</div>
      <button class="pk-plate" data-act="seat-menu" data-seat="${i}"><b>${esc(seat.name)}${me ? ' <em>YOU</em>' : ''}</b><span>${amt(seat.stack - (showing ? seat.won || 0 : 0))}</span>${statLine(seat.stats)}${timer}</button>
    </div>`;
    h += `<div class="pk-spot${seat.bet ? ' has' : ''}" id="spot-${i}" style="left:${B.x}%;top:${B.y}%">${seat.bet ? `<span class="pk-amt pk-stand">${amt(seat.bet)}</span>` : ''}</div>`;
    if (st.button === i && st.handNo > 0) { h += `<div class="pk-dbtn" style="left:calc(${B.x}% + ${(P.y > 50 ? 1 : -1) * (phone() ? 30 : 52)}px);top:${B.y}%">D</div>`; }
    people.push({ id: seat.id, name: seat.name, look: seat.look || { skin: 2, hair: 0 }, seat: i, seats: POKER_SEATS, isMe: me, isDealer: false, x: P.x, y: P.y, bet: seat.bet });
    chips.push({ seat: i, main: seat.bet, balance: seat.stack - (showing ? seat.won || 0 : 0), mine: me });
  }
  const potChips = st.phase === 'done' ? (showing ? potNow : 0) : st.pot;
  if (potChips > 0) chips.push({ seat: 99, main: potChips, balance: 0 });
  body.innerHTML = h;
  if (S.room) { S.room.setPeople(people, stools); S.room.setChips(chips); }
  drawHud(st, mySeat, showing);
  drawMenu(st);
  keepHand(st);
}

// ---------- Hand history: kept in this browser with no expiry ----------
let dbP = null;
function histDB() {
  return (dbP ||= new Promise((res, rej) => {
    const rq = indexedDB.open('poker-history', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('hands', { keyPath: 'k' });
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  }));
}
// Every finished hand is written down once: the host's browser keeps the full record, a player's browser what it was shown.
function keepHand(st) {
  const h = S.role === 'host' ? S.table?.hist[S.table.hist.length - 1] : st.lastHand;
  if (!h || S.kept === S.code + '#' + h.hand + '#' + h.time) return;
  S.kept = S.code + '#' + h.hand + '#' + h.time;
  const rec = { k: S.kept, code: S.code, role: S.role, ...JSON.parse(JSON.stringify(h)) };
  histDB().then((db) => { db.transaction('hands', 'readwrite').objectStore('hands').put(rec); }).catch(() => {});
}
// The host's record is finished a moment later (shown cards, seeds), so it is written again when a new hand starts.
async function allHands() {
  const db = await histDB();
  return new Promise((res) => { const rq = db.transaction('hands').objectStore('hands').getAll(); rq.onsuccess = () => res(rq.result.sort((a, b) => a.time - b.time)); rq.onerror = () => res([]); });
}
function saveFile(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function downloadHands(kind) {
  const hands = await allHands();
  if (!hands.length) { toast('No finished hands are saved in this browser yet.'); return; }
  const day = new Date().toISOString().slice(0, 10);
  if (kind === 'json') { saveFile(`poker-hands-${day}.json`, JSON.stringify(hands, null, 1)); return; }
  const text = hands.map((h) => [`Table ${h.code} · hand ${h.hand} · ${new Date(h.time).toLocaleString()}${h.bomb ? ' · bomb pot' : ''}`,
    ...h.seats.map((x) => `  Seat ${x.seat + 1} ${x.name}: ${x.cards ? x.cards.map(cardText).join(' ') : 'cards not shown'} · put in ${x.total} · won ${x.won} · stack after ${x.end}`),
    ...(h.lines || []).map((l) => '  ' + l), ''].join('\n')).join('\n');
  saveFile(`poker-hands-${day}.txt`, text);
}

// ---------- The buttons under the table ----------
function drawHud(st, mySeat, showing) {
  const tray = $('#tray'), top = $('#hud-top');
  const seat = mySeat >= 0 ? st.seats[mySeat] : null;
  const o = st.options, live = st.phase !== 'done' && st.phase !== 'waiting';
  const isHost = S.role === 'host';
  let status = '';
  if (st.wait?.length) status = `The table moved to a new host. Waiting a moment for ${esc(st.wait.join(', '))}…`;
  else if (mySeat < 0) status = 'Tap an empty seat to join the game.';
  else if (o) status = `Your turn${seat.hand && !seat.hand.includes(' | ') ? ' · ' + esc(seat.hand) : ''}`;
  else if (live && st.turn !== null) status = `Waiting for ${esc(st.seats[st.turn]?.name || '')}`;
  else if (showing) status = 'All in. The cards are coming out…';
  else if (st.phase === 'done') status = st.result?.wins?.length ? st.result.wins.map((w) => `${esc(st.seats[w.seat]?.name || 'A player')} wins ${amt(w.amount)}${w.hand ? ' with ' + esc(w.hand) : ''}`).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3).join(' · ') : 'Hand over';
  else status = st.canStart ? (isHost ? 'Press Start to deal the first hand.' : 'Waiting for the host to start.') : 'Two players with chips are needed to play.';
  const bounty = st.result?.bounty?.length ? ` · 7-2 bounty: ${st.result.bounty.map((b) => `${esc(st.seats[b.seat]?.name || '')} +${money(b.amount)}`).join(', ')}` : '';
  top.innerHTML = `<div class="status">${status}${bounty}</div>`;
  let h = '';
  if (seat && seat.cards.length && seat.cards[0]) h += `<div class="pk-myhand${seat.cards.length > 2 ? ' four' : ''}">${seat.cards.map((c) => cardHTML(c, 'big')).join('')}${seat.hand && !showing ? `<span class="${seat.hand.includes(' | ') ? 'two' : ''}">${seat.hand.includes(' | ') ? seat.hand.split(' | ').map((x, k) => `<em>Board ${k + 1}</em> ${esc(x)}`).join('<br>') : esc(seat.hand)}</span>` : ''}</div>`;
  if (o) {
    const key = st.handNo + '|' + st.phase + '|' + st.currentBet + '|' + o.minTo;
    if (o.canRaise && (S.raiseFor !== key || S.raiseTo === null)) { S.raiseFor = key; S.raiseTo = o.minTo; }
    const to = o.canRaise ? Math.max(o.minTo, Math.min(o.maxTo, S.raiseTo)) : 0;
    const frac = (f) => Math.max(o.minTo, Math.min(o.maxTo, Math.round(st.currentBet + f * (o.pot + o.toCall))));
    h += `<div class="pk-acts">
      <button class="pk-act fold" data-act="fold">Fold</button>
      ${o.canCheck ? '<button class="pk-act check" data-act="check">Check</button>' : `<button class="pk-act call" data-act="call">Call ${amt(o.toCall)}${o.toCall >= seat.stack ? ' (all in)' : ''}</button>`}
      ${o.canRaise ? `<button class="pk-act raise" data-act="raise" id="raise-btn" title="Tap to raise. Hold and drag up to pick the amount."><i class="pk-dragtip">▲ drag</i><span id="raise-txt">${to >= o.maxTo && o.allIn !== false ? 'All in ' : o.isBet ? 'Bet ' : 'Raise to '}${amt(to)}</span></button>` : ''}
    </div>`;
    if (o.canRaise) h += `<div class="pk-raise">
      <div class="pk-presets"><button data-act="preset" data-v="${o.minTo}">Min</button><button data-act="preset" data-v="${frac(1 / 3)}">⅓ pot</button><button data-act="preset" data-v="${frac(0.5)}">½ pot</button><button data-act="preset" data-v="${frac(2 / 3)}">⅔ pot</button><button data-act="preset" data-v="${frac(1)}">Pot</button><button data-act="preset" data-v="${o.maxTo}">${o.allIn === false ? 'Max' : 'All in'}</button></div>
      <div class="pk-slide"><input type="range" id="raise-range" min="${o.minTo}" max="${o.maxTo}" step="${Math.max(1, Math.min(st.settings.bigBlind, o.maxTo - o.minTo) || 1)}" value="${to}" /><input type="number" id="raise-num" min="${o.minTo}" max="${o.maxTo}" value="${to}" inputmode="numeric" /></div>
    </div>`;
  } else if (seat) {
    const b = [];
    if (st.phase === 'done' && seat.inHand && seat.cards[0] && !seat.shown) {
      const m = seat.mask || seat.cards.map(() => false);
      seat.cards.forEach((c, k) => { if (!m[k]) b.push(`<button class="btn small" data-act="show" data-w="${k}">Show ${esc(cardText(c))}</button>`); });
      b.push(`<button class="btn small" data-act="show">Show ${seat.cards.length > 2 ? 'all' : 'both'}</button>`);
    }
    if (st.phase === 'done' && st.result?.early && st.settings.rabbitHunt && !st.rabbit && seat.inHand) b.push('<button class="btn small" data-act="rabbit">🐇 Rabbit hunt</button>');
    if (!live && isHost && (!S.started || !st.settings.autoStart || S.paused) && st.canStart) b.push(`<button class="btn primary" data-act="start">${st.handNo ? 'Deal next hand' : 'Start'}</button>`);
    if (b.length) h += `<div class="pk-acts small">${b.join('')}</div>`;
  } else if (!live && isHost && st.canStart && (!S.started || S.paused)) h += '<div class="pk-acts small"><button class="btn primary" data-act="start">Start</button></div>';
  if (seat) {
    h += `<div class="pk-mine">
      <button class="btn small${seat.out ? ' gold' : ''}" data-act="away">${seat.out ? "✅ I'm back" : '💤<span> Away</span>'}</button>
      <button class="btn small" data-act="add">🪙<span> Chips</span></button>
      <button class="btn small" data-act="react">😀<span> React</span></button>
      <button class="btn small" data-act="runs" title="How many times you like to deal the rest of the board when everyone is all in">🔁 <span>Run it </span>${seat.runs}×</button>
      <button class="btn small" data-act="bbview" title="Show amounts in big blinds or in chips">${bbOn() ? 'BB' : '$'}<span> view</span></button>
      ${st.settings.straddle ? `<button class="btn small" data-act="straddle">Straddle: ${seat.straddle ? 'on' : 'off'}</button>` : ''}
      <button class="btn small" data-act="stand">🚪<span> Leave seat</span></button>
    </div>`;
  }
  // Keep what is being typed in the amount box while the table redraws.
  const typing = document.activeElement?.id === 'raise-num' ? document.activeElement.value : null;
  tray.innerHTML = h;
  if (typing !== null && $('#raise-num')) { const n = $('#raise-num'); n.value = typing; n.focus(); }
}
function setRaise(v, from) {
  const o = S.st?.options;
  if (!o?.canRaise) return;
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return;
  S.raiseTo = v;
  const to = Math.max(o.minTo, Math.min(o.maxTo, v));
  if (from !== 'range' && $('#raise-range')) $('#raise-range').value = to;
  if (from !== 'num' && $('#raise-num')) $('#raise-num').value = to;
  const b = $('#raise-txt');
  if (b) b.textContent = `${to >= o.maxTo && o.allIn !== false ? 'All in ' : o.isBet ? 'Bet ' : 'Raise to '}${amt(to)}`;
}

// ---------- Menu and dialogs ----------
function drawMenu(st) {
  const el = $('#menu-items');
  if (!el) return;
  const isHost = S.role === 'host';
  el.innerHTML = `
    <div class="menu-invite"><div class="menu-title">🔗 Invite link</div><div class="share"><input id="share" readonly value="${esc(shareLink())}" /><button class="btn small" data-act="copy">Copy</button></div></div>
    <button class="menu-item" data-act="ledger">📒 Ledger</button>
    <button class="menu-item" data-act="log">📝 Hand log</button>
    <button class="menu-item" data-act="dl-hands">⬇️ Download hand history</button>
    <button class="menu-item" data-act="fair">🔐 Fair deck</button>
    <button class="menu-item" data-act="rules">📖 Table rules</button>
    ${isHost ? `<button class="menu-item" data-act="settings">⚙️ Table settings</button>
    <button class="menu-item" data-act="players">👥 Players</button>
    <button class="menu-item" data-act="bomb">💣 Bomb pot next hand: ${st.bombNext ? 'on' : 'off'}</button>
    <button class="menu-item" data-act="pause">${S.paused ? '▶️ Resume dealing' : '⏸️ Pause after this hand'}</button>` : ''}
    <button class="menu-item" data-act="view3d">🧊 3D room: ${use3D() ? 'on' : 'off'}</button>
    ${S.room ? '<button class="menu-item" data-act="walk">🚶 Walk around</button><button class="menu-item" data-act="view-reset">🪑 Back to my seat</button>' : ''}
    <button class="menu-item" data-act="leave">↩️ Leave the table</button>`;
}
function ledgerHTML(st) {
  const rows = [...st.ledger].sort((a, b) => b.net - a.net);
  return `<h3>Ledger</h3><div class="ledger-body"><table class="pk-table"><tr><th>Player</th><th>Bought in</th><th>Chips</th><th>Net</th></tr>${rows.map((r) => `<tr class="${r.id === S.myId ? 'me' : ''}"><td>${esc(r.name)}</td><td>${money(r.totalIn + (r.stack ? 0 : 0))}</td><td>${money(r.stack)}</td><td class="${r.net > 0 ? 'up' : r.net < 0 ? 'down' : ''}">${r.net > 0 ? '+' : ''}${money(r.net)}</td></tr>`).join('')}</table><p class="hint">Net is chips now minus chips bought. A player who left keeps the result they left with.</p></div>`;
}
function rulesHTML(st) {
  const s = st.settings;
  return `<h3>Table rules</h3><div class="pk-rules">
    <p>${s.game === 'plo' ? 'Pot limit Omaha: four cards each, and a hand is made of exactly two of them with exactly three from the board. The largest raise is the size of the pot.' : "No limit Texas Hold'em."}${s.doubleBoard ? ' Two boards are dealt, and each board plays for half of the pot.' : ''} Blinds ${money(s.smallBlind)} / ${money(s.bigBlind)}${s.ante ? `, ante ${money(s.ante)}` : ''}. New players start with ${money(s.startStack)}.</p>
    <p>${s.turnTimer ? `${s.turnTimer} seconds per decision. After that your time bank runs (${s.timeBank} seconds at most, 10 come back each hand). When both run out the table checks for you, or folds when there is a bet. A player whose connection dropped gets 45 seconds more.` : 'No clock on decisions.'}</p>
    <p>7-2 bounty: ${s.sevenDeuce ? `win a hand holding seven-two and every player dealt in pays you ${money(s.sevenDeuce)}.` : 'off.'}</p>
    <p>Bomb pots: ${s.bombPotEvery ? `every ${s.bombPotEvery} hands. ` : 'when the host calls one. '}Everyone posts ${s.bombPotAnte} big blinds and the hand starts at the flop. Bomb pot game: ${s.bombGame === 'same' ? 'same as the table' : s.bombGame === 'plo' ? 'Omaha' : "Hold'em"}, ${s.bombBoards ? (s.bombBoards === 2 ? 'two boards' : 'one board') : 'boards as at the table'}.</p>
    <p>Rabbit hunt: ${s.rabbitHunt ? 'on. After a hand that ends early, a player in the hand may show the cards that would have come.' : 'off.'} Straddle: ${s.straddle ? 'allowed' : 'off'}.</p>
    <p>All in before the river: each player picks how many times to run it (1 to 10, button Run it). The lowest pick among the players in the hand counts${s.runTimes < 10 ? `, at most ${s.runTimes}` : ''}, and the pot is shared equally between the runs (fewer runs when the deck has too few cards left). The hands turn face up with each one's chance to win and its outs.</p>
    <p>Chips: you can add chips or take chips off at your own seat, only while you are not in a hand. Every change is written in the hand log and counted in the ledger.</p>
  </div>`;
}
function settingsHTML(st) {
  const s = st.settings, num = (k, label, min = 0) => `<label>${label}<input type="number" id="ps-${k}" min="${min}" value="${s[k]}" inputmode="numeric" /></label>`;
  const tick = (k, label) => `<label class="tickrow"><input type="checkbox" id="ps-${k}" ${s[k] ? 'checked' : ''} /> ${label}</label>`;
  return `<h3>Table settings</h3><div class="pk-set">
    ${num('smallBlind', 'Small blind')}${num('bigBlind', 'Big blind', 1)}${num('ante', 'Ante (0 = none)')}${num('startStack', 'Starting chips', 1)}
    <label>Seconds per decision<select id="ps-turnTimer">${[0, 10, 15, 20, 30, 45, 60, 90].map((v) => `<option value="${v}"${v === s.turnTimer ? ' selected' : ''}>${v ? v : 'No clock'}</option>`).join('')}</select></label>
    ${num('timeBank', 'Time bank per player, in seconds (0 = none)')}${num('sevenDeuce', '7-2 bounty per player (0 = off)')}${num('bombPotEvery', 'Bomb pot every N hands (0 = off)')}${num('bombPotAnte', 'Bomb pot size, in big blinds', 1)}${num('runTimes', 'Most times an all in may be run (1 to 10)', 1)}<label>All in showdown speed<select id="ps-showSpeed">${['fast', 'normal', 'long'].map((v) => `<option value="${v}"${v === s.showSpeed ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
    <label>Game<select id="ps-game"><option value="nlh"${s.game === 'nlh' ? ' selected' : ''}>No limit Hold'em (2 cards)</option><option value="plo"${s.game === 'plo' ? ' selected' : ''}>Pot limit Omaha (4 cards)</option></select></label>
    ${tick('doubleBoard', 'Two boards every hand (each board plays for half the pot)')}
    <label>Bomb pot game<select id="ps-bombGame">${[['same', 'Same as the table'], ['nlh', "Hold'em"], ['plo', 'Omaha (PLO)']].map(([v, l]) => `<option value="${v}"${s.bombGame === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Bomb pot boards<select id="ps-bombBoards">${[[0, 'Same as the table'], [1, 'One board'], [2, 'Two boards']].map(([v, l]) => `<option value="${v}"${s.bombBoards === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    ${tick('straddle', 'Straddle allowed')}${tick('autoStart', 'Deal the next hand automatically')}
    <button class="btn primary" data-act="save-settings">Save</button>
    <p class="hint">Changes made during a hand start with the next hand.</p></div>`;
}
function playersHTML(st) {
  return `<h3>Players</h3><div class="pk-players">${st.players.map((p) => { const seat = p.seat >= 0 ? st.seats[p.seat] : null; return `<div class="pk-prow"><b>${esc(p.name)}</b><span>${seat ? `Seat ${p.seat + 1} · ${money(seat.stack)}` : 'Watching'}${p.connected ? '' : ' · offline'}</span>
    ${seat ? `<button class="btn small" data-act="h-stack" data-id="${esc(p.id)}">Set chips</button><button class="btn small" data-act="h-up" data-id="${esc(p.id)}">Unseat</button>` : ''}${p.id !== S.myId ? `<button class="btn small danger" data-act="h-kick" data-id="${esc(p.id)}">Remove</button>` : ''}</div>`; }).join('')}</div>`;
}
// Deal a past hand again from its opened seeds and compare it with what the table showed.
function checkHand(hd) {
  if (!hd.serverSeed) return null;
  if (sha256(hd.serverSeed) !== hd.commit) return { ok: false, why: 'The seed does not match the code promised before the hand.' };
  const deck = pokerDeck(hd.serverSeed, hd.clientSeeds);
  const order = [];
  for (let k = 1; k <= POKER_SEATS; k++) { const i = (hd.button + k) % POKER_SEATS; if (hd.seats.some((x) => x.seat === i)) order.push(i); }
  const hole = {};
  let n = 0;
  for (let r = 0; r < (hd.plo ? 4 : 2); r++) for (const i of order) (hole[i] ||= []).push(deck[n++]);
  const board = [], board2 = [];
  for (const take of [3, 1, 1]) { n++; for (let k = 0; k < take; k++) board.push(deck[n++]); if (hd.dbl) for (let k = 0; k < take; k++) board2.push(deck[n++]); }
  const same = (a, b) => a.r === b.r && a.s === b.s;
  const okBoard = hd.board.every((c, i) => same(c, board[i])) && (!hd.dbl || (hd.board2 || []).every((c, i) => same(c, board2[i])));
  const okHole = hd.seats.every((x) => !x.cards || x.cards.every((c, i) => !c || same(c, hole[x.seat][i])));
  return { ok: okBoard && okHole, why: okBoard && okHole ? '' : 'The cards shown at the table are not the cards these seeds give.', hole, board, board2 };
}
function fairHTML(st) {
  const f = st.fair, isHost = S.role === 'host';
  const rows = [...f.hands].reverse().slice(0, 25).map((hd) => {
    const c = checkHand(hd);
    const res = !c ? '<span class="muted">Seeds closed</span>' : c.ok ? `<span class="up">Checked ✓</span> <button class="btn small" data-act="fair-hand" data-h="${hd.hand}">See the deal</button>` : `<span class="down">${esc(c.why)}</span>`;
    return `<tr><td>${hd.hand}</td><td><code>${hd.commit ? esc(hd.commit.slice(0, 10)) + '…' : 'table moved'}</code></td><td>${hd.board.map(cardText).join(' ') || 'no flop'}</td><td>${res}</td></tr>`;
  }).join('');
  return `<h3>🔐 Fair deck</h3><div class="pk-fair">
    <p>Before each hand the host's browser locks in a hidden seed and shows its code (a fingerprint of the seed). Then each player's browser adds a seed of its own. The order of the 52 cards comes from all of these together, so nobody can choose it, the host included.</p>
    <p>Code for the next hand: <code>${esc(f.nextCommit.slice(0, 16))}…</code> · player seeds received: ${f.seeds}</p>
    <p>A seed opens 20 hands after its hand, because an opened seed shows every card of that hand, folded cards too. Your browser then deals the hand again and compares.</p>
    ${isHost ? '<button class="btn small" data-act="reveal-all">Open all seeds now (shows folded cards)</button>' : ''}
    <table class="pk-table"><tr><th>Hand</th><th>Code</th><th>Board</th><th>Check</th></tr>${rows || '<tr><td colspan="4">No hands yet.</td></tr>'}</table>
    <p class="hint">Limit: the host's browser deals the cards, so a host who opens the browser's developer tools could read them. Play with a host you trust.</p></div>`;
}
function fairHandHTML(st, n) {
  const hd = st.fair.hands.find((x) => x.hand === n), c = hd && checkHand(hd);
  if (!c) return '<p>That hand is not open.</p>';
  return `<h3>Hand ${n}, dealt again from its seeds</h3><div class="pk-fair"><table class="pk-table">${hd.seats.map((x) => `<tr><td>${esc(x.name)}</td><td>${c.hole[x.seat].map(cardText).join(' ')}</td></tr>`).join('')}<tr><td>Board (all five)</td><td>${c.board.map(cardText).join(' ')}</td></tr>${hd.dbl ? `<tr><td>Second board</td><td>${c.board2.map(cardText).join(' ')}</td></tr>` : ''}</table>
    <p class="hint">Host seed: <code>${esc(hd.serverSeed)}</code></p><p class="hint">Player seeds: <code>${esc(Object.values(hd.clientSeeds).join(', ') || 'none')}</code></p></div>`;
}

// ---------- Clicks ----------
function copyLink() {
  const link = shareLink();
  (navigator.clipboard?.writeText(link) || Promise.reject()).then(() => toast('Invite link copied.')).catch(() => { modal(`<h3>Invite link</h3><input readonly value="${esc(link)}" style="width:100%" />`); });
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  const wrap = $('#menu-wrap');
  if (wrap && !e.target.closest('#menu-wrap')) wrap.classList.remove('open');
  if (!el) return;
  const act = el.dataset.act, st = S.st, t = S.table;
  const closeMenu = () => wrap?.classList.remove('open');
  switch (act) {
    case 'host': if (takeName()) startHost(newCode(), false); break;
    case 'resume': if (takeName()) { try { startHost(JSON.parse(safeGet('pk-host')).code, true); } catch { startHost(newCode(), false); } } break;
    case 'join': { if (!takeName()) break; const code = (params.get('room') || $('#code')?.value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); if (!code) { toast('Type the table code.'); break; } startGuest(code); break; }
    case 'menu': wrap.classList.toggle('open'); break;
    case 'copy': copyLink(); break;
    case 'sit': {
      const seat = Number(el.dataset.seat);
      modal(`<h3>Take seat ${seat + 1}</h3><div class="pk-set"><label>Chips to start with<input type="number" id="buyin" min="1" value="${st.settings.startStack}" inputmode="numeric" /></label><button class="btn primary" data-act="sit-go" data-seat="${seat}">Sit down</button></div>`);
      break;
    }
    case 'sit-go': send({ t: 'sit', seat: Number(el.dataset.seat), buyIn: Number($('#buyin').value) }); $('#modal').close(); break;
    case 'fold': send({ t: 'act', a: 'fold' }); break;
    case 'check': send({ t: 'act', a: 'check' }); break;
    case 'call': send({ t: 'act', a: 'call' }); break;
    case 'raise': { if (Date.now() - (S.dragEnd || 0) < 350) break; const o = st.options; if (!o?.canRaise) break; const to = Math.max(o.minTo, Math.min(o.maxTo, Math.round(Number($('#raise-num')?.value ?? S.raiseTo)))); send({ t: 'act', a: o.isBet ? 'bet' : 'raise', amount: to }); break; }
    case 'preset': setRaise(el.dataset.v); break;
    case 'show': send({ t: 'show', which: el.dataset.w === undefined ? 'both' : Number(el.dataset.w) }); break;
    case 'rabbit': send({ t: 'rabbit' }); break;
    case 'away': { const s = st.seats.find((x) => x && x.id === S.myId); send({ t: 'away', on: !s.out }); break; }
    case 'straddle': { const s = st.seats.find((x) => x && x.id === S.myId); send({ t: 'straddle', on: !s.straddle }); break; }
    case 'add': modal(`<h3>My chips</h3><div class="pk-set"><label>Amount<input type="number" id="addamt" min="1" value="${st.settings.startStack}" inputmode="numeric" /></label><div class="pk-acts small"><button class="btn primary" data-act="add-go">➕ Add chips</button><button class="btn" data-act="take-go">➖ Take chips off</button></div><p class="hint">Everyone sees each change in the hand log, and the ledger counts it. Chips added during a hand arrive when the hand ends. Chips can only be taken off while you are not in a hand.</p></div>`); break;
    case 'add-go': send({ t: 'add', amount: Number($('#addamt').value) }); $('#modal').close(); break;
    case 'take-go': send({ t: 'take', amount: Number($('#addamt').value) }); $('#modal').close(); break;
    case 'runs': modal(`<h3>Run it how many times?</h3><div class="pk-emoji runs">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button data-act="runs-go" data-n="${n}">${n}×</button>`).join('')}</div><p class="hint">When everyone in a hand is all in before the last card, the rest of the board is dealt this many times and the pot is shared between the runs. The lowest pick among the players in the hand counts.</p>`); break;
    case 'runs-go': send({ t: 'runs', n: Number(el.dataset.n) }); $('#modal').close(); break;
    case 'bbview': safeSet('pk-bb', bbOn() ? '0' : '1'); render(); break;
    case 'react': modal(`<h3>Reaction</h3><div class="pk-emoji">${EMOJI.map((x) => `<button data-act="react-go" data-e="${x}">${x}</button>`).join('')}</div>`); break;
    case 'react-go': send({ t: 'fx', e: el.dataset.e }); break;
    case 'dl-hands': closeMenu(); modal('<h3>Download hand history</h3><div class="pk-set"><p class="hint">Every finished hand is saved in this browser and stays until you clear the browser\'s site data. The host\'s browser holds the full record; a player\'s browser holds what that player was shown.</p><button class="btn primary" data-act="dl-go" data-k="txt">Readable text file</button><button class="btn" data-act="dl-go" data-k="json">Data file (JSON)</button></div>'); break;
    case 'dl-go': downloadHands(el.dataset.k); break;
    case 'seat-menu': {
      const i = Number(el.dataset.seat), x = st.seats[i];
      if (!x) break;
      if (x.id === S.myId) { modal(`<h3>${esc(x.name)} (you)</h3><div class="pk-set">${statsHTML(x.stats)}</div>`); break; }
      const mine = st.seats.some((q) => q && q.id === S.myId), voted = (st.awayVotes?.[x.id] || []).includes(S.myId);
      modal(`<h3>${esc(x.name)}</h3><div class="pk-set"><p>Seat ${i + 1} · ${money(x.stack)} chips${x.out ? ' · away' : ''}</p>${statsHTML(x.stats)}${mine && !x.out ? `<button class="btn" data-act="vaway" data-id="${esc(x.id)}" data-on="${voted ? 0 : 1}">${voted ? 'Take back my away vote' : '💤 Vote to mark away'}</button><p class="hint">A player is marked away only when every other seated player votes for it. They keep their seat and chips and can come back with one press.</p>` : ''}</div>`);
      break;
    }
    case 'vaway': send({ t: 'vaway', id: el.dataset.id, on: el.dataset.on === '1' }); $('#modal').close(); break;
    case 'stand': send({ t: 'stand' }); break;
    case 'start': if (t) { S.started = true; S.paused = false; try { t.startHand(); } catch (er) { toast(er.message); } push(); } break;
    case 'pause': S.paused = !S.paused; if (!S.paused) S.started = true; closeMenu(); push(); break;
    case 'bomb': if (t) { t.setBombNext(!t.bombNext); push(); } break;
    case 'ledger': closeMenu(); modal(ledgerHTML(st)); break;
    case 'log': closeMenu(); modal(`<h3>Hand log</h3><div class="log pk-log">${st.log.map((l) => `<div>${esc(l)}</div>`).reverse().join('')}</div>`); break;
    case 'rules': closeMenu(); modal(rulesHTML(st)); break;
    case 'fair': closeMenu(); modal(fairHTML(st)); break;
    case 'fair-hand': modal(fairHandHTML(st, Number(el.dataset.h))); break;
    case 'reveal-all': if (t) { t.revealAll = true; push(); modal(fairHTML(S.st)); } break;
    case 'settings': closeMenu(); modal(settingsHTML(st)); break;
    case 'save-settings': {
      const patch = {};
      for (const k of ['smallBlind', 'bigBlind', 'ante', 'startStack', 'turnTimer', 'timeBank', 'sevenDeuce', 'bombPotEvery', 'bombPotAnte', 'runTimes']) patch[k] = Number($('#ps-' + k).value);
      for (const k of ['straddle', 'autoStart', 'doubleBoard']) patch[k] = $('#ps-' + k).checked;
      patch.game = $('#ps-game').value; patch.bombGame = $('#ps-bombGame').value; patch.bombBoards = Number($('#ps-bombBoards').value);
      patch.showSpeed = $('#ps-showSpeed').value;
      if (t.inHand()) { S.pendingSettings = patch; toast('Saved. The new settings start with the next hand.'); }
      else { try { t.updateSettings(patch); toast('Settings saved.'); } catch (er) { toast(er.message); } push(); }
      $('#modal').close();
      break;
    }
    case 'players': closeMenu(); modal(playersHTML(st)); break;
    case 'h-stack': { const id = el.dataset.id, v = prompt('Chips for this player'); if (v === null) break; try { t.setStack(id, Number(v)); } catch (er) { toast(er.message); } push(); modal(playersHTML(S.st)); break; }
    case 'h-up': t.standUp(el.dataset.id); push(); modal(playersHTML(S.st)); break;
    case 'h-kick': t.kick(el.dataset.id); S.net.send(el.dataset.id, { t: 'kicked' }); push(); modal(playersHTML(S.st)); break;
    case 'view3d': safeSet('bj-3d', use3D() ? '0' : '1'); location.reload(); break;
    case 'walk': closeMenu(); S.room?.walk(true); break;
    case 'view-reset': closeMenu(); S.room?.home(); break;
    case 'leave': if (S.role === 'guest') send({ t: 'stand' }); setTimeout(() => { location.href = location.pathname; }, 150); break;
    default: break;
  }
});
// Hold the raise button and drag up: the amount grows with the finger, shown on a tall gauge. Letting go keeps
// the amount; a tap on the button then sends it.
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#raise-btn') || !S.st?.options?.canRaise) return;
  S.drag = { y: e.clientY, x: e.clientX, on: false, from: S.raiseTo };
});
document.addEventListener('pointermove', (e) => {
  const d = S.drag, o = S.st?.options;
  if (!d || !o?.canRaise) return;
  const up = d.y - e.clientY;
  if (!d.on && Math.abs(up) < 10) return;
  d.on = true; e.preventDefault();
  const span = Math.min(320, Math.max(160, d.y - 90));
  const f = Math.max(0, Math.min(1, up / span));
  // Slow at the bottom, fast at the top, so small raises are easy to hit.
  const v = f >= 1 ? o.maxTo : Math.round(o.minTo + (o.maxTo - o.minTo) * f * f);
  setRaise(v);
  let g = $('#pk-gauge');
  if (!g) { g = document.createElement('div'); g.id = 'pk-gauge'; g.className = 'pk-gauge'; document.body.append(g); }
  const pot = o.pot + o.toCall, share = pot ? Math.round(((v - S.st.currentBet) / pot) * 100) : 0;
  g.style.left = Math.max(60, Math.min(innerWidth - 60, d.x)) + 'px'; g.style.top = d.y - span - 64 + 'px'; g.style.height = span + 'px';
  g.innerHTML = `<div class="pk-gnum" style="bottom:${f * 100}%"><b>${v >= o.maxTo && o.allIn !== false ? 'All in ' : ''}${amt(v)}</b><small>${share}% of pot</small></div><div class="pk-gfill" style="height:${f * 100}%"></div>`;
}, { passive: false });
const dragStop = () => { if (S.drag?.on) S.dragEnd = Date.now(); S.drag = null; $('#pk-gauge')?.remove(); };
document.addEventListener('pointerup', dragStop);
document.addEventListener('pointercancel', dragStop);
document.addEventListener('input', (e) => {
  if (e.target.id === 'raise-range') setRaise(e.target.value, 'range');
  else if (e.target.id === 'raise-num') setRaise(e.target.value, 'num');
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const o = S.st?.options;
  if (!o) return;
  const k = e.key.toLowerCase();
  if (k === 'f') send({ t: 'act', a: 'fold' });
  else if (k === 'c') send({ t: 'act', a: o.canCheck ? 'check' : 'call' });
  else return;
  e.stopImmediatePropagation(); e.preventDefault();
}, true);
wireGameSwitch('poker', () => S.code || params.get('room'), () => S.role === 'host');
// Once the clock for a decision is used up, the plate counts the player's time bank down.
setInterval(() => {
  const el = $('.pk-bank'), st = S.st;
  if (!el || !st || st.turnLeft === null) return;
  const over = (Date.now() - S.at - st.turnLeft) / 1000;
  el.textContent = over > 0 ? `Time bank ${Math.max(0, Math.ceil(Number(el.dataset.bank) - over))}s` : '';
}, 500);
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 200); });

// ---------- Start ----------
(function boot() {
  const room = (params.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let saved = null;
  try { saved = JSON.parse(safeGet('pk-host') || 'null'); } catch {}
  if (room && S.name && saved?.code === room) { startHost(room, true); return; }   // the host reloaded the page
  if (room && S.name && params.get('open') === '1') { startHost(room, false); return; } // the host of another game's table opens this one
  if (room && S.name && params.get('go') === '1') { startGuest(room); return; }
  void safeDel;
  showLanding();
})();
