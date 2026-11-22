// The baccarat page: a punto banco table for up to 9 in the small meeting room. The host's browser runs
// the table (js/baccarat.js); every other browser sends its bets there and is told only what it may see.
import { BacTable, BAC_SEATS, BAC_SPOTS, BAC_KEYS, verifyShoe, cardText } from './baccarat.js?v=20261122e';
import { webglOK, initRoom } from './room3d.js?v=20261122e';
import { params, $, safeGet, safeSet, getClientId, getLook, esc, money, newCode, randomHex, toast, modal, cardHTML, gameSwitchHTML, wireGameSwitch, createHost, createGuest, watchOffice, goToGame, bankBarHTML, bankLedgerHTML } from './common.js?v=20261122e';

const PREFIX = 'bjt-bc-';
const app = $('#app');
const S = { name: safeGet('bj-name') || '', myId: getClientId(), code: null, role: null, table: null, st: null, net: null, room: null,
  conn: ['Connecting', false], chip: Number(safeGet('bc-chip')) || 5, seedFor: '', at: 0, paused: false, show: null };
if (params.has('roomdebug')) { window.__B = S; window.__bc = { push: () => push(), render: () => render() }; }
const phone = () => innerWidth < 700;
const PHONE_FLAT = true;
const use3D = () => { if (params.get('flat') === '1' || !webglOK()) return false; if (params.get('3d') === '1') return true; const v = safeGet('bj-3d'); return PHONE_FLAT && phone() ? v === '1' : v !== '0'; };
const CHIPS = [1, 5, 25, 100, 500];
const STEP = () => Number(params.get('step')) || 650; // one card comes out every this many milliseconds

