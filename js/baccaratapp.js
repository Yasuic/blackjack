// The baccarat page: a punto banco table for up to 9 in the small meeting room. The host's browser runs
// the table (js/baccarat.js); every other browser sends its bets there and is told only what it may see.
import { startPresence } from './presence.js?v=20261123e';
import { outerLink } from './shell.js?v=20261123e';
import { BacTable, BAC_SEATS, BAC_SPOTS, BAC_KEYS, verifyShoe, cardText } from './baccarat.js?v=20261123e';
import { webglOK, initRoom } from './room3d.js?v=20261123e';
import { topToolsHTML, initTopTools, setProfit, setRisk, cardScale } from './toptools.js?v=20261123e';
import { autoUpdate, showDropped, markMyTurn, onOfficeBack, setSeated, officeView, params, $, safeGet, safeSet, getClientId, getLook, esc, money, newCode, randomHex, toast, modal, cardHTML, gameSwitchHTML, wireGameSwitch, createHost, createGuest, watchOffice, goToGame, bankBarHTML, bankLedgerHTML, walkTo, setCashOut, carryFor, carryDone, askCashOut, gotCashed, officeSave, officeLedgerHTML, breachCover } from './common.js?v=20261123e';
import { KeyGuard, mixKeys, newNonce } from './cardkeys.js?v=20261123e';

