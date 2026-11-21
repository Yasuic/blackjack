// The roulette page: a European roulette table for up to 9 in Nigel's room. The host's browser runs
// the table (js/roulette.js); every other browser sends its bets there and is told only what it may see.
import { RouTable, ROU_SEATS, WHEEL, colorOf, betNumbers, betName, betPays, verifySpin } from './roulette.js?v=20261121zb';
import { showSpin } from './wheel.js?v=20261121zb';
import { webglOK, initRoom } from './room3d.js?v=20261121zb';
import { params, $, safeGet, safeSet, getClientId, getLook, esc, money, newCode, randomHex, toast, modal, cardHTML, gameSwitchHTML, wireGameSwitch, createHost, createGuest, watchOffice, goToGame, bankBarHTML, bankLedgerHTML } from './common.js?v=20261121zb';

const PREFIX = 'bjt-ro-';
const app = $('#app');
const S = { name: safeGet('bj-name') || '', myId: getClientId(), code: null, role: null, table: null, st: null, net: null, room: null,
  conn: ['Connecting', false], chip: Number(safeGet('ro-chip')) || 5, seedFor: '', at: 0, paused: false, show: null };
if (params.has('roomdebug')) window.__R = S;
const phone = () => innerWidth < 700;
const PHONE_FLAT = true;
const use3D = () => { if (params.get('flat') === '1' || !webglOK()) return false; if (params.get('3d') === '1') return true; const v = safeGet('bj-3d'); return PHONE_FLAT && phone() ? v === '1' : v !== '0'; };
const CHIPS = [1, 5, 25, 100, 500];
const SPIN_MS = () => Number(params.get('spin')) || 9000; // how long the wheel turns on screen before the number is known