// ---------- Landing ----------
function showLanding(note = '') {
  const room = params.get('room');
  let savedCode = null;
  try { savedCode = JSON.parse(safeGet('bc-host') || 'null')?.code; } catch {}
  document.body.classList.remove('in-room', 'room3d');
  app.innerHTML = `
    <div class="landing">
      <div class="game-switch-row">${gameSwitchHTML('baccarat')}</div>
      <div class="hero-cards">${cardHTML({ r: '9', s: '♦' }, 'big')}${cardHTML({ r: 'K', s: '♠' }, 'big')}</div>
      <h1>Baccarat Room</h1>
      <p>${room ? `You were invited to baccarat table <b>${esc(room)}</b>. Pick a name and join.` : 'Baccarat for up to 9 friends against the house. Host a table and send the link. Play money only.'}</p>
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
  try { saved = JSON.parse(safeGet('bc-host') || 'null'); } catch {}
  S.table = resume && saved && saved.code === code && saved.table ? BacTable.restore(saved.table) : new BacTable();
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
    people: () => S.presence || [],
    gone: (id) => { S.table?.disconnect(id); push(); },
    status: (text, ok) => { S.conn = [text, ok]; drawConn(); },
    taken: () => { S.net.close(); clearInterval(S.clock); S.table = null; startGuest(code, true); },
  });
  clearInterval(S.clock);
  S.clock = setInterval(hostClock, 300);
}
function hostMsg(id, m) {
  const t = S.table;
  if (!t) return;
  try {
    if (m.t === 'hello') { if (t.players[id]?.kicked) { S.net.send(id, { t: 'kicked' }); return; } t.join(id, m.name, m.look); }
    else if (!t.players[id] || t.players[id].kicked) return;
    else if (doMove(id, m) === 'quiet') return; // a peel in motion changes nothing at the table
  } catch (e) { S.net.send(id, { t: 'err', msg: e.message }); }
  push();
}
function doMove(id, m) {
  const t = S.table;
  switch (m.t) {
    case 'bet': t.bet(id, String(m.spot), m.amount); break;
    case 'clear': t.clearBets(id); break;
    case 'rebet': t.rebet(id); break;
    case 'add': t.addChips(id, m.amount); break;
    case 'take': t.takeChips(id, m.amount); break;
    case 'bank': if (m.on) t.setBank(id); else if (id === t.bankId || id === t.hostId) t.clearBank(id); break;
    case 'peel': t.openCard(id, String(m.key)); break;
    case 'peelmove': relayPeel(id, String(m.key), Number(m.f)); return 'quiet';
    case 'seed': t.setClientSeed(id, m.seed, m.commit); break;
    case 'fx': relayFx(id, m.e); break;
    default: break;
  }
}
const EMOJI = ['😂', '😭', '😡', '🤡', '🔥', '💀', '👏', '🙏', '🤑', '💩', '🫡', '🤯', '🍀', '🐉'];
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
  const p = st.players.find((x) => x.id === fromId);
  const P = p && p.seat >= 0 ? seatAt(p.seat) : { x: 50, y: 50 };
  const el = document.createElement('div');
  el.className = 'pk-fx pk-stand'; el.textContent = e;
  el.style.left = P.x + (Math.random() * 6 - 3) + '%'; el.style.top = P.y - 6 + '%';
  box.append(el);
  setTimeout(() => el.remove(), 2300);
}
function push() {
  const t = S.table;
  if (!t) return;
  for (const id of S.net.ids()) S.net.send(id, { t: 'state', st: t.publicState(id) });
  S.st = t.publicState(S.myId);
  S.at = Date.now();
  try { safeSet('bc-host', JSON.stringify({ code: S.code, table: { ...t, log: t.log.slice(-60) } })); } catch {}
  render();
}
// How long a finished round stays on screen: the cards come out one by one, then the result is shown.
const showMs = () => 4500; // every card is already face up when a round is done: the result stays this long
function hostClock() {
  const t = S.table;
  if (!t) return;
  const now = Date.now();
  if (S.pendingSettings && t.phase === 'betting' && !t.canDeal()) { t.updateSettings(S.pendingSettings); S.pendingSettings = null; push(); }
  if (t.phase === 'betting') {
    if (!S.paused && t.settings.betTime && t.betStart !== null && now - t.betStart >= t.settings.betTime * 1000 && t.canDeal()) { t.deal(); push(); }
  } else if (t.phase === 'peel') { if (t.peelTick(now)) push(); }
  else if (now - (t.doneAt || 0) >= showMs(t.hand)) { t.next(); push(); }
}

// ---------- Guest ----------
function startGuest(code, again) {
  S.role = 'guest'; S.code = code; S.st = null; S.nohost = false;
  history.replaceState(null, '', shareLink());
  if (!again || !$('#pk-body')) showTable(); else render();
  S.net = createGuest(PREFIX + code, () => ({ t: 'hello', id: S.myId, name: S.name, look: getLook() }), {
    msg: (m) => {
      if (m.t === 'state') {
        clearTimeout(S.takeT); S.takeT = null;
        if (S.st && m.st.hostId !== S.st.hostId) toast(`The table now runs in ${m.st.players.find((p) => p.id === m.st.hostId)?.name || 'another player'}'s browser.`);
        S.st = m.st; S.at = Date.now(); S.nohost = false; render(); sendSeed();
      }
      else if (m.t === 'err') toast(m.msg);
      else if (m.t === 'fx') showFx(m.from, m.e);
      else if (m.t === 'peelfx') setPeel(String(m.key), Number(m.f) || 0);
      else if (m.t === 'kicked') { S.net.close(); showLanding('The host removed you from the table.'); }
    },
    status: (text, ok) => { S.conn = [text, ok]; drawConn(); },
    // Nobody has opened this table yet: whoever walks up to it first opens it (and stays its host).
    nohost: () => { S.nohost = true; if (!S.st) { render(); if (!again && params.get('from') && !S.openT) S.openT = setTimeout(() => { S.openT = null; if (S.role === 'guest' && S.nohost && !S.st && S.code === code) { S.net.close(); startHost(code, false); } }, 2500); } else watchHost(); },
  });
}
// The host's browser is gone: the next player in seat order takes the table over. Chips and bets stay.
function watchHost() {
  const st = S.st;
  if (!st || S.role !== 'guest' || S.takeT || params.get('takeover') === '0') return;
  const list = st.players.filter((p) => p.connected && p.id !== st.hostId).sort((a, b) => (a.seat < 0 ? 99 : a.seat) - (b.seat < 0 ? 99 : b.seat) || (a.id < b.id ? -1 : 1));
  let rank = list.findIndex((p) => p.id === S.myId);
  if (rank < 0) rank = list.length;
  S.takeT = setTimeout(() => { S.takeT = null; if (S.role === 'guest' && S.nohost) takeOver(); }, 1500 + rank * 4000);
}
function takeOver() {
  const st = S.st;
  if (!st || S.role !== 'guest') return;
  try { S.net.close(); } catch {}
  const t = BacTable.fromPublic(st, S.myId);
  const oldName = st.players.find((p) => p.id === st.hostId)?.name || 'The host';
  t.join(S.myId, S.name, getLook());
  t.addLog(`${oldName}'s browser left. The table now runs in ${S.name}'s browser. Chips and bets are kept, and a new shoe is shuffled.`);
  S.role = 'host'; S.table = t; S.paused = false;
  openHost(S.code);
  toast('The host left. The table now runs in your browser.');
  push();
}
function sendSeed() {
  const c = S.st?.fair?.nextCommit;
  if (!c || S.seedFor === c || S.role !== 'guest') return;
  if (S.net.send({ t: 'seed', seed: randomHex(16), commit: c })) S.seedFor = c;
}
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
const FELT = () => {
  if (!phone()) return { W: 1240, H: 640 };
  const W = Math.max(300, Math.min(440, innerWidth - 20));
  return { W, H: use3D() ? 640 : Math.max(400, Math.min(620, innerHeight - 56 - 250)) };
};
function showTable() {
  document.body.classList.add('in-room');
  const d3 = use3D();
  app.innerHTML = `
    <div class="topbar">
      ${gameSwitchHTML('baccarat')}
      <span id="conn-pill" class="pill">Connecting</span>
      <span class="spacer"></span>
      <button class="pill fair-pill" data-act="fair" title="How the shoe is kept fair">🔐<span class="fp-t"> Fair shoe</span></button>
      <button class="btn small gold" data-act="copy">🔗 Invite</button>
      <div class="menu-wrap" id="menu-wrap">
        <button class="hamburger" data-act="menu" aria-label="Menu"><span></span><span></span><span></span></button>
        <div class="menu" id="menu"><div class="menu-items" id="menu-items"></div></div>
      </div>
    </div>
    <div class="main player"><div>
      ${d3 ? '<div class="room" id="room"><div class="felt pfelt bfelt" id="felt"></div></div><div class="hud3d" id="hud3d"><div class="hud-top" id="hud-top"></div><div class="tray pk-tray" id="tray"></div></div>'
        : '<div class="pk-stage" id="stage"><div class="felt pfelt bfelt" id="felt"></div></div><div class="pk-flat-hud"><div class="hud-top" id="hud-top"></div><div class="tray pk-tray" id="tray"></div></div>'}
    </div></div>`;
  const felt = $('#felt'), F = FELT();
  felt.innerHTML = '<div class="pk-body" id="pk-body"></div><div class="pk-body pk-fxs" id="pk-fx"></div>';
  felt.style.width = F.W + 'px'; felt.style.height = F.H + 'px';
  felt.classList.toggle('tall', F.H > F.W);
  if (d3) {
    document.body.classList.add('room3d');
    try {
      S.room = initRoom($('#room'), felt, { phone: phone(), pixel: safeGet('bj-pixel') === '1', hud: $('#hud3d'), size: F, game: 'baccarat', onGo: (g) => goToGame('baccarat', g, S.code || params.get('room'), S.role === 'host'), metres: F.H > F.W ? 1.3 : 2.0 });
      if (params.has('roomdebug')) window.__room = S.room;
      if (S.tourFor !== S.code) { S.tourFor = S.code; S.room.tour(params.get('from') ? 1500 : 2000, params.get('from')); }
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
// The nine seats along the rounded side of the table. Your own seat is in the middle of it.
function seatAt(seat) {
  const st = S.st, me = st?.players.find((p) => p.id === S.myId);
  const mine = me && me.seat >= 0 ? me.seat : 4;
  const rel = ((seat - mine + 4 + BAC_SEATS * 2) % BAC_SEATS) - 4; // -4 .. 4, 0 is the middle
  const tall = FELT().H > FELT().W;
  // The flat phone table: fixed places round the lower edge, clear of the betting boxes.
  if (tall && !S.room) { const T = [[50, 96], [21, 92], [13, 83], [13, 74], [13, 65]][Math.abs(rel)]; return { x: rel < 0 ? T[0] : 100 - T[0], y: T[1], rel, plate: { x: rel < 0 ? T[0] : 100 - T[0], y: T[1] } }; }
  const a = (rel / 4) * (tall ? 1.32 : 1.2);
  const P = { x: 50 + (tall ? 45 : 46) * Math.sin(a), y: (tall ? 52 : 34) + (tall ? 43 : 60) * Math.cos(a), rel };
  const far = Math.abs(rel) >= 3;
  // In the 3D room every name plate stands at the rim in front of its own chair, clear of the betting boxes.
  P.plate = S.room ? { x: 50 + Math.sign(rel) * [0, 13.6, 28.6, 37.5, 40][Math.abs(rel)], y: [94, 91.3, 83.5, 69, 55][Math.abs(rel)] } : { x: 50 + Math.sign(rel) * [0, 13.5, 27.5, 37, 40.5][Math.abs(rel)], y: [80.5, 79, 71.5, 60, 47][Math.abs(rel)] };
  return P;
}
// Where the round is in its show: how many cards are out, and whether the result is known yet.
function stage(st) {
  if (st.phase === 'betting' || !st.hand) return null;
  if (st.phase === 'peel') return { out: new Set(Object.keys(st.peel.open).filter((k) => st.peel.open[k])), final: false };
  const out = new Set(['P0', 'B0', 'P1', 'B1']); if (st.hand.P[2]) out.add('P2'); if (st.hand.B[2]) out.add('B2');
  return { out, final: true };
}
// A card being peeled: how far its corner is lifted (0 to 1), by card. The peeler's browser sets it while dragging,
// the others are told through the host. The face of the card is only in the peeler's browser until it is turned.
function relayPeel(id, key, f) {
  const t = S.table;
  if (!t || t.phase !== 'peel' || t.peel.who[key[0]] !== id || !(f >= 0 && f <= 1)) return;
  for (const pid of S.net.ids()) if (pid !== id) S.net.send(pid, { t: 'peelfx', key, f });
  if (id !== S.myId) setPeel(key, f);
}
function setPeel(key, f) {
  (S.peelF ||= {})[key] = f;
  const el = document.querySelector(`.bc-peel[data-key="${key}"]`);
  if (el) el.style.setProperty('--f', Math.min(0.6, f));
}
const spotName = (k) => BAC_SPOTS[k].name;
// While the cards come out, a player's chips are shown as they were before the payout, so the result is not given away early.
const shownChips = (st, p, final) => (st.phase === 'done' && !final && st.pays[p.id] ? Math.round((p.chips - st.pays[p.id].back) * 100) / 100 : p.chips);
function render() {
  const body = $('#pk-body');
  if (!body) return;
  const st = S.st;
  if (!st) {
    body.innerHTML = `<div class="pk-wait pk-stand">${S.nohost ? (params.get('open') ? 'Opening the table…' : 'The baccarat table is not open yet. Waiting for the host…') : 'Joining the table…'}</div>`;
    $('#tray').innerHTML = ''; $('#hud-top').innerHTML = '';
    return;
  }
  const me = st.players.find((p) => p.id === S.myId);
  const sg = stage(st), done = st.phase !== 'betting', final = st.phase === 'done';
  if (S.peelRound !== st.round) { S.peelRound = st.round; S.peelF = {}; }
  const pl = st.peel;
  const hand = st.hand;
  const side = (key, label, cards) => {
    const shown = cards.map((c, i) => (sg.out.has(key + i) ? c : null));
    const seen = shown.filter(Boolean);
    const total = seen.reduce((a, c) => a + (c.r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : Number(c.r)), 0) % 10;
    const won = final && hand.winner === (key === 'P' ? 'player' : 'banker');
    return `<div class="bc-side ${key === 'P' ? 'p' : 'b'}${won ? ' won' : ''}"><b>${label}</b><div class="bc-cards">${shown.map((c, i) => { if (c) return cardHTML(c, 'bcard' + (i === 2 ? ' third' : '')); const k = key + i, mine = pl?.mine?.[k]; return `<div class="bc-peel${mine ? ' mine' : ' watch'}${i === 2 ? ' third' : ''}" data-key="${k}"${mine ? ' data-act="peel"' : ''} style="--f:${Math.min(0.6, S.peelF?.[k] || 0)}">${mine ? cardHTML(mine, 'bcard face') : '<div class="card bcard blank"></div>'}${cardHTML(null, 'bcard cover')}</div>`; }).join('')}</div><span class="bc-total">${seen.length ? total : ''}</span></div>`;
  };
  let h = '';
  // The cards: Player on the left, Banker on the right.
  h += `<div class="bc-deal pk-stand${done ? ' on' : ''}">${done ? side('P', 'PLAYER', hand.P) + side('B', 'BANKER', hand.B) : '<div class="bc-side p"><b>PLAYER</b><div class="bc-cards empty"></div></div><div class="bc-side b"><b>BANKER</b><div class="bc-cards empty"></div></div>'}</div>`;
  if (final) {
    const who = hand.winner === 'tie' ? `Tie ${hand.pt} : ${hand.bt}` : `${hand.winner === 'player' ? 'Player' : 'Banker'} wins ${hand.winner === 'player' ? hand.pt : hand.bt} to ${hand.winner === 'player' ? hand.bt : hand.pt}`;
    h += `<div class="bc-result pk-stand ${hand.winner}">${who}${hand.natural ? ' · natural' : ''}${hand.ppair ? ' · Player pair' : ''}${hand.bpair ? ' · Banker pair' : ''}</div>`;
  }
  // The five places to bet.
  const myBets = (done ? null : st.bets[S.myId]) || {};
  const myPay = final ? st.pays[S.myId] : null;
  const wonSpot = (k) => final && (k === hand.winner || (k === 'ppair' && hand.ppair) || (k === 'bpair' && hand.bpair));
  h += `<div class="bc-spots">${['ppair', 'player', 'tie', 'banker', 'bpair'].map((k) => {
    const mine = done ? (st.lastBets[S.myId] && st.pays[S.myId] ? st.lastBets[S.myId][k] : 0) : myBets[k] || 0;
    const line = myPay?.lines.find((l) => l.spot === k);
    return `<button class="bc-spot ${k}${wonSpot(k) ? ' won' : ''}${final && !wonSpot(k) ? ' lost' : ''}" data-act="bet" data-spot="${k}" id="bspot-${k}">
      <b>${spotName(k)}</b><small>${BAC_SPOTS[k].text}</small>
      ${mine ? `<span class="bc-mine${line ? (line.net > 0 ? ' up' : line.net < 0 ? ' down' : '') : ''}">${line ? (line.net > 0 ? '+' + money(line.net) : line.net < 0 ? '−' + money(-line.net) : 'Push') : money(mine)}</span>` : ''}
      ${!done && st.totals[k] ? `<i>All: ${money(st.totals[k])}</i>` : ''}
    </button>`;
  }).join('')}</div>`;
  // The players along the rounded side.
  const people = [], chips = [], stools = [];
  for (const p of st.players) {
    if (p.seat < 0) continue;
    const P = seatAt(p.seat), isMe = p.id === S.myId;
    const b = st.bets[p.id], staked = b ? BAC_KEYS.reduce((a, k) => a + (b[k] || 0), 0) : 0;
    const pay = final ? st.pays[p.id] : null;
    const A = P.plate;
    let bubble = '', bcls = '';
    if (!p.connected) { bubble = 'Offline'; bcls = 'fold'; }
    // What the player has down is a line inside the name plate, so it can never cover a neighbour or a betting box.
    const tag = !pay && staked ? BAC_KEYS.filter((k) => b[k]).map((k) => `<u class="${k}">${{ player: 'P', banker: 'B', tie: 'T', ppair: 'PP', bpair: 'BP' }[k]} ${money(b[k])}</u>`).join('') : pay ? `<u class="${pay.net > 0 ? 'up' : pay.net < 0 ? 'down' : 'push'}">${pay.net > 0 ? '+' + money(pay.net) : pay.net < 0 ? '−' + money(-pay.net) : 'Push'}</u>` : '';
    h += `<div class="pk-seat pk-stand bc-seat r${Math.abs(P.rel)}${isMe ? ' me' : ' far'}${pay && pay.net > 0 ? ' won' : ''}" style="left:${A.x}%;top:${A.y}%">
      ${bubble ? `<div class="pk-bubble ${bcls}">${bubble}</div>` : ''}
      <div class="pk-plate"><b>${esc(p.name)}</b>${isMe ? '<em>YOU</em>' : ''}${p.id === st.bankId ? '<em class="dl">DEALER</em>' : ''}<span>${money(shownChips(st, p, final))}</span>${tag ? `<i class="bc-tag">${tag}</i>` : ''}</div>
    </div>`;
    // Bet chips lie in one row in front of the betting boxes, in seat order, never on a box's words or a name.
    const ar = Math.abs(P.rel), B = FELT().W < FELT().H ? { x: 50 + (P.x - 50) * 0.6, y: 50 + (P.y - 50) * 0.62 } : S.room ? { x: 50 + P.rel * 4.6, y: 76 - ar * 0.4 } : { x: 50 + P.rel * 4.6, y: 58 - ar * 0.2 };
    h += `<div class="pk-spot" id="spot-${p.seat}" style="left:${B.x}%;top:${B.y}%"></div>`;
    stools.push({ seat: p.seat, x: P.x, y: P.y });
    people.push({ id: p.id, name: p.name, look: p.look || { skin: 2, hair: 0 }, seat: p.seat, seats: BAC_SEATS, isMe, isDealer: false, bank: p.id === st.bankId, x: P.x, y: P.y, bet: staked });
    chips.push({ seat: p.seat, main: staked, balance: shownChips(st, p, final), mine: isMe });
  }
  body.innerHTML = h;
  S.presence = people.map((p) => ({ id: p.id, name: p.name, look: p.look, seat: p.seat, seats: p.seats }));
  if (S.room) { S.room.setPeople(people, stools); S.room.setChips(chips); S.room.setOthers(S.others); }
  drawHud(st, me, sg);
  drawMenu(st);
}
function roadHTML(st) {
  const list = st.history.slice(-(phone() ? 22 : 36));
  if (st.phase === 'done' && !(stage(st)?.final)) list.pop(); // the round in play is not written before its cards are out
  const cnt = { p: 0, b: 0, t: 0 };
  for (const r of st.history) cnt[r.w]++;
  return `<div class="bc-road" title="Results of the last rounds">${list.map((r) => `<i class="${r.w}${r.pp ? ' pp' : ''}${r.bp ? ' bp' : ''}">${r.w.toUpperCase()}</i>`).join('') || '<span>No rounds yet</span>'}<em>P ${cnt.p} · B ${cnt.b} · T ${cnt.t}</em></div>`;
}
function drawHud(st, me, sg) {
  const tray = $('#tray'), top = $('#hud-top');
  const isHost = S.role === 'host', done = st.phase !== 'betting';
  const staked = st.bets[S.myId] ? BAC_KEYS.reduce((a, k) => a + (st.bets[S.myId][k] || 0), 0) : 0;
  let status;
  if (st.phase === 'peel') {
    const pl = st.peel, mine = Object.keys(pl.mine || {}).length, nm = (id) => esc(st.players.find((p) => p.id === id)?.name || '');
    const who = ['P', 'B'].filter((k) => pl.who[k] && Object.keys(pl.open).some((x) => x[0] === k && !pl.open[x])).map((k) => `${nm(pl.who[k])} (${k === 'P' ? 'Player' : 'Banker'})`);
    status = mine ? 'Your cards: drag a corner to peel, or tap to turn it over' : who.length ? `${who.join(' and ')} ${who.length > 1 ? 'are' : 'is'} peeling…` : 'No more bets. The cards are coming out…';
  }
  else if (st.phase === 'done') { const pay = st.pays[S.myId]; status = pay ? (pay.net > 0 ? `${st.roundFrozen ? 'Practice: you' : 'You'} won ${money(pay.net)}` : pay.net < 0 ? `${st.roundFrozen ? 'Practice: you' : 'You'} lost ${money(-pay.net)}` : 'Push: your bet comes back') : 'Round over'; }
  else if (st.betLeft !== null) status = `Place your bets · <b id="bc-left">${Math.max(0, Math.ceil((st.betLeft - (Date.now() - S.at)) / 1000))}</b> s`;
  else status = st.canDeal ? (isHost ? 'Bets are down. Press Deal.' : 'Waiting for the host to deal.') : me && me.seat < 0 ? 'The table is full. You are watching.' : 'Pick a chip, then tap Player, Banker or Tie.';
  if (st.bankId === S.myId && st.phase === 'betting') status = st.betLeft !== null ? `You are the dealer · <b id="bc-left">${Math.max(0, Math.ceil((st.betLeft - (Date.now() - S.at)) / 1000))}</b> s` : 'You are the dealer. You pay the winners and take the losing bets.';
  top.innerHTML = `${bankBarHTML(st, S.myId, isHost)}<div class="status">${status}</div>`;
  let h = roadHTML(st);
  h += `<div class="bc-chips">${CHIPS.map((v) => `<button class="bc-chip c${v}${S.chip === v ? ' on' : ''}" data-act="chip" data-v="${v}">${v}</button>`).join('')}</div>`;
  h += `<div class="pk-mine bc-acts">
    <span class="bc-bal">Chips <b>${money(me ? shownChips(st, me, sg?.final) : 0)}</b>${staked ? `<i> · bet <b>${money(staked)}</b></i>` : ''}</span>
    <button class="btn small" data-act="clear"${done || !staked ? ' disabled' : ''}>Clear</button>
    <button class="btn small" data-act="rebet"${done || staked || !st.lastBets[S.myId] ? ' disabled' : ''}>Rebet</button>
    ${isHost ? `<button class="btn small primary" data-act="deal"${st.canDeal && !done ? '' : ' disabled'}>Deal<span> now</span></button>` : ''}
    <button class="btn small" data-act="add">🪙<span> Chips</span></button>
    <button class="btn small" data-act="react">😀</button>
    <button class="btn small danger" data-act="leave">🚪<span> Leave</span></button>
  </div>`;
  tray.innerHTML = h;
}

// ---------- Menu and dialogs ----------
function drawMenu(st) {
  const el = $('#menu-items');
  if (!el) return;
  const isHost = S.role === 'host';
  el.innerHTML = `
    <div class="menu-invite"><div class="menu-title">🔗 Invite link</div><div class="share"><input id="share" readonly value="${esc(shareLink())}" /><button class="btn small" data-act="copy">Copy</button></div></div>
    <button class="menu-item" data-act="ledger">📒 Ledger</button>
    <button class="menu-item" data-act="log">📝 Round log</button>
    <button class="menu-item" data-act="fair">🔐 Fair shoe</button>
    <button class="menu-item" data-act="rules">📖 Rules and payouts</button>
    ${isHost ? `<button class="menu-item" data-act="settings">⚙️ Table settings</button>
    <button class="menu-item" data-act="players">👥 Players</button>
    <button class="menu-item" data-act="pause">${S.paused ? '▶️ Deal by the clock again' : '⏸️ Stop the clock (deal by hand)'}</button>` : ''}
    <button class="menu-item" data-act="view3d">🧊 3D room: ${use3D() ? 'on' : 'off'}</button>
    ${S.room ? '<button class="menu-item" data-act="walk">🚶 Walk around</button><button class="menu-item" data-act="view-reset">🪑 Back to my seat</button>' : ''}
    <button class="menu-item" data-act="leave">↩️ Leave the table</button>`;
}
function ledgerHTML(st) { return bankLedgerHTML(st, S.myId); }
function rulesHTML(st) {
  const s = st.settings;
  return `<h3>Rules and payouts</h3><div class="pk-rules">
    <p>Bet on which side ends closer to 9: Player or Banker. Aces count 1, tens and picture cards count 0, and only the last digit of a total counts (7 + 8 = 15 counts as 5).</p>
    <p>Each side gets two cards. An 8 or 9 on either side ends the round. Otherwise Player takes a third card on 0 to 5, and Banker draws by the fixed casino table, which depends on Player's third card. Nobody chooses anything after the bets.</p>
    <table class="pk-table"><tr><th>Bet</th><th>Pays</th></tr><tr><td>Player</td><td>1 to 1</td></tr><tr><td>Banker</td><td>0.95 to 1 (the house keeps 5% of a Banker win)</td></tr><tr><td>Tie</td><td>8 to 1. Player and Banker bets come back on a tie.</td></tr><tr><td>Player pair, Banker pair</td><td>11 to 1 when that side's first two cards have the same rank</td></tr></table>
    <p>Limits: ${money(s.minBet)} to ${money(s.maxBet)} on Player and Banker, up to ${money(s.maxSide)} on Tie and pairs. ${s.decks} decks. ${s.betTime ? `The cards are dealt ${s.betTime} seconds after the first bet.` : 'The host deals by hand.'}</p>
  </div>`;
}
function settingsHTML(st) {
  const s = st.settings, num = (k, label, min = 1) => `<label>${label}<input type="number" id="bs-${k}" min="${min}" value="${s[k]}" inputmode="numeric" /></label>`;
  return `<h3>Table settings</h3><div class="pk-set">
    ${num('minBet', 'Smallest bet')}${num('maxBet', 'Largest bet on Player or Banker')}${num('maxSide', 'Largest bet on Tie or a pair')}${num('startChips', 'Chips for a new player')}
    <label>Seconds from the first bet to the deal<select id="bs-betTime">${[0, 8, 10, 15, 20, 30, 45, 60].map((v) => `<option value="${v}"${v === s.betTime ? ' selected' : ''}>${v ? v : 'Deal by hand'}</option>`).join('')}</select></label>
    <label>Decks in the shoe<select id="bs-decks">${[6, 8].map((v) => `<option value="${v}"${v === s.decks ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <button class="btn primary" data-act="save-settings">Save</button>
    <p class="hint">Changes start when no bets are on the table. A new number of decks starts with the next shoe.</p></div>`;
}
function playersHTML(st) {
  return `<h3>Players</h3><div class="pk-players">${st.players.map((p) => `<div class="pk-prow"><b>${esc(p.name)}</b><span>${p.seat >= 0 ? `Seat ${p.seat + 1}` : 'Watching'} · ${money(p.chips)}${p.connected ? '' : ' · offline'}</span>${p.id !== S.myId ? `<button class="btn small danger" data-act="h-kick" data-id="${esc(p.id)}">Remove</button>` : ''}</div>`).join('')}</div>`;
}
function fairHTML(st) {
  const f = st.fair;
  const rows = [...f.past].reverse().map((r) => { const c = verifyShoe(r); return `<tr><td>${r.shoe}</td><td><code>${esc(r.commit.slice(0, 10))}…</code></td><td>${r.dealt.length} cards</td><td>${c.ok ? '<span class="up">Checked ✓</span>' : `<span class="down">${esc(c.why)}</span>`}</td></tr>`; }).join('');
  return `<h3>🔐 Fair shoe</h3><div class="pk-fair">
    <p>Before a shoe is shuffled the host's browser locks in a hidden seed and shows its code (a fingerprint of the seed). Then each player's browser adds a seed of its own. The order of all cards in the shoe comes from these together, so nobody can choose it, the host included.</p>
    <p>${f.cur ? `Shoe ${f.cur.shoe} is in play: code <code>${esc(f.cur.commit.slice(0, 16))}…</code>, ${f.cur.dealt} cards dealt so far.` : 'No shoe has been shuffled yet.'}</p>
    <p>Code for the next shoe: <code>${esc(f.nextCommit.slice(0, 16))}…</code> · player seeds received: ${f.seeds}</p>
    <p>When a shoe is finished its seed opens, and your browser shuffles it again and compares every card that was dealt.</p>
    <table class="pk-table"><tr><th>Shoe</th><th>Code</th><th>Dealt</th><th>Check</th></tr>${rows || '<tr><td colspan="4">No finished shoe yet.</td></tr>'}</table>
    <p class="hint">Limit: the host's browser holds the shoe, so a host who opens the browser's developer tools could read the coming cards. Play with a host you trust.</p></div>`;
}

// ---------- Clicks ----------
function copyLink() {
  const link = shareLink();
  (navigator.clipboard?.writeText(link) || Promise.reject()).then(() => toast('Invite link copied.')).catch(() => { modal(`<h3>Invite link</h3><input readonly value="${esc(link)}" style="width:100%" />`); });
}
// Peeling a card: press it and drag. The corner lifts as far as you drag; let go past half way, or just tap, and it turns over.
{
  let pd = null, lastSent = 0;
  const tell = (key, f, force) => { const now = Date.now(); if (!force && now - lastSent < 90) return; lastSent = now; if (S.role === 'host') relayPeel(S.myId, key, f); else S.net?.send({ t: 'peelmove', key, f }); };
  document.addEventListener('pointerdown', (e) => { const el = e.target.closest?.('.bc-peel.mine'); if (!el) return; pd = { key: el.dataset.key, x: e.clientX, y: e.clientY, w: el.getBoundingClientRect().width || 60, f: 0, moved: false }; e.preventDefault(); }, true);
  document.addEventListener('pointermove', (e) => {
    if (!pd) return;
    const d = Math.hypot(e.clientX - pd.x, e.clientY - pd.y);
    if (d > 4) pd.moved = true;
    pd.f = Math.max(0, Math.min(1, d / (pd.w * 1.6)));
    (S.peelF ||= {})[pd.key] = pd.f;
    const el = document.querySelector(`.bc-peel[data-key="${pd.key}"]`); if (el) el.style.setProperty('--f', Math.min(0.6, pd.f));
    tell(pd.key, pd.f);
  }, true);
  const up = () => {
    if (!pd) return;
    const { key, f, moved } = pd; pd = null;
    if (!moved || f >= 0.5) send({ t: 'peel', key });
    else { (S.peelF ||= {})[key] = 0; const el = document.querySelector(`.bc-peel[data-key="${key}"]`); if (el) el.style.setProperty('--f', 0); tell(key, 0, true); }
  };
  document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  const wrap = $('#menu-wrap');
  if (wrap && !e.target.closest('#menu-wrap')) wrap.classList.remove('open');
  if (!el || el.disabled) return;
  const act = el.dataset.act, st = S.st, t = S.table;
  const closeMenu = () => wrap?.classList.remove('open');
  switch (act) {
    case 'host': if (takeName()) startHost(newCode(), false); break;
    case 'resume': if (takeName()) { try { startHost(JSON.parse(safeGet('bc-host')).code, true); } catch { startHost(newCode(), false); } } break;
    case 'join': { if (!takeName()) break; const code = (params.get('room') || $('#code')?.value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); if (!code) { toast('Type the table code.'); break; } startGuest(code); break; }
    case 'menu': wrap.classList.toggle('open'); break;
    case 'copy': copyLink(); break;
    case 'chip': S.chip = Number(el.dataset.v); safeSet('bc-chip', String(S.chip)); render(); break;
    case 'bet': if (st.phase !== 'betting') { toast('Bets open again after this round.'); break; } send({ t: 'bet', spot: el.dataset.spot, amount: S.chip }); break;
    case 'clear': send({ t: 'clear' }); break;
    case 'rebet': send({ t: 'rebet' }); break;
    case 'bank-on': send({ t: 'bank', on: true }); break;
    case 'bank-off': send({ t: 'bank', on: false }); break;
    case 'deal': if (t) { try { t.deal(); } catch (er) { toast(er.message); } push(); } break;
    case 'add': modal(`<h3>My chips</h3><div class="pk-set"><label>Amount<input type="number" id="addamt" min="1" value="${st.settings.startChips}" inputmode="numeric" /></label><div class="pk-acts small"><button class="btn primary" data-act="add-go">➕ Add chips</button><button class="btn" data-act="take-go">➖ Take chips off</button></div><p class="hint">Everyone sees each change in the round log, and the ledger counts it.</p></div>`); break;
    case 'add-go': send({ t: 'add', amount: Number($('#addamt').value) }); $('#modal').close(); break;
    case 'take-go': send({ t: 'take', amount: Number($('#addamt').value) }); $('#modal').close(); break;
    case 'react': modal(`<h3>Reaction</h3><div class="pk-emoji">${EMOJI.map((x) => `<button data-act="react-go" data-e="${x}">${x}</button>`).join('')}</div>`); break;
    case 'react-go': send({ t: 'fx', e: el.dataset.e }); break;
    case 'pause': S.paused = !S.paused; closeMenu(); push(); break;
    case 'ledger': closeMenu(); modal(ledgerHTML(st)); break;
    case 'log': closeMenu(); modal(`<h3>Round log</h3><div class="log pk-log">${st.log.map((l) => `<div>${esc(l)}</div>`).reverse().join('')}</div>`); break;
    case 'rules': closeMenu(); modal(rulesHTML(st)); break;
    case 'fair': closeMenu(); modal(fairHTML(st)); break;
    case 'settings': closeMenu(); modal(settingsHTML(st)); break;
    case 'save-settings': {
      const patch = {};
      for (const k of ['minBet', 'maxBet', 'maxSide', 'startChips', 'betTime', 'decks']) patch[k] = Number($('#bs-' + k).value);
      if (t.canDeal() || t.phase !== 'betting') { S.pendingSettings = patch; toast('Saved. The new settings start when no bets are on the table.'); }
      else { t.updateSettings(patch); toast('Settings saved.'); push(); }
      $('#modal').close();
      break;
    }
    case 'players': closeMenu(); modal(playersHTML(st)); break;
    case 'h-kick': t.kick(el.dataset.id); S.net.send(el.dataset.id, { t: 'kicked' }); push(); modal(playersHTML(S.st)); break;
    case 'view3d': safeSet('bj-3d', use3D() ? '0' : '1'); location.reload(); break;
    case 'walk': closeMenu(); S.room?.walk(true); break;
    case 'view-reset': closeMenu(); S.room?.home(); break;
    case 'leave': setTimeout(() => { location.href = location.pathname; }, 100); break;
    default: break;
  }
});
wireGameSwitch('baccarat', () => S.code || params.get('room'), () => S.role === 'host');
// The seconds left to bet count down between messages from the host.
setInterval(() => {
  const el = $('#bc-left'), st = S.st;
  if (!el || !st || st.betLeft === null) return;
  el.textContent = Math.max(0, Math.ceil((st.betLeft - (Date.now() - S.at)) / 1000));
}, 250);
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 200); });
void cardText;

// ---------- Start ----------
(function boot() {
  const room = (params.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let saved = null;
  try { saved = JSON.parse(safeGet('bc-host') || 'null'); } catch {}
  if (room && S.name && saved?.code === room) { startHost(room, true); return; }
  if (room && S.name && params.get('open') === '1') { startHost(room, false); return; }
  if (room && S.name && params.get('go') === '1') { startGuest(room); return; }
  showLanding();
})();

// The other tables of the office: who plays there is drawn at their table in the room.
S.others = {};
watchOffice('baccarat', () => S.code, (g, list) => { S.others[g] = list.filter((p) => p.id.split('#')[0] !== S.myId); S.room?.setOthers(S.others); });