import { votePropose, voteCast, voteTick, voteView, drawVote } from './vote.js?v=20261123e';
const PREFIX = 'bjt-bc-';
// A settings change by vote (js/vote.js): any player at the table may ask, every other player at the table who is online has to say yes.
const VOTE = {
  labels: { minBet: ['Smallest bet'], maxBet: ['Largest bet on Player or Banker'], maxSide: ['Largest bet on Tie or a pair'], startChips: ['Chips for a new player'], betTime: ['Seconds to the deal', (v) => (v ? String(v) : 'deal by hand')], decks: ['Decks'] },
  seated: (id) => { const p = S.table.players[id]; return !!p && !p.kicked && p.seat >= 0; },
  voters: (by) => Object.values(S.table.players).filter((p) => p.id !== by && p.connected && !p.kicked && p.seat >= 0).map((p) => p.id),
  name: (id) => S.table.players[id]?.name || 'A player',
  canApply: () => S.table.phase === 'betting' && !S.table.canDeal(),
  apply: (patch) => S.table.updateSettings(patch),
  log: (text) => S.table.addLog(text),
};
const app = $('#app');
const GAME = 'baccarat';
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
  { const c = carryFor(GAME, code); if (c) { try { t.carryIn(S.myId, c.amount, c.from, c.cid); } catch { /* fine */ } } } // chips brought from another table (kept until this table is surely ours)
  openHost(code);
  history.replaceState(null, '', shareLink());
  showTable();
  push();
}
function openHost(code) {
  S.net = createHost(PREFIX + code, {
    msg: hostMsg,
    people: () => S.presence || [],
    ledger: () => (S.table ? officeRows(S.table.publicState(S.myId)) : null),
    view: () => (S.table ? officeView(GAME, S.table.publicState('~office')) : null),
    piece: (id, piece) => S.hold?.add(piece),
    gone: (id) => { S.table?.disconnect(id); push(); },
    status: (text, ok) => { S.conn = [text, ok]; drawConn(); if (ok && S.role === 'host') carryDone(GAME, S.code); },
    taken: () => {
      if (Date.now() < (S.retakeUntil || 0)) { try { S.net.close(); } catch {} setTimeout(() => { if (S.role === 'host' && S.table) openHost(code); }, 1500); return; } // the old host is still letting go of the address
      S.hold = null; S.net.close(); clearInterval(S.clock); S.table = null; startGuest(code, true); },
  });
  clearInterval(S.clock);
  S.clock = setInterval(hostClock, 300);
}
function hostMsg(id, m) {
  const t = S.table;
  if (!t) return;
  if (m.t === 'host-ask') { handOver(id); return; }
  if (m.t === 'keys') { S.keyWait?.[m.rid]?.(m.keys, id); return; }
  // A guest's browser found card keys asked for out of turn, or taken and not used for dealt cards: the game pauses for everyone.
  if (m.t === 'breach') { if (t.players[id] && !t.players[id].kicked) { t.halt(); push(); } return; }
  if (m.t === 'hello' && S.keyDropped) delete S.keyDropped[id];
  try {
    if (m.t === 'hello') { if (t.players[id]?.kicked) { S.net.send(id, { t: 'kicked' }); return; } t.join(id, m.name, m.look); if (m.carry && typeof m.carry === 'object') { try { t.carryIn(id, m.carry.amount, m.carry.from, m.carry.cid); } catch { /* fine */ } } }
    else if (!t.players[id] || t.players[id].kicked) return;
    else if (m.t === 'carry') { if (m.carry && typeof m.carry === 'object') t.carryIn(id, m.carry.amount, m.carry.from, m.carry.cid); } // chips brought back to a table that stayed open
    else if (m.t === 'cashout') { let amount = 0, err = null; try { amount = t.cashOut(id); } catch (e) { err = e.message; } S.net.send(id, { t: 'cashed', rid: m.rid, amount, err }); }
    else if (doMove(id, m) === 'quiet') return; // a peel in motion changes nothing at the table
  } catch (e) { S.net.send(id, { t: 'err', msg: e.message }); }
  push();
}
function doMove(id, m) {
  const t = S.table;
  switch (m.t) {
    case 'propose': votePropose(t, VOTE, id, m.patch); break;
    case 'vote': voteCast(t, VOTE, id, !!m.yes); break;
    case 'bet': t.bet(id, String(m.spot), m.amount); break;
    case 'clear': t.clearBets(id); break;
    case 'rebet': t.rebet(id); break;
    case 'unseat': t.dealerUnseat(id, String(m.id || '')); break;
    case 'add': t.addChips(id, m.amount); break;
    case 'take': t.takeChips(id, m.amount); break;
    case 'bank':
      if (m.on) t.setBank(id);
      else if (id === t.bankId || id === t.hostId) {
        try { t.clearBank(id); }
        catch (e) {
          // Bets or a round in motion: the dealer stops when this round ends. The host can still remove the dealer at once (it throws, kept as is).
          if (id === t.bankId) { t.bankLeaving = !t.bankLeaving; t.addLog(t.bankLeaving ? `${t.players[id].name} stops dealing after this round.` : `${t.players[id].name} keeps dealing.`); }
          else throw e;
        }
      }
      break;
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
  if (S.hostWait && S.table && S.role === 'host' && !S.handing) { const t = S.table; if (!(t.phase === 'peel')) { const id = S.hostWait; S.hostWait = null; setTimeout(() => { if (S.table?.players[id]) handOver(id); }, 0); } }
  const t = S.table;
  if (!t) return;
  t.keyed = true; // cards are drawn only when their keys are here (feed below)
  for (const id of S.net.ids()) S.net.send(id, { t: 'state', st: { ...t.publicState(id), vote: voteView(t, VOTE, id) } });
  S.st = { ...t.publicState(S.myId), vote: voteView(t, VOTE, S.myId) };
  S.at = Date.now();
  try { safeSet('bc-host', JSON.stringify({ code: S.code, table: { ...t, log: t.log.slice(-60) } })); } catch {}
  render();
  feed();
}

// ---------- Keys for the cards (js/cardkeys.js) ----------
// The shoe order is set at the shuffle, but which card comes out as card number k is picked with key k, and the
// keys are made in the guests' browsers from a secret that never leaves them. To draw cards the host's browser asks
// the guests for the keys of exactly the cards the round takes next (BacTable.need), and only after the bets are
// locked and everyone was told so (push above runs before every ask, and the link keeps messages in order).
// Every guest at the table holds a part of each key, so opening a card early would need all of them to help.
function keyHolders() {
  const t = S.table;
  return S.net.ids().filter((id) => id !== S.myId && t.players[id] && !t.players[id].kicked && !S.keyDropped?.[id]);
}
function getKeys(need) {
  const local = () => Array.from({ length: need }, newNonce);
  const holders = keyHolders();
  if (!holders.length) return Promise.resolve(local()); // nobody else is at the table: this browser makes the keys as it draws
  return new Promise((res) => {
    const rid = newNonce(), parts = {};
    S.keyWait ||= {};
    const finish = () => {
      clearTimeout(timer); delete S.keyWait[rid];
      // A guest who did not answer in time is left out until it comes back to the table.
      for (const id of holders) if (!parts[id]) (S.keyDropped ||= {})[id] = true;
      res(Object.keys(parts).length ? mixKeys(parts, need) : local());
    };
    const timer = setTimeout(finish, 1500);
    S.keyWait[rid] = (keys, from) => {
      if (!holders.includes(from) || parts[from]) return;
      parts[from] = (Array.isArray(keys) ? keys : []).slice(0, need);
      if (holders.every((id) => parts[id])) finish();
    };
    const msg = { t: 'key-req', rid, from: S.table.kc + 1, count: need };
    for (const id of holders) S.net.send(id, msg);
  });
}
// One ask at a time: when the round needs cards, ask for their keys, draw them, tell everyone, and look again.
function feed() {
  const t = S.table;
  if (!t || S.keyBusy || S.hold || S.role !== 'host' || !t.need()) return;
  S.keyBusy = true;
  const need = t.need();
  getKeys(need).then((keys) => {
    if (S.table !== t) return;
    t.keys = keys;
    try { t.more(); } finally { t.keys = null; }
  }).catch(() => {}).finally(() => { S.keyBusy = false; if (S.table === t) push(); });
}

// ---------- The guest's side of the keys ----------
// This browser gives keys only for the next cards, at most two past the cards already dealt, only while the bets are
// locked, and checks 5 seconds later that every key was used for a card the table really dealt. It also checks that
// no bet changed after it gave keys for a round. Anything else stops the game for everyone.
const keyView = (st) => st && { cards: Number(st.fair?.cards) || 0, open: st.phase === 'peel' && !st.halted, shoe: st.fair?.cur?.shoe, host: st.hostId };
function keyGuard() {
  if (S.guard) return S.guard;
  let sec = null;
  try { sec = sessionStorage.getItem('bc-key-' + S.code); } catch {}
  if (!sec) { sec = newNonce() + newNonce(); try { sessionStorage.setItem('bc-key-' + S.code, sec); } catch {} }
  return (S.guard = new KeyGuard(sec));
}
// The bets of the round in play, as one line of text: the same before and after the cards come out.
function betSig(st) {
  let src = null;
  if (st.phase === 'peel') src = st.bets || {};
  else if (st.phase === 'done') { src = {}; for (const [id, pay] of Object.entries(st.pays || {})) if (pay && !pay.bank) src[id] = st.lastBets?.[id] || {}; }
  if (!src) return null;
  return Object.keys(src).sort().map((id) => { const b = src[id] || {}; return BAC_KEYS.some((k) => b[k]) ? id + ':' + BAC_KEYS.map((k) => b[k] || 0).join(',') : ''; }).filter(Boolean).join(' ');
}
function keyAlarm(text) {
  console.warn('[fair] ' + text);
  S.alert = 'Network security breached.';
  S.net?.send({ t: 'breach' });
  render();
}
function serveKeys(m) {
  const st = S.st, g = keyGuard(), r = g.serve(m, keyView(st));
  if (r.alarm) keyAlarm(r.alarm);
  else {
    if (!S.lock || S.lock.round !== st.round || S.lock.host !== st.hostId) S.lock = { round: st.round, host: st.hostId, sig: betSig(st) };
    setTimeout(lateCheck, g.wait + 50);
  }
  return r.keys;
}
// Every key given out has to be used by now. While this browser has no link to the table it looks again later.
function lateCheck(tries = 0) {
  if (S.role !== 'guest') return;
  if (S.conn && S.conn[1] === false && tries < 30) { setTimeout(() => lateCheck(tries + 1), 2000); return; }
  if (S.st?.halted) { if (S.guard) S.guard.out = []; return; } // already paused: the host has to resume first
  const alarm = S.guard?.check(keyView(S.st));
  if (alarm) keyAlarm(alarm);
}
function lockCheck(st) {
  const L = S.lock;
  if (!L || st.hostId !== L.host || st.round !== L.round) { if (L && st.round > L.round) S.lock = null; return; }
  const sig = betSig(st);
  if (sig !== null && sig !== L.sig) { S.lock = null; keyAlarm('A bet changed after the cards of the round were dealt.'); }
  if (st.phase === 'done') S.lock = null;
}
// How long a finished round stays on screen: the cards come out one by one, then the result is shown.
const showMs = () => 4500; // every card is already face up when a round is done: the result stays this long
function hostClock() {
  const t = S.table;
  if (!t) return;
  if (voteTick(t, VOTE)) push();
  const now = Date.now();
  if (S.pendingSettings && t.phase === 'betting' && !t.canDeal()) { t.updateSettings(S.pendingSettings); S.pendingSettings = null; push(); }
  if (t.phase === 'betting') {
    if (!S.paused && !t.halted && t.settings.betTime && t.betStart !== null && now - t.betStart >= t.settings.betTime * 1000 && t.canDeal()) { t.deal(); push(); }
  } else if (t.phase === 'peel') { if (t.peelTick(now)) push(); }
  else if (now - (t.doneAt || 0) >= showMs(t.hand)) { t.next(); push(); }
}

// ---------- Guest ----------
function startGuest(code, again) {
  S.role = 'guest'; S.code = code; S.st = null; S.nohost = false;
  history.replaceState(null, '', shareLink());
  if (!again || !$('#pk-body')) showTable(); else render();
  S.net = createGuest(PREFIX + code, () => ({ t: 'hello', id: S.myId, name: S.name, look: getLook(), carry: carryFor(GAME, code) || undefined }), {
    msg: (m) => {
      if (m.t === 'state') {
        clearTimeout(S.takeT); S.takeT = null;
        if (S.st && m.st.hostId !== S.st.hostId) toast(`The table now runs in ${m.st.players.find((p) => p.id === m.st.hostId)?.name || 'another player'}'s browser.`);
        S.st = m.st; S.at = Date.now(); S.nohost = false; lockCheck(m.st); render(); sendSeed();
      }
      else if (m.t === 'key-req') S.net.send({ t: 'keys', rid: m.rid, keys: serveKeys(m) });
      else if (m.t === 'err') { if (m.wait) clearTimeout(S.askT); toast(m.msg); }
      else if (m.t === 'cashed') gotCashed(m);
      else if (m.t === 'host-give') takeGiven(m);
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
// ---------- "Become host": any player takes the table into their browser, no vote ----------
// The host's browser sends its saved table (the same thing it keeps for a reload) and then joins as a player.
// The table never changes host on its own: when the host's browser is gone, it waits until a player presses Become host.
function handOver(id) {
  const t = S.table, p = t?.players[id];
  if (!p || S.handing || S.hold) { S.net.send(id, { t: 'err', msg: S.hold ? 'The table is still moving. Try again in a few seconds.' : 'Someone else is taking over right now.' }); return; }
  // Never in the middle of a hand: the table moves once this one is over (push runs it then).
  if (t.phase === 'peel') { S.hostWait = id; S.net.send(id, { t: 'err', msg: 'You become the host when this hand ends.', wait: true }); return; }
  S.hostWait = null;
  S.handing = true;
  t.addLog(`${p.name} took over as host. The table now runs in ${p.name}'s browser.`);
  push();
  const saved = safeGet('bc-host');
  if (!saved) { S.handing = false; return; }
  S.net.send(id, { t: 'host-give', saved });
  setTimeout(() => {
    S.handing = false;
    try { S.net.close(); } catch {}
    clearInterval(S.clock); S.table = null;
    safeSet('bc-host', 'null');
    startGuest(S.code, true);
    toast(`${p.name} is the host now. You are a player at the same table.`);
  }, 1000);
}
function takeGiven(m) {
  if (S.role !== 'guest' || S.taking) return;
  let ok = false;
  try { const x = JSON.parse(String(m.saved || '')); ok = x && x.code === S.code && !!x.table && !!BacTable.restore(x.table); } catch { ok = false; }
  if (!ok) { toast('The table could not be handed over. Try again.'); return; }
  S.taking = true; clearTimeout(S.askT); clearTimeout(S.takeT); S.takeT = null;
  safeSet('bc-host', String(m.saved));
  try { S.net.close(); } catch {}
  S.retakeUntil = Date.now() + 20000;
  // A new host always means a new shoe (the old host's browser knew the order). Between hands only.
  setTimeout(() => { S.taking = false; startHost(S.code, true); if (S.table && S.table.phase !== 'peel') { S.table.newShoe(); push(); } toast('You are the host now: keep this tab open.'); }, 2500);
}
function becomeHost() {
  if (S.role !== 'guest' || S.taking) return;
  if (S.nohost && S.st) { toast('The host is offline. Taking over the table…'); takeOver(); return; }
  if (!S.net?.send({ t: 'host-ask' })) { toast('Not connected to the host right now. If the host is gone, try again in a few seconds.'); return; }
  toast('Asking the host\'s browser for the table…');
  clearTimeout(S.askT);
  S.askT = setTimeout(() => { if (S.role === 'guest' && !S.taking) toast("The host's browser did not answer. Its tab may be asleep."); }, 8000);
}
function watchHost() {
  const st = S.st;
  if (!st || S.role !== 'guest' || S.takeT || params.get('takeover') === '0') return;
  const list = st.players.filter((p) => p.connected && p.id !== st.hostId).sort((a, b) => (a.seat < 0 ? 99 : a.seat) - (b.seat < 0 ? 99 : b.seat) || (a.id < b.id ? -1 : 1));
  let rank = list.findIndex((p) => p.id === S.myId);
  if (rank < 0) rank = list.length;
  // The host never changes on its own: the table waits for its host until a player presses Become host.
  void rank;
}
function takeOver() {
  const st = S.st;
  if (!st || S.role !== 'guest') return;
  try { S.net.close(); } catch {}
  const oldName = st.players.find((p) => p.id === st.hostId)?.name || 'The host';
  const hold = null; // nobody holds any part of the hidden cards: a host change means a new deck or shoe
  const finish = (text) => {
    if (S.role !== 'host' || S.hold !== hold) return;
    let t = null;
    try { if (text) t = BacTable.fromHidden(JSON.parse(text), st, S.myId); } catch { t = null; }
    const same = !!t;
    if (!t) t = BacTable.fromPublic(st, S.myId, true);
    t.join(S.myId, S.name, getLook());
    for (const [id, m] of Object.entries(hold?.hellos || {})) { try { t.join(id, m.name, m.look); if (m.carry && typeof m.carry === 'object') t.carryIn(id, m.carry.amount, m.carry.from, m.carry.cid); } catch {} }
    t.addLog(`${oldName}'s browser left. The table now runs in ${S.name}'s browser. Chips and bets are kept, ${same ? 'and the same shoe goes on, card for card' : hold ? 'but too few players came back to open the old shoe, so a new shoe is shuffled' : 'and a new shoe is shuffled'}.`);
    S.hold = null; S.vault = null; S.table = t; S.paused = false;
    push();
  };
  S.role = 'host'; S.table = null; S.hold = hold;
  openHost(S.code);
  toast('The host left. The table now runs in your browser.');
  if (hold) hold.done.then(finish); else finish(null);
}
function sendSeed() {
  const c = S.st?.fair?.nextCommit;
  if (!c || S.seedFor === c || S.role !== 'guest') return;
  if (S.net.send({ t: 'seed', seed: randomHex(16), commit: c })) S.seedFor = c;
}
function send(m) {
  S.live?.actFor(m); // my figure makes the move on everybody's screen (js/presence.js)
  if (S.hold) { toast('One moment: the table is moving to your browser.'); return; }
  if (S.role === 'host') { try { doMove(S.myId, m); } catch (e) { toast(e.message); } push(); }
  else if (!S.net?.send(m)) toast('Not connected to the host right now.');
}
// The link friends get: inside the office it is the office link, which never changes as you walk between tables.
const inviteLink = () => outerLink(shareLink(), 'baccarat');
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
  initTopTools({ css: true });
  document.body.classList.add('in-room');
  const d3 = use3D();
  app.innerHTML = `
    <div class="topbar">
      ${gameSwitchHTML('baccarat')}
      <span id="conn-pill" class="pill">Connecting</span>
      <span class="spacer"></span>
      ${topToolsHTML()}
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
      S.room = initRoom($('#room'), felt, { phone: phone(), pixel: safeGet('bj-pixel') === '1', hud: $('#hud3d'), size: F, game: 'baccarat', onGo: (g, now) => goToGame('baccarat', g, S.code || params.get('room'), S.role === 'host', now), metres: F.H > F.W ? 1.3 : 2.0 });
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
// The wide table is laid out like a casino baccarat table: nine numbered places round the curved side, seat 1 on the
// right, each with its own Player, Banker and Tie boxes and two pair circles. Rings are measured in felt pixels from
// one centre near the dealer, flattened sideways like the rim of the table.
const ARC = { cx: 620, cy: 222, k: 1.5, step: 18, ring: { tie: [200, 252], banker: [252, 296], player: [296, 340], num: [340, 392] }, plate: 402 };
const arcTh = (seat) => ((4 - seat) * ARC.step * Math.PI) / 180;
const arcPt = (r, th) => [ARC.cx + ARC.k * r * Math.sin(th), ARC.cy + r * Math.cos(th)];
const arcRot = (th) => (Math.atan2(-Math.sin(th), ARC.k * Math.cos(th)) * 180) / Math.PI;
// The places round the rounded side. On the wide table seat 1 is always on the far right, as on a casino table;
// on the tall phone table your own seat is at the bottom in the middle.
function seatAt(seat) {
  const st = S.st, me = st?.players.find((p) => p.id === S.myId);
  const tall = FELT().H > FELT().W;
  if (!tall) {
    const th = arcTh(seat), rel = 4 - seat, F = FELT();
    const [x, y] = arcPt(392, th), [px, py] = arcPt(ARC.plate, th);
    return { x: (x / F.W) * 100, y: (y / F.H) * 100, rel, plate: { x: (Math.max(70, Math.min(F.W - 70, px)) / F.W) * 100, y: (Math.min(F.H - 14, py) / F.H) * 100 } };
  }
  const mine = me && me.seat >= 0 ? me.seat : 4;
  const rel = ((seat - mine + 4 + BAC_SEATS * 2) % BAC_SEATS) - 4; // -4 .. 4, 0 is the middle
  // The flat phone table: fixed places round the lower edge, clear of the betting boxes.
  if (!S.room) { const T = [[50, 96], [21, 92], [13, 83], [13, 74], [13, 65]][Math.abs(rel)]; return { x: rel < 0 ? T[0] : 100 - T[0], y: T[1], rel, plate: { x: rel < 0 ? T[0] : 100 - T[0], y: T[1] } }; }
  const a = (rel / 4) * 1.32;
  const P = { x: 50 + 45 * Math.sin(a), y: 52 + 43 * Math.cos(a), rel };
  P.plate = { x: 50 + Math.sign(rel) * [0, 13.6, 28.6, 37.5, 40][Math.abs(rel)], y: [94, 91.3, 83.5, 69, 55][Math.abs(rel)] };
  return P;
}
// A short amount for a small chip: 25, 150, 1.2k.
const chipAmt = (v) => (v >= 10000 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(v));
// The printed felt of the wide table as one drawing: rack, emblems, the rules on a curve and the nine places.
function arcSVG(st, final) {
  const hand = st.hand, done = st.phase !== 'betting';
  const me = st.players.find((p) => p.id === S.myId);
  const mySeat = me && me.seat >= 0 && me.id !== st.bankId ? me.seat : -1;
  const won = (k) => final && (k === hand.winner || (k === 'ppair' && hand.ppair) || (k === 'bpair' && hand.bpair));
  const f1 = (n) => Math.round(n * 10) / 10;
  const P = (r, th) => arcPt(r, th).map(f1).join(' ');
  const cell = (r0, r1, a0, a1) => `M${P(r1, a0)} A${f1(ARC.k * r1)} ${r1} 0 0 0 ${P(r1, a1)} L${P(r0, a1)} A${f1(ARC.k * r0)} ${r0} 0 0 1 ${P(r0, a0)} Z`;
  const at = (r, th, du = 0) => { const rot = (arcRot(th) * Math.PI) / 180; const [x, y] = arcPt(r, th); return [f1(x + du * Math.cos(rot)), f1(y + du * Math.sin(rot))]; };
  let g = '';
  // The dealer's chip rack along the straight side.
  const cols = ['#c0392b', '#27864a', '#1d1f26', '#6b3fa0', '#d9d4c7', '#27864a', '#c0392b', '#1d1f26', '#e0a23a', '#6b3fa0', '#d9d4c7', '#c0392b'];
  g += `<rect x="452" y="10" width="336" height="86" rx="8" fill="#140a18" stroke="#c9a24a" stroke-width="3"/>`;
  cols.forEach((c, i) => { const x = 466 + i * 26.5, hgt = 40 + ((i * 37) % 30); g += `<rect x="${x}" y="${88 - hgt}" width="20" height="${hgt}" rx="3" fill="${c}"/><rect x="${x}" y="${88 - hgt}" width="20" height="${hgt}" rx="3" fill="url(#bcStripe)"/>`; });
  // The house emblem in both top corners.
  for (const x of [150, 1090]) g += `<g class="bc-emb" transform="translate(${x} 92)"><circle r="40" fill="none" stroke="#e9c46a" stroke-width="2.5"/><circle r="33" fill="none" stroke="#e9c46a" stroke-width="1" opacity=".7"/><text y="10" text-anchor="middle" font-size="30" font-weight="800" fill="#f2d58a" letter-spacing="2">ARC</text><text y="66" text-anchor="middle" font-size="17" font-weight="800" fill="#f2d58a" letter-spacing="5">BACCARAT</text></g>`;
  // The centre: the name of the game, or the result once the cards are out.
  if (!final) g += `<text x="620" y="322" text-anchor="middle" font-size="22" font-weight="800" fill="#f2d58a" letter-spacing="7">ARC BACCARAT</text><text x="620" y="356" text-anchor="middle" font-size="19" font-weight="800" letter-spacing="3"><tspan fill="#ffd400">PLAYER</tspan><tspan fill="#f2d58a" dx="12">|</tspan><tspan fill="#ff4a3d" dx="12">BANKER</tspan></text>`;
  // The house rules on a curve just inside the betting places.
  const rr = 180, ra = (66 * Math.PI) / 180;
  g += `<path id="bcRule" d="M${P(rr, -ra)} A${f1(ARC.k * rr)} ${rr} 0 0 0 ${P(rr, ra)}" fill="none"/><text font-size="16" font-weight="700" fill="#f4e6c4" letter-spacing="1"><textPath href="#bcRule" startOffset="50%" text-anchor="middle">Tie 8 to 1 · Pairs 11 to 1 · Banker 0.95 to 1</textPath></text>`;
  const half = ((ARC.step / 2) * Math.PI) / 180, R = ARC.ring;
  for (let s = 0; s < BAC_SEATS; s++) {
    const th = arcTh(s), a0 = th - half, a1 = th + half, rot = f1(arcRot(th)), mine = s === mySeat;
    const p = st.players.find((x) => x.seat === s && x.id !== st.bankId);
    const live = p && st.bets[p.id], bets = (p && (live && BAC_KEYS.some((k) => live[k]) ? live : done && st.pays[p.id] ? st.lastBets[p.id] : null)) || {};
    const pay = p && final ? st.pays[p.id] : null;
    const act = (k) => (mine && !done ? ` data-act="bet" data-spot="${k}" id="bspot-${k}"` : '');
    const cls = (k) => `bc-c ${k}${mine ? ' my' : ''}${won(k) ? ' won' : ''}${final && bets[k] && !won(k) ? ' lost' : ''}`;
    const chip = (k, r, du = 0, small = false) => {
      const v = bets[k];
      if (!v) return '';
      const line = pay?.lines.find((l) => l.spot === k), txt = small ? chipAmt(v) : money(v), [x, y] = at(r, th, du);
      const fill = line ? (line.net > 0 ? '#7ef0b6' : line.net < 0 ? '#bdb3c4' : '#dfe6ee') : '#ffd66e';
      if (small) return `<g class="bc-chipg" transform="translate(${x} ${y})"><circle r="13" fill="${fill}" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/><text y="${txt.length > 3 ? 3.5 : 4.5}" text-anchor="middle" font-size="${txt.length > 3 ? 10 : 12.5}" font-weight="800" fill="#1b1300">${txt}</text></g>`;
      const w = 18 + txt.length * 10.5;
      return `<g class="bc-chipg" transform="translate(${x} ${y}) rotate(${rot})"><rect x="${-w / 2}" y="-13" width="${w}" height="26" rx="13" fill="${fill}" stroke="#fff" stroke-width="2"/><text y="6" text-anchor="middle" font-size="17" font-weight="800" fill="#1b1300">${txt}</text></g>`;
    };
    const label = (k, r, text, color, size) => { if (bets[k]) return chip(k, r); const [x, y] = at(r, th); return `<text class="bc-lab" x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" dy="${f1(size * 0.36)}" text-anchor="middle" font-size="${size}" font-weight="900" fill="${color}" letter-spacing="1">${text}</text>`; };
    g += `<g class="bc-place${mine ? ' my' : ''}">`;
    g += `<path class="bc-c num" d="${cell(R.num[0], R.num[1], a0, a1)}"/>`;
    g += `<path class="${cls('player')}" d="${cell(R.player[0], R.player[1], a0, a1)}"${act('player')}/>`;
    g += `<path class="${cls('banker')}" d="${cell(R.banker[0], R.banker[1], a0, a1)}"${act('banker')}/>`;
    g += `<path class="${cls('tie')}" d="${cell(R.tie[0], R.tie[1], a0, a1)}"${act('tie')}/>`;
    g += label('player', (R.player[0] + R.player[1]) / 2, 'PLAYER', '#ffd400', 17);
    g += label('banker', (R.banker[0] + R.banker[1]) / 2, 'BANKER', '#ff4a3d', 17);
    g += label('tie', R.tie[1] - 15, 'TIE 8:1', '#7ef0a0', 14);
    // The pair circles in the inner part of the Tie box.
    for (const [k, du, ch, col] of [['ppair', -17, 'P', '#ffd400'], ['bpair', 17, 'B', '#ff4a3d']]) {
      const [x, y] = at(R.tie[0] + 14, th, du);
      g += `<g${act(k)} class="${cls(k)} pair"><circle cx="${x}" cy="${y}" r="13" fill="rgba(0,0,0,.25)" stroke="${col}" stroke-width="2.5"/>${bets[k] ? '' : `<text x="${x}" y="${f1(y + 5)}" text-anchor="middle" font-size="13" font-weight="900" fill="${col}">${ch}</text>`}</g>`;
      g += bets[k] ? chip(k, R.tie[0] + 14, du, true) : '';
    }
    const [nx, ny] = at((R.num[0] + R.num[1]) / 2 - 4, th);
    // In the 3D room a seated player's standing name plate hides this spot, so the plate carries the number instead.
    if (p && S.room) g += '</g>'; else g += `<text class="bc-num" x="${nx}" y="${ny}" transform="rotate(${rot} ${nx} ${ny})" dy="11" text-anchor="middle" font-size="30" font-weight="800" fill="#fff">${s + 1}</text></g>`;
  }
  return `<svg class="bc-arc" viewBox="0 0 ${FELT().W} ${FELT().H}" preserveAspectRatio="none" aria-hidden="false"><defs><pattern id="bcStripe" width="20" height="8" patternUnits="userSpaceOnUse"><rect y="0" width="20" height="2" fill="rgba(255,255,255,.35)"/><rect y="4" width="20" height="1" fill="rgba(0,0,0,.35)"/></pattern></defs>${g}</svg>`;
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
  drawVote(S.st?.vote, send);
  const body = $('#pk-body');
  if (!body) return;
  const st = S.st;
  // Freed from a seat for not betting in the round that just started (unseatIdle).
  if (st?.unseated && st.unseated.round !== S.unseatSeen) { const first = S.unseatSeen === undefined; S.unseatSeen = st.unseated.round; if (!first && st.unseated.ids?.includes(S.myId)) toast(st.unseated.dealer ? 'The dealer unseated you. Place a bet to sit down again.' : 'You were unseated for not betting. Place a bet to sit down again.'); }
  if (!st) {
    body.innerHTML = `<div class="pk-wait pk-stand">${S.nohost ? (params.get('open') ? 'Opening the table…' : 'The baccarat table is not open yet. Waiting for the host…') : 'Joining the table…'}</div>`;
    $('#tray').innerHTML = ''; $('#hud-top').innerHTML = '';
    return;
  }
  const me = st.players.find((p) => p.id === S.myId);
  officeSave(S.code, GAME, officeRows(st)); if (S.role === 'guest' && (me)) carryDone(GAME, S.code);
  const sg = stage(st), done = st.phase !== 'betting', final = st.phase === 'done';
  // Session profit on the top bar: the player's own line of the ledger, held back like the chips while the result is still coming out.
  setProfit(me ? (st.frozen && me.base ? Math.round((me.base.chips - me.base.totalIn) * 100) / 100 : Math.round((me.net - (me.chips - shownChips(st, me, sg?.final))) * 100) / 100) : null);
  setRisk(st.phase === 'peel' ? Object.values(st.bets?.[S.myId] || {}).reduce((a, x) => a + (Number(x) || 0), 0) : st.phase === 'done' && !sg?.final ? Number(st.pays?.[S.myId]?.staked) || 0 : 0); // what is on this round until its result shows
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
    h += `<div class="bc-result${FELT().W > FELT().H ? ' flat' : ' pk-stand'} ${hand.winner}">${who}${hand.natural ? ' · natural' : ''}${hand.ppair ? ' · Player pair' : ''}${hand.bpair ? ' · Banker pair' : ''}</div>`;
  }
  // The five places to bet.
  const myBets = (done ? null : st.bets[S.myId]) || {};
  const myPay = final ? st.pays[S.myId] : null;
  const wonSpot = (k) => final && (k === hand.winner || (k === 'ppair' && hand.ppair) || (k === 'bpair' && hand.bpair));
  const wide = FELT().W > FELT().H;
  if (wide) h += arcSVG(st, final);
  else {
  h += `<div class="bc-spots">${['ppair', 'player', 'tie', 'banker', 'bpair'].map((k) => {
    const mine = done ? (st.lastBets[S.myId] && st.pays[S.myId] ? st.lastBets[S.myId][k] : 0) : myBets[k] || 0;
    const line = myPay?.lines.find((l) => l.spot === k);
    return `<button class="bc-spot ${k}${wonSpot(k) ? ' won' : ''}${final && !wonSpot(k) ? ' lost' : ''}" data-act="bet" data-spot="${k}" id="bspot-${k}">
      <b>${spotName(k)}</b><small>${BAC_SPOTS[k].text}</small>
      ${mine ? `<span class="bc-mine${line ? (line.net > 0 ? ' up' : line.net < 0 ? ' down' : '') : ''}">${line ? (line.net > 0 ? '+' + money(line.net) : line.net < 0 ? '−' + money(-line.net) : 'Push') : money(mine)}</span>` : ''}
      ${!done && st.totals[k] ? `<i>All: ${money(st.totals[k])}</i>` : ''}
    </button>`;
  }).join('')}</div>`;
  }
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
    const tag = !pay && staked && !wide ? BAC_KEYS.filter((k) => b[k]).map((k) => `<u class="${k}">${{ player: 'P', banker: 'B', tie: 'T', ppair: 'PP', bpair: 'BP' }[k]} ${money(b[k])}</u>`).join('') : pay ? `<u class="${pay.net > 0 ? 'up' : pay.net < 0 ? 'down' : 'push'}">${pay.net > 0 ? '+' + money(pay.net) : pay.net < 0 ? '−' + money(-pay.net) : 'Push'}</u>` : '';
    h += `<div class="pk-seat pk-stand bc-seat r${Math.abs(P.rel)}${isMe ? ' me' : ' far'}${pay && pay.net > 0 ? ' won' : ''}" style="left:${A.x}%;top:${A.y}%">
      ${bubble ? `<div class="pk-bubble ${bcls}">${bubble}</div>` : ''}
      <div class="pk-plate">${wide ? `<i class="sn">${p.seat + 1}</i>` : ''}<b>${esc(p.name)}</b>${isMe ? '<em>YOU</em>' : ''}${p.id === st.bankId ? '<em class="dl">DEALER</em>' : ''}<span>${money(shownChips(st, p, final))}</span>${tag ? `<i class="bc-tag">${tag}</i>` : ''}</div>
    </div>`;
    // Bet chips lie in one row in front of the betting boxes, in seat order, never on a box's words or a name.
    const ar = Math.abs(P.rel), B = wide ? { x: (arcPt(318, arcTh(p.seat))[0] / FELT().W) * 100, y: (arcPt(318, arcTh(p.seat))[1] / FELT().H) * 100 } : FELT().W < FELT().H ? { x: 50 + (P.x - 50) * 0.6, y: 50 + (P.y - 50) * 0.62 } : S.room ? { x: 50 + P.rel * 4.6, y: 76 - ar * 0.4 } : { x: 50 + P.rel * 4.6, y: 58 - ar * 0.2 };
    h += `<div class="pk-spot" id="spot-${p.seat}" style="left:${B.x}%;top:${B.y}%"></div>`;
    stools.push({ seat: p.seat, x: P.x, y: P.y });
    people.push({ id: p.id, name: p.name, look: p.look || { skin: 2, hair: 0 }, seat: p.seat, seats: BAC_SEATS, isMe, isDealer: false, bank: p.id === st.bankId, x: P.x, y: P.y, bet: staked });
    chips.push({ seat: p.seat, main: wide ? 0 : staked, balance: shownChips(st, p, final), mine: isMe });
  }
  body.innerHTML = h;
  S.presence = people.map((p) => ({ id: p.id, name: p.name, look: p.look, seat: p.seat, seats: p.seats }));
  if (S.room) { S.room.setPeople(people, stools); S.room.setChips(chips); S.room.setOthers(S.others, S.views); }
  drawHud(st, me, sg);
  drawMenu(st);
  fitFlat();
}
// The flat computer table is made smaller when the window is short, so the chips and buttons below never cover it.
function fitFlat() {
  const f = $('#felt');
  if (!f || S.room || phone() || FELT().H > FELT().W) return;
  const hud = document.querySelector('.pk-flat-hud'), top = f.getBoundingClientRect().top, hudTop = hud ? hud.getBoundingClientRect().top : innerHeight;
  // The name plates of the nearest seats hang a little below the felt, so 30 more pixels are kept free.
  const z = Math.max(0.4, Math.min(1, (innerWidth - 40) / 1268, (hudTop - top - 44) / FELT().H));
  f.style.zoom = z.toFixed(3);
}
addEventListener('resize', () => fitFlat());
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
  else status = st.canDeal ? (isHost ? 'Bets are down. Press Deal.' : 'Waiting for the host to deal.') : me && me.seat < 0 ? (st.players.filter((x) => x.seat >= 0).length < BAC_SEATS ? 'You are watching. Place a bet to sit down.' : 'The table is full. You are watching.') : 'Pick a chip, then tap Player, Banker or Tie.';
  if (st.bankId === S.myId && st.phase === 'betting') status = st.betLeft !== null ? `You are the dealer · <b id="bc-left">${Math.max(0, Math.ceil((st.betLeft - (Date.now() - S.at)) / 1000))}</b> s` : 'You are the dealer. You pay the winners and take the losing bets.';
  top.innerHTML = `${bankBarHTML(st, S.myId, isHost)}<div class="status">${status}</div>`;
  let h = roadHTML(st);
  h += `<div class="bc-chips">${CHIPS.map((v) => `<button class="bc-chip c${v}${S.chip === v ? ' on' : ''}" data-act="chip" data-v="${v}">${v}</button>`).join('')}</div>`;
  h += `<div class="pk-mine bc-acts">
    <span class="bc-bal">Chips <b>${money(me ? shownChips(st, me, sg?.final) : 0)}</b>${staked ? `<i> · bet <b>${money(staked)}</b></i>` : ''}</span>
    <button class="btn small" data-act="clear"${done || !staked ? ' disabled' : ''}>Clear</button>
    <button class="btn small" data-act="rebet"${done || staked || !st.lastBets[S.myId] ? ' disabled' : ''}>Rebet</button>
    ${isHost ? `<button class="btn small primary" data-act="deal"${st.canDeal && !done && !st.halted ? '' : ' disabled'}>Deal<span> now</span></button>` : ''}
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
    <button class="menu-item" data-act="ledger">📒 Ledger</button>
    ${S.role === 'guest' ? '<button class="menu-item" data-act="become-host" title="The table moves to your browser. No vote.">👑 Become host</button>' : ''}
    <button class="menu-item" data-act="log">📝 Round log</button>
    <button class="menu-item" data-act="rules">📖 Rules and payouts</button>
    ${isHost || (st.players.find((p) => p.id === S.myId)?.seat ?? -1) >= 0 ? `<button class="menu-item" data-act="settings" data-note="${isHost ? '' : 'Everyone else at the table votes on your change.'}">⚙️ Table settings</button>` : ''}
    ${(st.bankId ? st.bankId === S.myId : isHost) ? '<button class="menu-item" data-act="unseat-list">🪑 Unseat a player</button>' : ''}
    ${isHost ? `    <button class="menu-item" data-act="players">👥 Players</button>
    <button class="menu-item" data-act="pause">${S.paused ? '▶️ Deal by the clock again' : '⏸️ Stop the clock (deal by hand)'}</button>` : ''}
    <button class="menu-item" data-act="view3d">🧊 3D room: ${use3D() ? 'on' : 'off'}</button>
    ${S.room ? '<button class="menu-item" data-act="walk">🚶 Walk around</button>' : ''}
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
    <label>Seconds from the first bet to the deal (0 = deal by hand)<input id="bs-betTime" type="number" inputmode="numeric" min="0" max="300" step="1" value="${Number(s.betTime) || 0}" /></label>
    <label>Decks in the shoe<select id="bs-decks">${[6, 8].map((v) => `<option value="${v}"${v === s.decks ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <button class="btn primary" data-act="save-settings">${S.role === 'host' ? 'Save' : 'Ask for a vote'}</button>
    <p class="hint">Changes start when no bets are on the table. A new number of decks starts with the next shoe.</p></div>`;
}
// The dealer's list: every seated player, with Unseat (after this round while one is in play).
function unseatHTML(st) {
  const later = st.unseatLater || [], list = st.players.filter((p) => p.seat >= 0 && p.id !== S.myId && p.id !== st.bankId);
  return `<h3>Unseat a player</h3><div class="pk-players" id="unseat-box">${list.length ? list.map((p) => `<div class="pk-prow"><b>${esc(p.name)}</b><span>Seat ${p.seat + 1}${later.includes(p.id) ? ' · leaves after this round' : ''}</span><button class="btn small" data-act="d-unseat" data-id="${esc(p.id)}">${later.includes(p.id) ? 'Let stay' : 'Unseat'}</button></div>`).join('') : '<p class="hint">Nobody else is seated.</p>'}</div><p class="hint">They keep their chips and watch. A bet sits them down again. During a round they leave once it is over.</p>`;
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
    <details class="fair-how"><summary>How nobody sees the next cards</summary>
    <p>Each card needs two things to come out: the host's hidden seed and a key from the guests' browsers. Only a guest's browser can make the key, and it is different for every card. So the host's browser holds the shoe but cannot tell which card comes next, and a guest cannot read a card without the host's seed.</p>
    <p>A guest's browser gives keys only once the bets are locked, only for the next cards of the round, at most two at a time. It never gives keys for cards further ahead, so nobody can look at the next round before betting.</p>
    <p>Every key a guest gives out has to be used for a card the table really deals within 5 seconds, and no bet may change after the keys are given. If a key is asked for out of turn, taken and not used (to look at a card first), or a bet changes, the guest's browser stops the game for everyone with "Network security breached". The host can then resume.</p>
    <p>The player who peels a side sees those cards first, as at a real table. With no guest at the table, the host's browser makes the keys itself as it deals.</p></details>
    ${S.alert ? '<p class="down"><b>Network security breached.</b> The game was paused.</p>' : ''}
    <p>When a shoe is finished its seed and the card keys open, and your browser shuffles it again and checks every card that was dealt.</p>
    <table class="pk-table"><tr><th>Shoe</th><th>Code</th><th>Dealt</th><th>Check</th></tr>${rows || '<tr><td colspan="4">No finished shoe yet.</td></tr>'}</table></div>`;
}

// ---------- Clicks ----------
function copyLink() {
  const link = inviteLink();
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
    case 'become-host': becomeHost(); break;
    case 'office': modal(officeLedgerHTML(S.code, S.myId)); break;
    case 'log': closeMenu(); modal(`<h3>Round log</h3><div class="log pk-log">${st.log.map((l) => `<div>${esc(l)}</div>`).reverse().join('')}</div>`); break;
    case 'rules': closeMenu(); modal(rulesHTML(st)); break;
    case 'fair': closeMenu(); modal(fairHTML(st)); break;
    case 'settings': closeMenu(); modal(settingsHTML(st)); break;
    case 'save-settings': {
      const patch = {};
      for (const k of ['minBet', 'maxBet', 'maxSide', 'startChips', 'betTime', 'decks']) patch[k] = Number($('#bs-' + k).value);
      if (S.role !== 'host') { send({ t: 'propose', patch }); toast('Sent. Everyone else at the table votes.'); }
      else if (t.canDeal() || t.phase !== 'betting') { S.pendingSettings = patch; toast('Saved. The new settings start when no bets are on the table.'); }
      else { t.updateSettings(patch); toast('Settings saved.'); push(); }
      $('#modal').close();
      break;
    }
    case 'players': closeMenu(); modal(playersHTML(st)); break;
    case 'unseat-list': closeMenu(); modal(unseatHTML(st)); break;
    case 'd-unseat': send({ t: 'unseat', id: el.dataset.id }); setTimeout(() => { if ($('#unseat-box')) modal(unseatHTML(S.st)); }, 400); break;
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
watchOffice('baccarat', () => S.code, (g, list, view) => { (S.views ||= {})[g] = markMyTurn(g, view, S.myId); S.others[g] = list.filter((p) => p.id.split('#')[0] !== S.myId); S.room?.setOthers(S.others, S.views); });
// Everyone in the office, live: where each person walks and looks, and the moves they make (js/presence.js).
S.live = startPresence({ game: 'baccarat', room: () => S.room, code: () => S.code, me: () => ({ id: S.myId, name: S.name, look: getLook() }), at: () => !!S.room?.hasPerson(S.myId), phone: innerWidth < 700 });

// "Connection dropped" notice and blocked buttons while this browser has no link to the table (common.js showDropped).
setInterval(() => showDropped(!!S.hold || (S.role === 'guest' && !!S.st && !!S.conn && S.conn[1] === false && document.body.classList.contains('in-room')), S.hold ? "The table is moving to your browser. One moment…" : 'Your moves are not being sent. The table waits for the host. If the host is gone, you can take over.', S.hold ? null : becomeHost), 400);

// "Network security breached": the game is paused for everyone until the host resumes it.
setInterval(() => breachCover(!!S.st?.halted, S.role === 'host', () => { if (S.role === 'host' && S.table) { S.table.resume(); push(); } }), 400);

// ---------- One wallet for the office (common.js walkTo) ----------
// This table's ledger lines for the office ledger.
function officeRows(st) { return (st?.players || []).map((p) => ({ id: p.id, name: p.name, chips: p.chips, net: p.net })); }
// Walking to another table takes this player's chips along. A host cashes out at its own table.
autoUpdate(GAME, () => !S.hold && !S.handing && !S.taking && S.st?.phase !== 'peel');
onOfficeBack(GAME, () => S.code, () => S.role === 'host', (c) => { S.table?.carryIn(S.myId, c.amount, c.from, c.cid); push(); }, (m) => S.net?.send(m));
setSeated(() => Number.isInteger(S.st?.players?.find((p) => p.id === S.myId)?.seat));
setCashOut(async () => {
  if (S.role === 'host' && S.table) { const amount = S.table.cashOut(S.myId); push(); await new Promise((r) => setTimeout(r, 700)); return amount; }
  if (S.role === 'guest' && S.st) return askCashOut((m) => S.net.send(m));
  return 0;
});