// ---------- Landing ----------
function showLanding(note = '') {
  const room = params.get('room');
  let savedCode = null;
  try { savedCode = JSON.parse(safeGet('ro-host') || 'null')?.code; } catch {}
  document.body.classList.remove('in-room', 'room3d');
  app.innerHTML = `
    <div class="landing">
      <div class="game-switch-row">${gameSwitchHTML('roulette')}</div>
      <div class="hero-cards"><span class="ro-hero">17</span></div>
      <h1>Roulette Room</h1>
      <p>${room ? `You were invited to roulette table <b>${esc(room)}</b>. Pick a name and join.` : 'European roulette for up to 9 friends against the house. Host a table and send the link. Play money only.'}</p>
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
  try { saved = JSON.parse(safeGet('ro-host') || 'null'); } catch {}
  S.table = resume && saved && saved.code === code && saved.table ? RouTable.restore(saved.table) : new RouTable();
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
    else doMove(id, m);
  } catch (e) { S.net.send(id, { t: 'err', msg: e.message }); }
  push();
}
function doMove(id, m) {
  const t = S.table;
  switch (m.t) {
    case 'bet': t.bet(id, String(m.spot), m.amount); break;
    case 'unbet': t.unbet(id, String(m.spot)); break;
    case 'clear': t.clearBets(id); break;
    case 'rebet': t.rebet(id); break;
    case 'add': t.addChips(id, m.amount); break;
    case 'take': t.takeChips(id, m.amount); break;
    case 'bank': if (m.on) t.setBank(id); else if (id === t.bankId || id === t.hostId) t.clearBank(id); break;
    case 'seed': t.setClientSeed(id, m.seed, m.commit); break;
    case 'fx': relayFx(id, m.e); break;
    default: break;
  }
}
const EMOJI = ['😂', '😭', '😡', '🤡', '🔥', '💀', '👏', '🙏', '🤑', '💩', '🫡', '🤯', '🍀', '🎯'];
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
  const P = p && p.seat >= 0 && !(phone() && !S.room) ? seatAt(p.seat) : { x: 50, y: 40 };
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
  try { safeSet('ro-host', JSON.stringify({ code: S.code, table: { ...t, log: t.log.slice(-60) } })); } catch {}
  render();
}
// How long a finished spin stays on screen: the wheel turns, then the result is shown.
const showMs = () => SPIN_MS() + 4200;
function hostClock() {
  const t = S.table;
  if (!t) return;
  const now = Date.now();
  if (S.pendingSettings && t.phase === 'betting' && !t.canSpin()) { t.updateSettings(S.pendingSettings); S.pendingSettings = null; push(); }
  if (t.phase === 'betting') {
    if (!S.paused && t.settings.betTime && t.betStart !== null && now - t.betStart >= t.settings.betTime * 1000 && t.canSpin()) { t.doSpin(); push(); }
  } else if (now - (t.doneAt || 0) >= showMs()) { t.next(); push(); }
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
  const t = RouTable.fromPublic(st, S.myId);
  const oldName = st.players.find((p) => p.id === st.hostId)?.name || 'The host';
  t.join(S.myId, S.name, getLook());
  t.addLog(`${oldName}'s browser left. The table now runs in ${S.name}'s browser. Chips and bets are kept.`);
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
  return { W, H: use3D() ? 640 : Math.max(430, Math.min(600, innerHeight - 56 - 235)) };
};
function showTable() {
  document.body.classList.add('in-room');
  const d3 = use3D();
  app.innerHTML = `
    <div class="topbar">
      ${gameSwitchHTML('roulette')}
      <span id="conn-pill" class="pill">Connecting</span>
      <span class="spacer"></span>
      <button class="pill fair-pill" data-act="fair" title="How the spin is kept fair">🔐<span class="fp-t"> Fair spin</span></button>
      <button class="btn small gold" data-act="copy">🔗 Invite</button>
      <div class="menu-wrap" id="menu-wrap">
        <button class="hamburger" data-act="menu" aria-label="Menu"><span></span><span></span><span></span></button>
        <div class="menu" id="menu"><div class="menu-items" id="menu-items"></div></div>
      </div>
    </div>
    <div class="main player"><div>
      ${d3 ? '<div class="room" id="room"><div class="felt pfelt rfelt" id="felt"></div></div><div class="hud3d" id="hud3d"><div class="hud-top" id="hud-top"></div><div class="tray pk-tray" id="tray"></div></div>'
        : '<div class="pk-stage" id="stage"><div class="felt pfelt rfelt" id="felt"></div></div><div class="pk-flat-hud"><div class="hud-top" id="hud-top"></div><div class="tray pk-tray" id="tray"></div></div>'}
    </div></div>`;
  const felt = $('#felt'), F = FELT();
  // The wheel has a layer of its own, so its turn is not cut short when the rest of the table redraws.
  felt.innerHTML = '<div class="pk-body" id="pk-body"></div><div class="pk-body ro-layer" id="ro-layer"></div><div class="pk-body pk-fxs" id="pk-fx"></div>';
  felt.style.width = F.W + 'px'; felt.style.height = F.H + 'px';
  felt.classList.toggle('tall', F.H > F.W);
  S.reelFor = null;
  if (d3) {
    document.body.classList.add('room3d');
    try {
      S.room = initRoom($('#room'), felt, { phone: phone(), pixel: safeGet('bj-pixel') === '1', hud: $('#hud3d'), size: F, game: 'roulette', onGo: (g) => goToGame('roulette', g, S.code || params.get('room'), S.role === 'host'), metres: F.H > F.W ? 1.3 : 2.0 });
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
// The nine seats along the near side of the table. Your own seat is in the middle.
function seatAt(seat) {
  const st = S.st, me = st?.players.find((p) => p.id === S.myId);
  const mine = me && me.seat >= 0 ? me.seat : 4;
  const rel = ((seat - mine + 4 + ROU_SEATS * 2) % ROU_SEATS) - 4;
  return { x: 50 + rel * 10.5, y: 99, rel, plate: { x: 50 + rel * 10.5, y: S.room ? 92 : 96 } };
}
// Whether the wheel is still turning for the spin on screen.
function turning(st) {
  if (st.phase !== 'done' || !st.spin) return false;
  if (S.show?.round !== st.round) { S.show = { round: st.round, t0: Date.now() }; setTimeout(render, SPIN_MS() + 40); }
  return Date.now() - S.show.t0 < SPIN_MS();
}
// The wheel: a band of pockets in the order of a real wheel that runs past a marker and slows down on the number.
function drawWheel(st) {
  const layer = $('#ro-layer');
  if (!layer) return;
  const key = st.phase === 'done' && st.spin ? 'r' + st.round : 'idle';
  if (S.reelFor === key) return;
  S.reelFor = key;
  const cell = (n) => `<i class="${colorOf(n)}">${n}</i>`;
  if (key === 'idle') {
    const last = st.history[st.history.length - 1];
    layer.innerHTML = `<div class="ro-wheel pk-stand idle"><div class="ro-band" style="transform:translateX(0)">${(last === undefined ? WHEEL.slice(0, 9) : [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => WHEEL[(WHEEL.indexOf(last) + d + 37) % 37])).map(cell).join('')}</div><span class="ro-mark"></span></div>`;
    return;
  }
  const n = st.spin.n, at = WHEEL.indexOf(n), loops = 3;
  // The big wheel pops up on every screen for each spin; the ball stops on this number.
  { const gone = Date.now() - (S.show?.t0 || Date.now()); if (gone < SPIN_MS()) showSpin({ n, seed: st.round, ms: SPIN_MS(), elapsed: gone }); }
  const cells = [];
  for (let k = 0; k < loops * 37 + at + 5; k++) cells.push(WHEEL[k % 37]);
  layer.innerHTML = `<div class="ro-wheel pk-stand"><div class="ro-band" id="ro-band">${cells.map(cell).join('')}</div><span class="ro-mark"></span></div>`;
  const band = $('#ro-band'), w = band.firstElementChild.offsetWidth || 44;
  const target = -((loops * 37 + at) * w - 4 * w); // the winning pocket ends under the marker, which is over the fifth cell
  const left = Math.max(0, SPIN_MS() - (Date.now() - (S.show?.t0 || Date.now())));
  band.style.transform = 'translateX(0)';
  void band.offsetWidth;
  band.style.transition = left > 300 ? `transform ${left}ms cubic-bezier(.12,.62,.1,1)` : 'none';
  band.style.transform = `translateX(${target}px)`;
}
const numCell = (n) => `n${n}`;
// While the wheel turns, a player's chips are shown as they were before the payout, so the number is not given away early.
const shownChips = (st, p, turn) => (turn && st.pays[p.id] ? Math.round((p.chips - st.pays[p.id].back) * 100) / 100 : p.chips);
function render() {
  const body = $('#pk-body');
  if (!body) return;
  const st = S.st;
  if (!st) {
    body.innerHTML = `<div class="pk-wait pk-stand">${S.nohost ? (params.get('open') ? 'Opening the table…' : 'The roulette table is not open yet. Waiting for the host…') : 'Joining the table…'}</div>`;
    $('#tray').innerHTML = ''; $('#hud-top').innerHTML = '';
    return;
  }
  const me = st.players.find((p) => p.id === S.myId);
  const turn = turning(st), done = st.phase === 'done', final = done && !turn;
  const win = final ? st.spin.n : null;
  const mine = (done ? (st.pays[S.myId] ? st.lastBets[S.myId] : null) : st.bets[S.myId]) || {};
  const tall = FELT().H > FELT().W;
  const hit = (key) => final && betNumbers(key).includes(win);
  const cellBtn = (key, label, cls = '') => {
    const m = mine[key] || 0, all = !done && st.totals[key] ? st.totals[key] : 0;
    return `<button class="ro-cell ${cls}${hit(key) ? ' won' : ''}${final && !hit(key) ? ' lost' : ''}" data-act="bet" data-spot="${key}">${label}${m ? `<span class="ro-mine">${money(m)}</span>` : all ? '<span class="ro-dot"></span>' : ''}</button>`;
  };
  const num = (n) => cellBtn(numCell(n), n, colorOf(n));
  let grid;
  if (!tall) {
    // Lying down, as on a casino table: zero at the left, three rows of twelve, the columns' 2 to 1 at the right.
    const rows = [3, 2, 1].map((r) => Array.from({ length: 12 }, (_, c) => num(c * 3 + r)).join('') + cellBtn('c' + r, '2 to 1', 'out')).join('');
    grid = `<div class="ro-grid wide">${cellBtn('n0', 0, 'green zero')}${rows}
      ${cellBtn('d1', '1st 12', 'out dz')}${cellBtn('d2', '2nd 12', 'out dz')}${cellBtn('d3', '3rd 12', 'out dz')}
      ${cellBtn('low', '1 to 18', 'out ev')}${cellBtn('even', 'Even', 'out ev')}${cellBtn('red', '<i class="ro-dia"></i><span>Red</span>', 'out ev red')}${cellBtn('black', '<i class="ro-dia"></i><span>Black</span>', 'out ev black')}${cellBtn('odd', 'Odd', 'out ev')}${cellBtn('high', '19 to 36', 'out ev')}</div>`;
  } else {
    // Upright for a phone: zero on top, twelve rows of three, dozens down the left side.
    let rows = '';
    for (let r = 0; r < 12; r++) rows += num(r * 3 + 1) + num(r * 3 + 2) + num(r * 3 + 3);
    grid = `<div class="ro-grid tallg">${cellBtn('n0', 0, 'green zero')}
      ${cellBtn('d1', '1st 12', 'out dz d1')}${cellBtn('d2', '2nd 12', 'out dz d2')}${cellBtn('d3', '3rd 12', 'out dz d3')}
      <div class="ro-nums">${rows}</div>
      ${cellBtn('c1', '2 to 1', 'out col')}${cellBtn('c2', '2 to 1', 'out col')}${cellBtn('c3', '2 to 1', 'out col')}
      <div class="ro-even">${cellBtn('low', '1 to 18', 'out ev')}${cellBtn('even', 'Even', 'out ev')}${cellBtn('red', '<i class="ro-dia"></i><span>Red</span>', 'out ev red')}${cellBtn('black', '<i class="ro-dia"></i><span>Black</span>', 'out ev black')}${cellBtn('odd', 'Odd', 'out ev')}${cellBtn('high', '19 to 36', 'out ev')}</div></div>`;
  }
  let h = grid;
  if (final) h += `<div class="ro-result pk-stand ${st.spin.color}"><b>${st.spin.n}</b><span>${st.spin.color === 'green' ? 'Zero' : st.spin.color[0].toUpperCase() + st.spin.color.slice(1)}${st.spin.n ? (st.spin.n % 2 ? ' · odd' : ' · even') : ''}</span></div>`;
  // The players along the near side (a flat phone table lists them under the table instead).
  const people = [], chips = [], stools = [];
  const flatPhone = tall && !S.room;
  for (const p of st.players) {
    if (p.seat < 0) continue;
    const P = seatAt(p.seat), isMe = p.id === S.myId;
    const staked = st.bets[p.id] ? Object.values(st.bets[p.id]).reduce((a, x) => a + x, 0) : 0;
    const pay = final ? st.pays[p.id] : null;
    let bubble = '', bcls = '';
    if (pay) { bubble = pay.net > 0 ? `+${money(pay.net)}` : pay.net < 0 ? `−${money(-pay.net)}` : 'Even'; bcls = pay.net > 0 ? 'win' : pay.net < 0 ? 'fold' : 'in'; }
    else if (!p.connected) { bubble = 'Offline'; bcls = 'fold'; }
    else if (staked) { bubble = `Bet ${money(staked)}`; bcls = 'in'; }
    if (!flatPhone) h += `<div class="pk-seat pk-stand ro-seat${isMe ? ' me' : ' far'}${pay && pay.net > 0 ? ' won' : ''}" style="left:${P.plate.x}%;top:${P.plate.y}%">
      ${bubble ? `<div class="pk-bubble ${bcls}">${bubble}</div>` : ''}
      <div class="pk-plate"><b>${esc(p.name)}${isMe ? ' <em>YOU</em>' : ''}${p.id === st.bankId ? ' <em class="dl">DEALER</em>' : ''}</b><span>${money(shownChips(st, p, turn))}</span></div>
    </div>`;
    h += `<div class="pk-spot" id="spot-${p.seat}" style="left:${P.x}%;top:86%"></div>`;
    stools.push({ seat: p.seat, x: P.x, y: P.y });
    people.push({ id: p.id, name: p.name, look: p.look || { skin: 2, hair: 0 }, seat: p.seat, seats: ROU_SEATS, isMe, isDealer: false, bank: p.id === st.bankId, x: P.x, y: P.y, bet: staked });
    chips.push({ seat: p.seat, main: 0, balance: shownChips(st, p, turn), mine: isMe });
  }
  body.innerHTML = h;
  drawWheel(st);
  S.presence = people.map((p) => ({ id: p.id, name: p.name, look: p.look, seat: p.seat, seats: p.seats }));
  if (S.room) { S.room.setPeople(people, stools); S.room.setChips(chips); S.room.setOthers(S.others); }
  drawHud(st, me, turn, flatPhone);
  drawMenu(st);
}
function lastHTML(st, turn) {
  const list = st.history.slice(-(phone() ? 12 : 18));
  if (turn) list.pop(); // the spin in play is not written before the wheel stops
  return `<div class="ro-last" title="The last numbers, newest at the right">${list.map((n) => `<i class="${colorOf(n)}">${n}</i>`).join('') || '<span>No spins yet</span>'}</div>`;
}
function drawHud(st, me, turn, flatPhone) {
  const tray = $('#tray'), top = $('#hud-top');
  const isHost = S.role === 'host', done = st.phase === 'done';
  const staked = st.bets[S.myId] ? Object.values(st.bets[S.myId]).reduce((a, x) => a + x, 0) : 0;
  let status;
  if (turn) status = 'No more bets. The wheel is turning…';
  else if (done) { const pay = st.pays[S.myId]; status = `<b class="ro-n ${st.spin.color}">${st.spin.n}</b> ${pay ? (pay.net > 0 ? `${st.roundFrozen ? 'Practice: you' : 'You'} won ${money(pay.net)}` : pay.net < 0 ? `${st.roundFrozen ? 'Practice: you' : 'You'} lost ${money(-pay.net)}` : 'You broke even') : ''}`; }
  else if (st.betLeft !== null) status = `Place your bets · <b id="bc-left">${Math.max(0, Math.ceil((st.betLeft - (Date.now() - S.at)) / 1000))}</b> s`;
  else status = st.canSpin ? (isHost ? 'Bets are down. Press Spin.' : 'Waiting for the host to spin.') : me && me.seat < 0 ? 'The table is full. You are watching.' : 'Pick a chip, then tap a number or a box.';
  if (st.bankId === S.myId && !done) status = st.betLeft !== null ? `You are the dealer · <b id="bc-left">${Math.max(0, Math.ceil((st.betLeft - (Date.now() - S.at)) / 1000))}</b> s` : 'You are the dealer. You pay the winners and take the losing bets.';
  top.innerHTML = `${bankBarHTML(st, S.myId, isHost)}<div class="status">${status}</div>`;
  let h = '';
  if (flatPhone) h += `<div class="ro-people">${st.players.filter((p) => p.seat >= 0).map((p) => { const pay = done && !turn ? st.pays[p.id] : null; return `<span class="${p.id === S.myId ? 'me' : ''}${p.connected ? '' : ' off'}">${esc(p.name)} <b>${money(shownChips(st, p, turn))}</b>${pay ? `<em class="${pay.net > 0 ? 'up' : pay.net < 0 ? 'down' : ''}">${pay.net > 0 ? '+' : pay.net < 0 ? '−' : ''}${money(Math.abs(pay.net))}</em>` : ''}</span>`; }).join('')}</div>`;
  h += lastHTML(st, turn);
  if (isHost) h += `<button class="btn primary ro-spin" data-act="deal"${st.canSpin && !done ? '' : ' disabled'}>Spin now</button>`;
  h += `<div class="bc-chips">${CHIPS.map((v) => `<button class="bc-chip c${v}${S.chip === v ? ' on' : ''}" data-act="chip" data-v="${v}">${v}</button>`).join('')}</div>`;
  h += `<div class="pk-mine bc-acts">
    <span class="bc-bal">Chips <b>${money(me ? shownChips(st, me, turn) : 0)}</b>${staked ? ` · bet <b>${money(staked)}</b>` : ''}</span>
    <button class="btn small" data-act="undo"${done || !staked ? ' disabled' : ''}>Undo</button>
    <button class="btn small" data-act="clear"${done || !staked ? ' disabled' : ''}>Clear</button>
    <button class="btn small" data-act="rebet"${done || staked || !st.lastBets[S.myId] ? ' disabled' : ''}>Rebet</button>
    <button class="btn small" data-act="add">🪙<span> Chips</span></button>
    <button class="btn small" data-act="react">😀</button>
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
    <button class="menu-item" data-act="log">📝 Spin log</button>
    <button class="menu-item" data-act="fair">🔐 Fair spin</button>
    <button class="menu-item" data-act="rules">📖 Rules and payouts</button>
    ${isHost ? `<button class="menu-item" data-act="settings">⚙️ Table settings</button>
    <button class="menu-item" data-act="players">👥 Players</button>
    <button class="menu-item" data-act="pause">${S.paused ? '▶️ Spin by the clock again' : '⏸️ Stop the clock (spin by hand)'}</button>` : ''}
    <button class="menu-item" data-act="view3d">🧊 3D room: ${use3D() ? 'on' : 'off'}</button>
    ${S.room ? '<button class="menu-item" data-act="walk">🚶 Walk around</button><button class="menu-item" data-act="view-reset">🪑 Back to my seat</button>' : ''}
    <button class="menu-item" data-act="leave">↩️ Leave the table</button>`;
}
function ledgerHTML(st) { return bankLedgerHTML(st, S.myId); }
function rulesHTML(st) {
  const s = st.settings;
  return `<h3>Rules and payouts</h3><div class="pk-rules">
    <p>European roulette: one wheel with 37 pockets, the numbers 1 to 36 and one green zero. Put chips on the numbers or boxes you think the ball stops on.</p>
    <table class="pk-table"><tr><th>Bet</th><th>Pays</th></tr><tr><td>One number</td><td>35 to 1</td></tr><tr><td>A dozen (1st 12, 2nd 12, 3rd 12) or a column (2 to 1)</td><td>2 to 1</td></tr><tr><td>Red, Black, Odd, Even, 1 to 18, 19 to 36</td><td>1 to 1</td></tr></table>
    <p>Zero belongs to no box: when the ball stops on zero, only a bet on the number 0 wins.</p>
    <p>Limits: ${money(s.minBet)} to ${money(s.maxInside)} on a number, up to ${money(s.maxOutside)} on a box. ${s.betTime ? `The wheel spins ${s.betTime} seconds after the first bet.` : 'The host spins by hand.'}</p>
  </div>`;
}
function settingsHTML(st) {
  const s = st.settings, num = (k, label, min = 1) => `<label>${label}<input type="number" id="bs-${k}" min="${min}" value="${s[k]}" inputmode="numeric" /></label>`;
  return `<h3>Table settings</h3><div class="pk-set">
    ${num('minBet', 'Smallest bet')}${num('maxInside', 'Largest bet on one number')}${num('maxOutside', 'Largest bet on a box (red, a dozen, …)')}${num('startChips', 'Chips for a new player')}
    <label>Seconds from the first bet to the spin<select id="bs-betTime">${[0, 10, 15, 20, 30, 45, 60].map((v) => `<option value="${v}"${v === s.betTime ? ' selected' : ''}>${v ? v : 'Spin by hand'}</option>`).join('')}</select></label>
    <button class="btn primary" data-act="save-settings">Save</button>
    <p class="hint">Changes start when no bets are on the table.</p></div>`;
}
function playersHTML(st) {
  return `<h3>Players</h3><div class="pk-players">${st.players.map((p) => `<div class="pk-prow"><b>${esc(p.name)}</b><span>${p.seat >= 0 ? `Seat ${p.seat + 1}` : 'Watching'} · ${money(p.chips)}${p.connected ? '' : ' · offline'}</span>${p.id !== S.myId ? `<button class="btn small danger" data-act="h-kick" data-id="${esc(p.id)}">Remove</button>` : ''}</div>`).join('')}</div>`;
}
function fairHTML(st) {
  const f = st.fair, turn = turning(st);
  const rows = [...f.spins].reverse().filter((r) => !(turn && r.round === st.round)).map((r) => { const c = verifySpin(r); return `<tr><td>${r.round}</td><td><code>${esc(r.commit.slice(0, 10))}…</code></td><td><b class="ro-n ${colorOf(r.n)}">${r.n}</b></td><td>${c.ok ? '<span class="up">Checked ✓</span>' : `<span class="down">${esc(c.why)}</span>`}</td></tr>`; }).join('');
  return `<h3>🔐 Fair spin</h3><div class="pk-fair">
    <p>Before each spin the host's browser locks in a hidden seed and shows its code (a fingerprint of the seed). Then each player's browser adds a seed of its own. The number comes from all of these together, so nobody can choose it, the host included. Each of the 37 pockets has the same chance.</p>
    <p>Code for the next spin: <code>${esc(f.nextCommit.slice(0, 16))}…</code> · player seeds received: ${f.seeds}</p>
    <p>After a spin its seed opens, and your browser works the number out again and compares.</p>
    <table class="pk-table"><tr><th>Spin</th><th>Code</th><th>Number</th><th>Check</th></tr>${rows || '<tr><td colspan="4">No spins yet.</td></tr>'}</table>
    <p class="hint">Limit: the host's browser holds the hidden seed before the spin, so a host who opens the browser's developer tools could work out the number early. Play with a host you trust.</p></div>`;
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
  if (!el || el.disabled) return;
  const act = el.dataset.act, st = S.st, t = S.table;
  const closeMenu = () => wrap?.classList.remove('open');
  switch (act) {
    case 'host': if (takeName()) startHost(newCode(), false); break;
    case 'resume': if (takeName()) { try { startHost(JSON.parse(safeGet('ro-host')).code, true); } catch { startHost(newCode(), false); } } break;
    case 'join': { if (!takeName()) break; const code = (params.get('room') || $('#code')?.value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); if (!code) { toast('Type the table code.'); break; } startGuest(code); break; }
    case 'menu': wrap.classList.toggle('open'); break;
    case 'copy': copyLink(); break;
    case 'chip': S.chip = Number(el.dataset.v); safeSet('ro-chip', String(S.chip)); render(); break;
    case 'bet': if (st.phase !== 'betting') { toast('Bets open again after this spin.'); break; } (S.undo ||= []).push(el.dataset.spot); send({ t: 'bet', spot: el.dataset.spot, amount: S.chip }); break;
    case 'undo': { const mineNow = st.bets[S.myId] || {}; let k; while ((S.undo || []).length && !mineNow[(k = S.undo.pop())]) k = null; if (!k) k = Object.keys(mineNow).pop(); if (k) { S.undo = (S.undo || []).filter((x) => x !== k); send({ t: 'unbet', spot: k }); } break; }
    case 'clear': S.undo = []; send({ t: 'clear' }); break;
    case 'rebet': send({ t: 'rebet' }); break;
    case 'bank-on': send({ t: 'bank', on: true }); break;
    case 'bank-off': send({ t: 'bank', on: false }); break;
    case 'deal': if (t) { try { t.doSpin(); } catch (er) { toast(er.message); } push(); } break;
    case 'add': modal(`<h3>My chips</h3><div class="pk-set"><label>Amount<input type="number" id="addamt" min="1" value="${st.settings.startChips}" inputmode="numeric" /></label><div class="pk-acts small"><button class="btn primary" data-act="add-go">➕ Add chips</button><button class="btn" data-act="take-go">➖ Take chips off</button></div><p class="hint">Everyone sees each change in the spin log, and the ledger counts it.</p></div>`); break;
    case 'add-go': send({ t: 'add', amount: Number($('#addamt').value) }); $('#modal').close(); break;
    case 'take-go': send({ t: 'take', amount: Number($('#addamt').value) }); $('#modal').close(); break;
    case 'react': modal(`<h3>Reaction</h3><div class="pk-emoji">${EMOJI.map((x) => `<button data-act="react-go" data-e="${x}">${x}</button>`).join('')}</div>`); break;
    case 'react-go': send({ t: 'fx', e: el.dataset.e }); break;
    case 'pause': S.paused = !S.paused; closeMenu(); push(); break;
    case 'ledger': closeMenu(); modal(ledgerHTML(st)); break;
    case 'log': closeMenu(); modal(`<h3>Spin log</h3><div class="log pk-log">${st.log.filter((l, i, a) => !(turning(st) && i >= a.findLastIndex((x) => x.startsWith('Spin ')))).map((l) => `<div>${esc(l)}</div>`).reverse().join('')}</div>`); break;
    case 'rules': closeMenu(); modal(rulesHTML(st)); break;
    case 'fair': closeMenu(); modal(fairHTML(st)); break;
    case 'settings': closeMenu(); modal(settingsHTML(st)); break;
    case 'save-settings': {
      const patch = {};
      for (const k of ['minBet', 'maxInside', 'maxOutside', 'startChips', 'betTime']) patch[k] = Number($('#bs-' + k).value);
      if (t.canSpin() || t.phase !== 'betting') { S.pendingSettings = patch; toast('Saved. The new settings start when no bets are on the table.'); }
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
wireGameSwitch('roulette', () => S.code || params.get('room'), () => S.role === 'host');
setInterval(() => {
  const el = $('#bc-left'), st = S.st;
  if (!el || !st || st.betLeft === null) return;
  el.textContent = Math.max(0, Math.ceil((st.betLeft - (Date.now() - S.at)) / 1000));
}, 250);
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { S.reelFor = null; render(); }, 200); });
void cardHTML; void betName; void betPays;

// ---------- Start ----------
(function boot() {
  const room = (params.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let saved = null;
  try { saved = JSON.parse(safeGet('ro-host') || 'null'); } catch {}
  if (room && S.name && saved?.code === room) { startHost(room, true); return; }
  if (room && S.name && params.get('open') === '1') { startHost(room, false); return; }
  if (room && S.name && params.get('go') === '1') { startGuest(room); return; }
  showLanding();
})();

// The other tables of the office: who plays there is drawn at their table in the room.
S.others = {};
watchOffice('roulette', () => S.code, (g, list) => { S.others[g] = list.filter((p) => p.id.split('#')[0] !== S.myId); S.room?.setOthers(S.others); });
