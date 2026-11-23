// The poker page: a Texas Hold'em table for up to 9 in the big meeting room. The host's browser runs
// the table (js/poker.js); every other browser sends its moves there and is told only what it may see.
import { outerLink } from './shell.js?v=20261122zk';
import { PokerTable, POKER_SEATS, pokerDeck, cardText, mpClientMoves, mpMine, mpCheck, bestHand, bestOmaha } from './poker.js?v=20261122zk';
import { plainDeck, shufflePass, lockPass, checkDeck, keyFor } from './mental.js?v=20261122zk';
import { sha256 } from './game.js?v=20261122zk';
import { botMove, isBot, BOT_NAMES } from './pokerbot.js?v=20261122zk';
import { chipSound, cardSound, hitSound, standSound, potSound, tickSound, turnSound, punchSound } from './fx.js?v=20261122zk';
import { webglOK, initRoom } from './room3d.js?v=20261122zk';
import { topToolsHTML, initTopTools, setProfit, cardScale } from './toptools.js?v=20261122zk';
import { showDropped, markMyTurn, onOfficeBack, setSeated, officeView, params, $, safeGet, safeSet, safeDel, getClientId, getLook, esc, money, newCode, randomHex, toast, modal, cardHTML, gameSwitchHTML, wireGameSwitch, createHost, createGuest, watchOffice, goToGame, walkTo, setCashOut, carryFor, carryDone, askCashOut, gotCashed, officeSave, officeLedgerHTML } from './common.js?v=20261122zk';

import { shareHidden, startHold } from './vault.js?v=20261122zk';
import { votePropose, voteCast, voteTick, voteView, drawVote } from './vote.js?v=20261122zk';
const PREFIX = 'bjt-pk-';
// A settings change by vote (js/vote.js): any player at the table may ask, every other player at the table who is online has to say yes.
const VOTE = {
  labels: { smallBlind: ['Small blind'], bigBlind: ['Big blind'], ante: ['Ante'], startStack: ['Starting chips'], turnTimer: ['Seconds per turn'], timeBank: ['Time bank'],
    sevenDeuce: ['7-2 bounty'], bombPotEvery: ['Bomb pot every'], bombPotAnte: ['Bomb pot ante'], runTimes: ['Run it'], straddle: ['Straddle'], autoStart: ['Deal by itself'], doubleBoard: ['Two boards'],
    game: ['Game', (v) => (v === 'plo' ? 'Omaha' : "Hold'em")], bombGame: ['Bomb pot game', (v) => (v === 'plo' ? 'Omaha' : v === 'nlh' ? "Hold'em" : 'same as the table')], bombBoards: ['Bomb pot boards', (v) => (v ? String(v) : 'same as the table')], showSpeed: ['Showdown speed'], botLevel: ['Bots', (v) => (v === 'hard' ? 'Hard' : 'Easy')] },
  seated: (id) => S.table.seatOf(id) >= 0,
  voters: (by) => S.table.seats.filter((x) => x && x.id !== by && !isBot(x.id) && S.table.players[x.id]?.connected).map((x) => x.id),
  name: (id) => S.table.players[id]?.name || 'A player',
  canApply: () => !S.table.inHand(),
  apply: (patch) => S.table.updateSettings(patch),
  log: (text) => S.table.addLog(text),
};
const app = $('#app');
const GAME = 'poker';
const S = { name: safeGet('bj-name') || '', myId: getClientId(), code: null, role: null, table: null, st: null, net: null, room: null,
  conn: ['Connecting', false], raiseTo: null, raiseFor: '', seedFor: '', boardSeen: { hand: -1, n: 0 }, doneAt: 0, started: false, paused: false, at: 0, goneAt: {}, autoAway: {} };
try { S.testMode = localStorage.getItem('pk-test') === '1'; } catch {}
if (params.has('roomdebug')) { window.__P = S; window.__pk = { push: () => push(), render: () => render(), ring: () => ({ g: ringMeasure(), key: S.ringKey, plan: S.ringPlan }) }; }
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
    gone: (id) => { S.table?.disconnect(id); S.goneAt[id] = Date.now(); push(); },
    status: (text, ok) => { S.conn = [text, ok]; drawConn(); if (ok && S.role === 'host') carryDone(GAME, S.code); },
    taken: () => {
      if (Date.now() < (S.retakeUntil || 0)) { try { S.net.close(); } catch {} setTimeout(() => { if (S.role === 'host' && S.table) openHost(code); }, 1500); return; } // the old host is still letting go of the address
      // someone already runs this table (your own other tab, or a player who took the table over): join it instead
      S.hold = null; S.net.close(); clearInterval(S.clock); S.table = null; startGuest(code, true);
    },
  });
  clearInterval(S.clock);
  S.clock = setInterval(hostClock, 200);
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
  const kept = S.net.vault?.();
  try { S.net.close(); } catch {}
  const oldHost = st.hostId, oldName = st.players.find((p) => p.id === oldHost)?.name || 'The host';
  const hold = startHold(kept);
  const finish = (text) => {
    if (S.role !== 'host' || S.hold !== hold) return;
    let t = null;
    try { if (text) t = PokerTable.fromHidden(JSON.parse(text), st, S.myId); } catch { t = null; }
    const same = !!t;
    if (!t) t = PokerTable.fromPublic(st, S.myId, myKept(st));
    t.join(S.myId, S.name, getLook());
    t.addLog(`${oldName}'s browser left. The table now runs in ${S.name}'s browser${t.inHand() ? (same ? ' and the hand goes on with the same deck, card for card' : ' and the hand goes on') : ''}.`);
    const now = Date.now();
    for (const p of Object.values(t.players)) if (p.id !== S.myId) S.goneAt[p.id] = now;
    S.table = t; S.started = st.handNo > 0; S.paused = false; S.doneAt = 0;
    // Computer players move with the table.
    for (const p of Object.values(t.players)) if (isBot(p.id)) { p.connected = true; delete S.goneAt[p.id]; }
    if (same) { S.waitFor = []; S.waitUntil = 0; }
    else {
      // The old deck could not be opened. Players still in the hand get a few seconds to hand in their cards before anyone can act.
      // The computer players' old cards stayed in the old host's browser, so they get two unseen cards.
      for (const i of t.missingCards()) if (isBot(t.seats[i].id)) { try { t.redraw(i); } catch {} }
      S.waitFor = t.missingCards().map((i) => t.seats[i].id).filter((id) => id !== oldHost);
      S.waitUntil = now + 12000;
      t.waitCards = S.waitFor.length > 0;
    }
    S.hold = null; S.vault = null;
    // Players who came back while the pieces were collected.
    for (const [id, m] of Object.entries(hold?.hellos || {})) { try { hostMsg(id, m); } catch {} }
    push();
  };
  S.role = 'host'; S.table = null; S.hold = hold;
  openHost(S.code);
  toast('The host left. The table now runs in your browser.');
  if (hold) hold.done.then(finish); else finish(null);
}
// ---------- "Become host": any player takes the table into their browser, no vote ----------
// The host's browser sends its saved table (the same thing it keeps for a reload) and then joins as a player.
// The table never changes host on its own: when the host's browser is gone, it waits until a player presses Become host.
function handOver(id) {
  const t = S.table, p = t?.players[id];
  if (!p || S.handing || S.hold) { S.net.send(id, { t: 'err', msg: S.hold ? 'The table is still moving. Try again in a few seconds.' : 'Someone else is taking over right now.' }); return; }
  S.handing = true;
  t.addLog(`${p.name} took over as host. The table now runs in ${p.name}'s browser.`);
  push();
  const saved = safeGet('pk-host');
  if (!saved) { S.handing = false; return; }
  S.net.send(id, { t: 'host-give', saved });
  setTimeout(() => {
    S.handing = false;
    try { S.net.close(); } catch {}
    clearInterval(S.clock); S.table = null;
    safeSet('pk-host', 'null');
    startGuest(S.code, true);
    toast(`${p.name} is the host now. You are a player at the same table.`);
  }, 1000);
}
function takeGiven(m) {
  if (S.role !== 'guest' || S.taking) return;
  let ok = false;
  try { const x = JSON.parse(String(m.saved || '')); ok = x && x.code === S.code && !!x.table && !!PokerTable.restore(x.table); } catch { ok = false; }
  if (!ok) { toast('The table could not be handed over. Try again.'); return; }
  S.taking = true; clearTimeout(S.askT); clearTimeout(S.takeT); S.takeT = null;
  safeSet('pk-host', String(m.saved));
  try { S.net.close(); } catch {}
  S.retakeUntil = Date.now() + 20000;
  setTimeout(() => { S.taking = false; startHost(S.code, true); toast('You are the host now: keep this tab open.'); }, 2500);
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
function hostMsg(id, m) {
  // A host change is being settled: note who came back and ask for their piece of the key (js/vault.js).
  if (S.hold) { if (m.t === 'hello') { S.hold.hellos[id] = m; S.net.send(id, { t: 'piece-ask', kid: S.hold.kid }); } return; }
  const t = S.table;
  if (!t) return;
  if (m.t === 'host-ask') { handOver(id); return; }
  try {
    if (m.t === 'hello') { if (t.players[id]?.kicked) { S.net.send(id, { t: 'kicked' }); return; } t.join(id, m.name, m.look); if (m.carry && typeof m.carry === 'object') { try { t.carryIn(id, m.carry.amount, m.carry.from, m.carry.cid); } catch { /* fine */ } } if (m.mine) t.giveCards(id, m.mine.cards, m.mine.salt); delete S.goneAt[id]; if (S.autoAway[id]) { delete S.autoAway[id]; t.sitOut(id, false); } }
    else if (!t.players[id] || t.players[id].kicked) return;
    else if (m.t === 'carry') { if (m.carry && typeof m.carry === 'object') t.carryIn(id, m.carry.amount, m.carry.from, m.carry.cid); } // chips brought back to a table that stayed open
    else if (m.t === 'cashout') { let amount = 0, err = null; try { amount = t.cashOut(id); } catch (e) { err = e.message; } S.net.send(id, { t: 'cashed', rid: m.rid, amount, err }); }
    else doMove(id, m);
  } catch (e) { S.net.send(id, { t: 'err', msg: e.message }); }
  push();
}
// One player's request, checked by the table itself.
function doMove(id, m) {
  const t = S.table;
  switch (m.t) {
    case 'propose': votePropose(t, VOTE, id, m.patch); break;
    case 'vote': voteCast(t, VOTE, id, !!m.yes); break;
    case 'sit': t.sit(id, Number(m.seat), m.buyIn); break;
    case 'move': t.moveSeat(id, Number(m.seat)); break;
    case 'stand': t.standUp(id); break;
    case 'leave-later': t.leaveLater(id, m.on !== false); break;
    case 'act': if (t.waitCards) throw new Error('One moment: the table just moved to a new host.'); t.act(id, m.a, m.amount); break;
    case 'cards': t.giveCards(id, m.cards, m.salt); break;
    case 'away': t.sitOut(id, !!m.on); break;
    case 'add': { const x = t.seats[t.seatOf(id)], broke = x && x.stack === 0; t.addChips(id, m.amount); if (broke && x.out && x.stack > 0) t.sitOut(id, false); break; } // chips after going broke bring the player back in
    case 'take': t.takeChips(id, m.amount); break;
    case 'vaway': t.voteAway(id, String(m.id), !!m.on); break;
    case 'fx': relayFx(id, m.e); break;
    case 'show': if (t.mp && m.keys && m.sid === t.mp.sid) t.mpKeys(id, m.keys); t.showCards(id, m.which); break;
    case 'punch': t.punchWinner(id, !!m.test); break;
    case 'rabbit': t.rabbitHunt(id); break;
    case 'straddle': t.setStraddle(id, !!m.on); break;
    case 'runs': t.setRuns(id, m.n); break;
    case 'runpick': t.runPick(id, m.n); break;
    case 'runans': t.runAnswer(id, !!m.yes); break;
    case 'seed': t.setClientSeed(id, m.seed, m.commit); break;
    case 'mp-step': { const w = S.mpWait; if (w && w.id === id && w.sid === m.sid && w.step === m.step && checkDeck(m.deck)) { S.mpWait = null; w.res(m.deck); } break; }
    case 'mp-keys': if (t.mp && m.sid === t.mp.sid) t.mpKeys(id, m.keys); break;
    case 'mp-muck': if (t.mp && m.sid === t.mp.sid) t.mpMuck(id); break;
    default: break;
  }
  if (t.mp?.need) t.mpResume(); // keys or an answer may let the hand go on
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
// A punch after a bad beat, on every screen: in the 3D room the loser's figure gets up, walks round the table
// and punches the winner's figure; on every table comic words pop over the winner's seat and the felt shakes.
function showPunch(st) {
  const box = $('#pk-fx'), k = st.punch, ms = Math.max(1500, Math.min(PUNCH_MS, k.left || PUNCH_MS));
  const A = st.seats[k.from], B = st.seats[k.to];
  if (!box || !A || !B) return;
  S.room?.punch?.(A.id, B.id, ms);
  const L = seatLayout(st), Pa = toward(L.at(k.from), 0.8), Pb = toward(L.at(k.to), 0.72), felt = $('#felt');
  const flat = !S.room, t0 = Date.now(), words = ['POW!', 'BAM!', 'WHACK!', 'OOF!', 'SMACK!', 'BONK!'];
  felt?.classList.add('pk-brawl'); setTimeout(() => felt?.classList.remove('pk-brawl'), ms);
  const bar = document.createElement('div');
  bar.className = 'pk-punchbar'; bar.innerHTML = `<b>👊 ${esc(A.name)} punches ${esc(B.name)}</b><i style="animation-duration:${ms}ms"></i>`;
  document.body.append(bar); setTimeout(() => bar.remove(), ms + 200);
  // The fist: on a flat table it flies from the loser's plate to the winner's and stays there, hitting.
  let fist = null;
  if (flat) { fist = document.createElement('div'); fist.className = 'pk-fist'; fist.textContent = '👊'; fist.style.left = Pa.x + '%'; fist.style.top = Pa.y + '%'; box.append(fist); requestAnimationFrame(() => { fist.style.left = Pb.x + '%'; fist.style.top = Pb.y + '%'; }); setTimeout(() => fist.remove(), ms); }
  let n = 0;
  const hit = () => {
    const gone = Date.now() - t0;
    if (gone > ms * 0.86 || !document.body.contains(box)) return;
    const el = document.createElement('div');
    el.className = 'pk-pow pk-stand'; el.textContent = words[n++ % words.length];
    el.style.left = Pb.x + (Math.random() * 14 - 7) + '%'; el.style.top = Pb.y + (Math.random() * 8 - 6) + '%'; el.style.setProperty('--rot', (Math.random() * 30 - 15).toFixed(0) + 'deg');
    box.append(el); setTimeout(() => el.remove(), 700);
    try { punchSound(); } catch { /* sound is never worth an error */ }
    setTimeout(hit, 330);
  };
  setTimeout(hit, Math.round(ms * 0.26)); // the first hit comes when the walk round the table is over
}
// ---------- Locked cards (js/mental.js) ----------
// This browser's secret locks, by hand: sid -> { sid, a, b }. Kept in the browser so a reload carries on.
S.mpSec = (() => { try { return JSON.parse(safeGet('pk-mp') || '{}') || {}; } catch { return {}; } })();
S.mpSent = new Set();
function mpSave() {
  const keep = Object.values(S.mpSec).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 3);
  S.mpSec = Object.fromEntries(keep.map((x) => [x.sid, x]));
  safeSet('pk-mp', JSON.stringify(S.mpSec));
}
// Runs on every browser, the host's too, each time the table changes: opens this browser's own cards,
// checks the public cards against their locks, and gives the keys the table is waiting for.
function mpLocal(st) {
  const m = st?.mp;
  if (!m) return;
  const sec = S.mpSec[m.sid], me = st.seats.findIndex((x) => x && x.id === S.myId);
  let mine = S.mpMine?.sid === m.sid ? S.mpMine.cards : null;
  if (!mine) { const c = mpMine(st, S.myId, sec); if (c?.bad) mpAlarm(m.sid); else if (c) { mine = c; S.mpMine = { sid: m.sid, cards: c }; } }
  if (me >= 0 && st.seats[me].inHand) {
    const x = st.seats[me];
    x.cards = mine ? mine.map((c) => ({ ...c })) : x.cards.map((c) => (c && c.h === undefined ? c : null));
    if (mine && !x.hand && !x.folded && st.board.length >= 3) { const b = (bd) => (st.plo ? bestOmaha(mine, bd) : bestHand([...mine, ...bd])).name; x.hand = b(st.board) + (st.dbl ? ' | ' + b(st.board2 || []) : ''); }
  }
  if (mpCheck(st)) mpAlarm(m.sid);
  for (const msg of mpClientMoves(st, S.myId, sec, mine, S.mpSent)) {
    if (S.role === 'host') queueMicrotask(() => { try { doMove(S.myId, msg); } catch {} push(); });
    else S.net?.send(msg);
  }
}
function mpAlarm(sid) {
  if (S.mpAlarmFor === sid) return;
  S.mpAlarmFor = sid;
  console.warn('[poker] a card did not match its locks');
  toast('Network security breached: a card did not match its locks.');
}
// A guest's turn in the shuffle: lock every card and shuffle, or swap the lock for one per card.
function mpStep(m) {
  try {
    if (m.step === 'shuf') {
      if (m.first && JSON.stringify(m.deck) !== JSON.stringify(plainDeck())) return; // the first browser starts from the plain deck
      const r = shufflePass(m.deck);
      S.mpSec[m.sid] = { sid: m.sid, a: r.a, at: Date.now() };
      S.net.send({ t: 'mp-step', sid: m.sid, step: 'shuf', deck: r.deck });
    } else if (m.step === 'lock') {
      const sec = S.mpSec[m.sid];
      if (!sec?.a || sec.b) return;
      const r = lockPass(m.deck, sec.a);
      sec.b = r.b; delete sec.a; mpSave();
      S.net.send({ t: 'mp-step', sid: m.sid, step: 'lock', deck: r.deck });
    }
  } catch { /* a bad deck: no answer, the host deals without this browser */ }
}
function mpAsk(id, sid, step, deck, first) {
  return new Promise((res, rej) => {
    S.mpWait = { id, sid, step, res };
    S.net.send(id, { t: 'mp-step', sid, step, deck, first });
    setTimeout(() => { if (S.mpWait && S.mpWait.sid === sid && S.mpWait.id === id && S.mpWait.step === step) { S.mpWait = null; rej(new Error('no answer')); } }, 7000);
  });
}
// Before a hand: every player's browser in the hand locks and shuffles the deck in turn, the host's last.
// A browser that does not answer sits this hand out.
async function mpPrepare(t) {
  const sid = randomHex(12), seats = t.eligible().filter((i) => !(S.mpSkip?.[t.seats[i].id] > Date.now()));
  const guests = seats.map((i) => t.seats[i].id).filter((id) => id !== S.myId && !isBot(id) && t.players[id]?.connected !== false);
  let deck = plainDeck(), first = true;
  const done = [];
  for (const g of guests) {
    try { deck = await mpAsk(g, sid, 'shuf', deck, first); first = false; done.push(g); }
    catch { (S.mpSkip ||= {})[g] = Date.now() + 15000; }
  }
  const r = shufflePass(deck); deck = r.deck;
  S.mpSec[sid] = { sid, a: r.a, at: Date.now() };
  for (const g of done) {
    try { deck = await mpAsk(g, sid, 'lock', deck); }
    catch { (S.mpSkip ||= {})[g] = Date.now() + 15000; return null; } // its lock is on every card now: shuffle again without it
  }
  const own = lockPass(deck, S.mpSec[sid].a);
  S.mpSec[sid].b = own.b; delete S.mpSec[sid].a; mpSave();
  const parts = [...done, S.myId];
  const skip = t.eligible().filter((i) => !isBot(t.seats[i].id) && !parts.includes(t.seats[i].id));
  return { mp: { sid, deck: own.deck, parts }, skip };
}
// Deals the next hand with locked cards. Runs once at a time; the table shows that the deck is being shuffled.
async function dealHand() {
  const t = S.table;
  if (!t || S.mpBusy) return;
  S.mpBusy = true; t.shuffling = true; push();
  try {
    let opts = null;
    for (let n = 0; n < 3 && !opts; n++) opts = await mpPrepare(t);
    if (!opts || S.table !== t || t.inHand() || !t.canStart()) return;
    try { t.startHand(opts); } catch (e) { toast(e.message); return; }
    S.doneAt = 0;
  } catch (e) { console.warn('[poker] deal', e); }
  finally { S.mpBusy = false; t.shuffling = false; push(); }
}
function push() {
  const t = S.table;
  if (!t) return;
  for (const id of S.net.ids()) S.net.send(id, { t: 'state', st: { ...t.publicState(id), vote: voteView(t, VOTE, id) } });
  // The deck and the cards nobody else may see go along locked, so the same deck goes on if this browser leaves.
  shareHidden(S, S.net, t.seats.filter((x) => x && x.id !== S.myId && !isBot(x.id) && t.players[x.id]?.connected).map((x) => x.id), t.hidden());
  S.st = { ...t.publicState(S.myId), vote: voteView(t, VOTE, S.myId) };
  mpLocal(S.st);
  keepMine(S.st);
  S.at = Date.now();
  try { safeSet('pk-host', JSON.stringify({ code: S.code, table: { ...t, log: t.log.slice(-60), hist: t.hist.slice(-40) } })); } catch {}
  render();
}
function hostClock() {
  const t = S.table;
  if (!t) return;
  if (voteTick(t, VOTE)) push();
  const now = Date.now();
  if (t.waitCards) {
    const miss = t.missingCards().map((i) => t.seats[i].id);
    if (!t.inHand() || now > S.waitUntil || !(S.waitFor || []).some((id) => miss.includes(id))) { t.waitCards = false; t.turnStarted = now; push(); }
    return;
  }
  if (S.mpBusy) return; // the players' browsers are locking and shuffling the next deck
  // Locked cards: the hand waits for keys or for a player to show or muck. A browser that does not answer in time is passed over.
  if (t.mp?.need) {
    const n = t.mp.need, limit = n.kind === 'sd' ? 30000 : n.kind === 'rescue' ? 10000 : 25000;
    if (t.mpResume()) { push(); return; }
    if (now - n.at > limit) { t.mpTimeout(); push(); }
    if (t.inHand()) return;
  }
  if (t.inHand()) {
    S.doneAt = 0;
    // The run it question waits 10 seconds for each step, then the board is dealt once.
    if (t.runAsk && !t.runAsk.done) {
      // Computer players answer the run it question after a second: they deal once, and say yes to what a person asks.
      const a = t.runAsk;
      if (now - a.at > 1000) {
        try {
          if (!a.n && isBot(t.seats[a.by]?.id)) { t.runPick(t.seats[a.by].id, 1); push(); return; }
          const b = a.n ? a.need.find((q) => !a.yes.includes(q) && isBot(t.seats[q]?.id)) : undefined;
          if (b !== undefined) { t.runAnswer(t.seats[b].id, true); push(); return; }
        } catch { /* the question was settled meanwhile */ }
      }
      if (now - a.at > RUN_ASK_MS) { t.runTimeout(); push(); }
      return;
    }
    // A computer player plays once its cards are open (the players' browsers send their keys at the deal).
    if (t.turn !== null && isBot(t.seats[t.turn].id) && t.mp && !t.known(t.turn) && now - (t.turnStarted || now) < 10000) return;
    if (t.turn !== null && isBot(t.seats[t.turn].id)) {
      // A computer player's turn: it "thinks" for 0.9 to 1.7 seconds (after the beat, when it is first to act on a street), then plays from its own cards and the board.
      const id = t.seats[t.turn].id, think = (t.seats.some((x) => x && x.acted) ? 0 : BEAT_MS) + 900 + ((t.handNo * 7 + t.turn * 13 + t.board.length * 5 + Math.round(t.currentBet)) % 9) * 100;
      if (now - (t.turnStarted || now) > think) {
        try { const m = botMove(t, id); if (m) t.act(id, m.a, m.amount); }
        catch { try { const o = t.options(id); t.act(id, o.canCheck ? 'check' : 'fold'); } catch { /* not its turn any more */ } }
        push();
      }
      return;
    }
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
  // A player with no chips left has 20 seconds to buy in again; after that they sit out, so the others are never stuck.
  S.brokeT ||= {};
  for (const x of t.seats) {
    if (!x) continue;
    // A computer player with no chips buys in again at once (it is in the ledger like any buy in).
    if (isBot(x.id) && x.stack <= 0) { try { t.addChips(x.id, t.settings.startStack); push(); } catch {} continue; }
    if (x.stack > 0 || x.out) { delete S.brokeT[x.id]; continue; }
    S.brokeT[x.id] ||= now;
    if (now - S.brokeT[x.id] > 20000) { delete S.brokeT[x.id]; t.sitOut(x.id, true); t.addLog(`${t.players[x.id]?.name || 'A player'} has no chips and sits out.`); push(); }
  }
  if (t.phase === 'done' && !S.doneAt) S.doneAt = now;
  // Before a deal: a player whose browser has been gone for 40 seconds is marked away, so no blinds are taken
  // from them. They keep the seat and the chips, and are back in as soon as their browser returns.
  for (const x of t.seats) {
    if (!x || x.out) continue;
    const gone = S.goneAt[x.id];
    if (t.players[x.id]?.connected === false && gone && now - gone > 40000) { t.sitOut(x.id, true); S.autoAway[x.id] = true; t.addLog(`${t.players[x.id].name} is offline and was marked away.`); push(); }
  }
  const r = t.result;
  // A punch after a bad beat: the table stops for 5 seconds while everyone watches. While a player may still
  // punch, the next hand waits 4 seconds longer. A computer player with a bad beat punches most of the time.
  if (!t.inHand() && t.punch && now - t.punch.at < PUNCH_MS + 700) return;
  if (t.phase === 'done' && t.punch) { /* the punch is over */ }
  else if (t.phase === 'done' && t.beats && Object.keys(t.beats).length) {
    for (const i of Object.keys(t.beats)) { const x = t.seats[i]; if (x && isBot(x.id) && now - S.doneAt > BEAT_MS + SHOW_MS + 1300 && (t.handNo + Number(i)) % 4 !== 0) { try { t.punchWinner(x.id); push(); } catch {} return; } }
    if (now - S.doneAt < endWait(r) + 4000) return;
  }
  // A rabbit hunt is shown slowly: the next hand waits until every card has been turned and seen.
  if (!t.rabbit) S.rabUntil = 0; else if (!S.rabUntil) S.rabUntil = now + t.rabbit.length * RABBIT_MS + 2500;
  if (S.rabUntil && now < S.rabUntil) return;
  // Too few players for a new hand (away, or out of chips): once the result has been shown, the cards are
  // collected and the table waits. It deals again by itself as soon as two players can play.
  if (t.phase === 'done' && !t.canStart() && now - S.doneAt >= endWait(r) + 1500) { t.clearHand(); S.doneAt = 0; push(); return; }
  if (!S.started || S.paused || !t.settings.autoStart || !t.canStart()) return;
  const wait = t.phase === 'done' ? endWait(r) : 800;
  if (now - (S.doneAt || 0) >= wait) dealHand();
}

// ---------- Guest ----------
function startGuest(code, again) {
  S.role = 'guest'; S.code = code; S.st = null; S.nohost = false;
  history.replaceState(null, '', shareLink());
  if (!again || !$('#pk-body')) showTable(); else render();
  const mineNow = () => { try { const m = JSON.parse(safeGet('pk-mine') || 'null'); return m && String(m.k).startsWith(code + '#') ? { cards: m.cards, salt: m.salt } : undefined; } catch { return undefined; } };
  S.net = createGuest(PREFIX + code, () => ({ t: 'hello', id: S.myId, name: S.name, look: getLook(), carry: carryFor(GAME, code) || undefined, mine: mineNow() }), {
    msg: (m) => {
      if (m.t === 'state') {
        const st = m.st;
        clearTimeout(S.takeT); S.takeT = null;
        // After a move of the table the new host does not know this browser's cards until they are handed in.
        const x = st.seats.find((q) => q && q.id === S.myId);
        if (x && x.inHand && x.cards.length === 2 && !x.cards[0]) { const k = myKept(st); if (k) { x.cards = k.cards; S.net.send({ t: 'cards', cards: k.cards, salt: k.salt }); } }
        if (S.st && st.hostId !== S.st.hostId) toast(`The table now runs in ${st.players.find((p) => p.id === st.hostId)?.name || 'another player'}'s browser.`);
        S.st = st; mpLocal(st); keepMine(st); S.at = Date.now(); S.nohost = false; render(); sendSeed();
      }
      else if (m.t === 'err') toast(m.msg);
      else if (m.t === 'mp-step') mpStep(m);
      else if (m.t === 'cashed') gotCashed(m);
      else if (m.t === 'host-give') takeGiven(m);
      else if (m.t === 'fx') showFx(m.from, m.e);
      else if (m.t === 'kicked') { S.net.close(); showLanding('The host removed you from the table.'); }
    },
    status: (text, ok) => { S.conn = [text, ok]; drawConn(); },
    // Nobody has opened this table yet: whoever walks up to it first opens it (and stays its host).
    nohost: () => { S.nohost = true; if (!S.st) { render(); if (!again && params.get('from') && !S.openT) S.openT = setTimeout(() => { S.openT = null; if (S.role === 'guest' && S.nohost && !S.st && S.code === code) { S.net.close(); startHost(code, false); } }, 2500); } else watchHost(); },
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
  if (S.hold) { toast('One moment: the table is moving to your browser.'); return; }
  if (S.role === 'host') { try { doMove(S.myId, m); } catch (e) { toast(e.message); } push(); }
  else if (!S.net?.send(m)) toast('Not connected to the host right now.');
}
// The link friends get: inside the office it is the office link, which never changes as you walk between tables.
const inviteLink = () => outerLink(shareLink(), 'poker');
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
  initTopTools({ css: true });
  document.body.classList.add('in-room');
  const d3 = use3D();
  app.innerHTML = `
    <div class="topbar">
      ${gameSwitchHTML('poker')}
      <span id="conn-pill" class="pill">Connecting</span>
      <span class="spacer"></span>
      ${topToolsHTML()}
      <button class="btn small" id="away-top" data-act="away" hidden title="Away: sit out the next hands">💺</button><button class="btn small primary" id="host-run" data-act="hostrun" hidden></button>
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
      S.room = initRoom($('#room'), felt, { phone: phone(), pixel: safeGet('bj-pixel') === '1', hud: $('#hud3d'), size: F, game: 'poker', onGo: (g, now) => goToGame('poker', g, S.code || params.get('room'), S.role === 'host', now), metres: F.H > F.W ? 2.0 * F.W / F.H : 2.4 });
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
const RANKS_UI = [['Royal flush', 9, '👑'], ['Straight flush', 8, '⚡'], ['Four', 7, '💎', 'Four of a kind'], ['Full house', 6, '🏠'], ['Flush', 5, '🌊'], ['Straight', 4, '📏'], ['Three', 3, '🔱', 'Three of a kind'], ['Two pair', 2, '✌️'], ['Pair', 1, '👥'], ['', 0, '🂠', 'High card']];
// The short name of a hand, without which cards make it: 'Pair of queens' is shown as 'Pair'. The log keeps the long one.
const shortHand = (name) => String(name || '').split(' | ').map((h) => { const r = RANKS_UI.find((x) => h.startsWith(x[0])); return r[3] || r[0]; }).join(' | ');
function rankBadge(seat) {
  if (!seat || !seat.hand || !seat.inHand || seat.folded) return '';
  const parts = seat.hand.split(' | ');
  if (parts.length > 1) return `<div class="pk-rank flat two t${Math.max(...parts.map((h) => RANKS_UI.find((r) => h.startsWith(r[0]))[1]))}">${parts.map((h, k) => { const [key, , icon, label] = RANKS_UI.find((r) => h.startsWith(r[0])); return `<b>${icon} Board ${k + 1}: ${label || key}</b>`; }).join('')}</div>`;
  const [key, tier, icon, label] = RANKS_UI.find((r) => seat.hand.startsWith(r[0]));
  return `<div class="pk-rank flat t${tier}"><b>${icon} ${label || key}</b></div>`;
}
const RABBIT_MS = 1300; // a rabbit hunt turns one card every this many milliseconds
const stepMs = () => Number(params.get('step')) || { fast: 2000, normal: 3000, long: 4000 }[(S.st || S.table)?.settings?.showSpeed] || 2000; // an all in board comes one street at a time, this many milliseconds apart
// The pace of a hand, as measured on a PokerNow table: the bets stay in front of the players for a beat before
// they go to the pot and the next card comes; at a showdown the cards turn first and the winner shows after;
// the next hand is dealt 3 seconds after a result (6 or 9 on the slower settings).
const BEAT_MS = Number(params.get('beat') ?? 800), SHOW_MS = 900, RUN_ASK_MS = 10000, PUNCH_MS = 5000;
const afterMs = () => ({ fast: 3000, normal: 6000, long: 9000 }[(S.st || S.table)?.settings?.showSpeed] || 3000);
const endWait = (r) => BEAT_MS + (r?.runout ? (r.runout.length + (r.boards && !r.dbl ? r.boards.length : 1)) * stepMs() + afterMs() : r?.showdown ? SHOW_MS + afterMs() : 3000);
// For the beat after a betting round, the screen shows the table as it was just before the bets were swept:
// the state before, with each seat's bet, chips and fold as noted by the table (st.swept). No hidden card is in it.
function beatView(real) {
  // prevSt is the last state from before the newest sweep (the host redraws the same moment more than once).
  if (S.curSt !== real) { if (!S.curSt || S.curSt.swept?.seq !== real.swept?.seq || S.curSt.handNo !== real.handNo) { S.prevSt = S.curSt; S.prevCards = S.curCards; } S.curSt = real; S.curCards = { board: [...(real.board || [])], board2: real.board2 ? [...real.board2] : null }; } // the host's state shares the table's own card lists, so they are copied
  const sw = real.swept, base = S.prevSt;
  if (sw && sw.seq !== S.beatSeq) {
    const first = S.beatSeq === undefined;
    S.beatSeq = sw.seq;
    S.beat = null;
    if (!first && BEAT_MS > 0 && base && base.handNo === real.handNo && sw.hand === real.handNo && base.phase !== 'done' && base.phase !== 'waiting' && base.seats.every((x, i) => !x === !real.seats[i] && (!x || x.id === real.seats[i].id))) {
      const any = sw.seats.some((x) => x && x.bet > 0);
      S.beat = { seq: sw.seq, until: Date.now() + (any ? BEAT_MS : Math.round(BEAT_MS * 0.55)), base, cards: S.prevCards || { board: base.board.slice(0, sw.board), board2: base.board2 ? base.board2.slice(0, sw.board) : null } };
      setTimeout(render, S.beat.until - Date.now() + 25);
    }
  }
  const b = S.beat;
  if (!b || b.seq !== sw?.seq || Date.now() >= b.until) { S.beat = null; return real; }
  return { ...b.base, board: b.cards.board.slice(0, sw.board), board2: b.cards.board2 ? b.cards.board2.slice(0, sw.board) : null, players: real.players, log: real.log, settings: real.settings, swept: sw, beat: true, pot: sw.pot, potTotal: sw.potTotal, turn: null, turnLeft: null, options: null, runAsk: null,
    seats: b.base.seats.map((x, i) => (x && sw.seats[i] ? { ...x, ...sw.seats[i] } : x)) };
}
// Where an all in showdown is in its show: which cards are out, whose chances to print, and whether the winners are known yet.
function runStage(st) {
  const ro = st.phase === 'done' && st.result?.runout ? st.result.runout : null;
  if (!ro) {
    // A plain showdown: the cards turn face up first, the winner and the chips show a moment later.
    if (st.phase !== 'done' || !st.result?.showdown) return null;
    if (S.shown?.hand !== st.handNo) { S.shown = { hand: st.handNo, t0: Date.now() }; setTimeout(render, SHOW_MS + 30); }
    const final = Date.now() - S.shown.t0 >= SHOW_MS;
    return { k: final ? 1 : 0, last: 1, final, n: 5, odds: null, boards: 99, plain: true };
  }
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
// Seat view on a computer ("ring"): the name plates stand round the outside of the table, so the middle is free for
// the pot and the board and nothing lies on top of anything else. The places are worked out on the screen, from where
// the table really is in the picture, and then turned back into places on the felt, so they hold for any screen shape.
// Per seat, counted clockwise from your own: dx, dy = the plate (dy from: n near edge, f far edge, b board bottom),
// bx, by = the bet, side = which end of the group the bubble lines up with. All in screen pixels of the design size.
const RING = [
  { dx: 0, from: 'n', dy: 0, bx: 175, bfrom: 'n', by: -26, side: '' },
  { dx: -450, from: 'n', dy: 0, bx: -255, bfrom: 'n', by: -26, side: 'bl' },
  { dx: -222, from: 'b', dy: -78, bx: -45, bfrom: 'b', by: -86, side: 'bl', out: 1 },
  { dx: -359, from: 'f', dy: -9, bx: -370, bfrom: 'c', by: 12, side: 'bl' },
  { dx: -120, from: 'f', dy: -9, bx: -145, bfrom: 'c', by: 12, side: '' },
  { dx: 120, from: 'f', dy: -9, bx: 145, bfrom: 'c', by: 12, side: '' },
  { dx: 359, from: 'f', dy: -9, bx: 370, bfrom: 'c', by: 12, side: 'br' },
  { dx: 222, from: 'b', dy: -78, bx: 45, bfrom: 'b', by: -86, side: 'br', out: 1 },
  { dx: 450, from: 'n', dy: 0, bx: 255, bfrom: 'n', by: -26, side: 'br' },
];
const useRing = () => !!S.room && !phone() && POKER_SEATS === RING.length;
// Where the felt is on the screen now: the far edge, the middle and the near edge (y), the middle (x) and half the far edge's width.
function ringMeasure() {
  const felt = $('#felt');
  if (!felt) return null;
  const at = (x, y) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;left:${x}%;top:${y}%;width:0;height:0`; felt.append(d); const r = d.getBoundingClientRect(); d.remove(); return r; };
  // Three places down the middle of the felt (0, 40 and 80 % from the far edge) fix the whole picture. The near edge
  // itself is not used: in the first person view it is under your chin, out of the picture.
  const f = at(50, 0), m = at(50, 40), n = at(50, 80), l = at(0, 0);
  // The line of text under the table is fixed on the screen: your own plate must end above it.
  const hud = $('#hud-top .status')?.getBoundingClientRect() || $('#hud-top')?.getBoundingClientRect();
  const g = { far: f.top, y40: m.top, y80: n.top, cx: f.left, hw: f.left - l.left, W: innerWidth, low: hud && hud.top > m.top ? hud.top - 6 : 1e9, fp: document.body.classList.contains('room-fp') };
  // Only a view from your own chair counts: the table upright and in the middle of the screen.
  if (!(g.far < g.y40 - 15 && g.y40 < g.y80 - 15 && g.hw > 120 && Math.abs(g.cx - innerWidth / 2) < innerWidth * 0.06 && g.y80 - g.y40 > g.y40 - g.far)) return null;
  return g;
}
// The places for one table picture. Returns the size factor for everything on the felt (k), the board's place and each seat's places.
function ringPlan(g) {
  const b = g.far, c = ((g.y80 - b) / 80 - (g.y40 - b) / 40) / (g.y40 - g.y80), a = (g.y40 - b) / 40 + g.y40 * c;
  const near = 1 + 100 * c > 0.08 ? (100 * a + b) / (1 + 100 * c) : 1e9; // the near edge of the felt on the screen, if it is in the picture
  const inv = (sy) => (sy - b) / (a - c * sy);                        // a height on the screen -> how far down the felt (%)
  const xAt = (sx, v) => 50 + ((sx - g.cx) * (1 + c * v) * 50) / g.hw; // a place across the screen -> how far across the felt (%)
  const u50 = g.hw / 620 / (1 + 50 * c);                               // screen pixels for one felt pixel, at the middle of the table
  // Everything between the far edge and the near edge: pot, board, your bubble, your plate. If the table looks too flat for it, all of it is drawn smaller.
  const uAt = (v) => g.hw / 620 / (1 + c * v);
  // The lowest line the near plates may reach: a little past the near edge of the felt, and above the text line under the table.
  // hang: how far a near plate ends below its place on the felt (measured on the screen after each drawing).
  const hang = g.hang ?? 28 * (u50 / 0.915);
  // ph: the height of your own plate on the screen for each unit of k (measured too: near things look taller than the sums say).
  const ph = g.ph ?? 44 * (u50 / 0.915);
  // The largest size at which pot and board still fit under the far plates.
  let fit = 1, s = 1, yb = 0, cardsTop = 0, low = 0;
  for (; fit >= 0.55; fit -= 0.02) {
    s = fit * (u50 / 0.915); low = Math.min(near + 12 * s, (g.low || 1e9) - 5, innerHeight * 0.86); yb = low - ph * 1.85 * fit * 1.72 - 14 * s;
    const ub = uAt(inv(yb)) * 1.85 * fit;
    cardsTop = yb - 82.6 * ub;
    if (cardsTop - 35 * ub >= g.far - 2) break;
  }
  const k = 1.85 * fit;
  const bh = 159.5 * k * uAt(inv(yb)); // half the width of the five board cards on the screen
  const base = { n: low - hang, f: g.far, b: yb, c: cardsTop };
  const lim = g.W / 2 - 150 * s;
  const seats = RING.map((r) => {
    const ay = base[r.from] + r.dy * s, av = inv(ay), by = base[r.bfrom] + r.by * s, bv = inv(by);
    const off = r.out ? Math.sign(r.dx) * bh : 0; // the seats at the two ends stand clear of the board, however wide it is
    const far = 1;
    const grow = Math.max(1, Math.min(g.fp ? 2.2 : 1, (far * (1 + c * av)) / (1 + 50 * c))); // far plates drawn larger (first person) need more room side by side
    const dx = Math.max(-lim, Math.min(lim, off + r.dx * s * grow));
    return { a: { x: xAt(g.cx + dx, av), y: av }, b: { x: xAt(g.cx + dx + (r.bx - r.dx) * s, bv), y: bv }, side: r.side, ds: Math.max(0.45, Math.min(g.fp ? 2.2 : 1, (far * (1 + c * av)) / (1 + 50 * c))), bs: Math.max(0.45, Math.min(g.fp ? 1.5 : 1, (1 + c * bv) / (1 + 50 * c))) };
  });
  return { k, board: inv(yb), pot: inv(g.far + (yb - g.far) * 0.45), seats, low, ownY: low - hang };
}
// The plan in use. A new measurement replaces it only when the picture has changed, so a look round the room does not move the plates.
function ringNow() {
  const g = ringMeasure();
  if (g) { if (S.ringHang !== undefined) { g.hang = S.ringHang; g.ph = S.ringPh; } const key = [g.far, g.y40, g.y80, g.cx, g.hw, Math.min(g.low, 9999), g.fp ? 3 : 0, g.hang ?? -1, (g.ph ?? -1) * 10].map((v) => Math.round(v / 3)).join(','); if (key !== S.ringKey) { S.ringKey = key; S.ringPlan = ringPlan(g); } }
  return S.ringPlan || ringPlan({ far: 284, y40: 389, y80: 541, cx: 720, hw: 449, W: 1440 });
}
function seatLayout(st) {
  const F = FELT(), spots = seatSpots(F.W, F.H);
  const mySeat = st.seats.findIndex((x) => x && x.id === S.myId);
  const rel = (i) => (i - Math.max(0, mySeat) + POKER_SEATS) % POKER_SEATS;
  return { mySeat, rel, at: (i) => spots[rel(i)] };
}
// Sounds for what just happened at the table: the deal, each new board card, and each player's move.
function playSounds(st) {
  const now = { hand: st.handNo, phase: st.phase, mine: !!st.options, cur: st.currentBet || 0, board: st.board.length + (st.board2?.length || 0), seats: st.seats.map((x) => x && { id: x.id, bet: x.bet, total: x.total, folded: x.folded, allIn: x.allIn, acted: x.acted, inHand: x.inHand }) };
  const was = S.snd; S.snd = now;
  if (!was) return;
  // What each player just did, shown over the name for two seconds (check, call, bet, raise, fold) and then gone.
  if (now.hand !== was.hand) S.said = {};
  else now.seats.forEach((x, i) => {
    const o = was.seats[i];
    if (!x || !o || x.id !== o.id || !x.inHand) return;
    let say = '';
    if (x.folded && !o.folded) say = 'Fold';
    else if (x.allIn && !o.allIn) say = '';                                   // "All in" stays on the plate by itself
    else if (x.total > o.total) say = now.cur > was.cur ? (was.cur > 0 ? 'Raise ' : 'Bet ') + amt(x.bet) : 'Call ' + amt(x.bet);
    else if (x.acted && !o.acted && now.board === was.board && now.phase === was.phase) say = 'Check';
    if (say) { (S.said ||= {})[i] = { text: say, until: Date.now() + 2000 }; clearTimeout(S.saidT); S.saidT = setTimeout(() => { if (S.st) render(); }, 2080); }
  });
  try {
    if (now.mine && !was.mine) { turnSound(); if (safeGet('pk-turnhome2') === '1') S.room?.turnHome?.(); } // your turn starts: a short beep for you only; the view moves back to your chair only if you turned that on
    if (now.hand !== was.hand && now.phase !== 'waiting' && now.phase !== 'done') { cardSound(); setTimeout(cardSound, 140); setTimeout(cardSound, 280); return; } // a new hand is dealt
    if (now.hand !== was.hand) return;
    if (now.board > was.board) { const n = Math.min(3, now.board - was.board); for (let k = 0; k < n; k++) setTimeout(cardSound, k * 200); } // one sound a card, in step with the cards coming out // flop, turn, river
    now.seats.forEach((x, i) => {
      const o = was.seats[i];
      if (!x || !o || x.id !== o.id || !x.inHand) return;
      if (x.folded && !o.folded) standSound();                                   // fold
      else if (x.allIn && !o.allIn) chipSound(7);                                  // all in
      else if (x.total > o.total) chipSound(x.total - o.total > st.settings.bigBlind * 4 ? 4 : 2); // call, bet or raise
      else if (x.acted && !o.acted && now.board === was.board) hitSound();        // check: a knock on the table
    });
    if (now.phase === 'done' && was.phase !== 'done' && st.result?.wins?.some((w) => st.seats[w.seat]?.id === S.myId)) potSound();
  } catch { /* sound is never worth an error */ }
}
// A folded player's cards lie on the table until the next card of the board comes out (flop, turn or river), then they are gone.
function foldGone(st, i) {
  const k = st.handNo + ':' + i, n = st.board.length + (st.board2?.length || 0), f = (S.foldAt ||= {});
  if (!(k in f)) f[k] = n;
  return n > f[k] || st.phase === 'done';
}
function render() {
  drawVote(S.st?.vote, send);
  const body = $('#pk-body');
  if (!body) return;
  const st = S.st ? beatView(S.st) : S.st;
  if (!st) {
    body.innerHTML = `<div class="pk-wait pk-stand">${S.nohost ? (params.get('open') ? 'Opening the table…' : 'The poker table is not open yet. Waiting for the host…') : 'Joining the table…'}</div>`;
    $('#tray').innerHTML = ''; $('#hud-top').innerHTML = '';
    return;
  }
  playSounds(st);
  setProfit(st.ledger?.find((r) => r.id === S.myId)?.net ?? null);
  officeSave(S.code, GAME, officeRows(st)); if (S.role === 'guest' && (st.ledger?.some((r) => r.id === S.myId))) carryDone(GAME, S.code);
  if (st.punch && S.punched !== st.punch.at) { S.punched = st.punch.at; if (st.punch.left > 400) showPunch(st); }
  const { mySeat, at, rel } = seatLayout(st);
  const ring = useRing(), plan = ring ? ringNow() : null;
  { const f = $('#felt'); if (f) { f.classList.toggle('ring', ring); if (plan) { f.style.setProperty('--k', plan.k.toFixed(3)); f.style.setProperty('--rb', plan.board.toFixed(2) + '%'); f.style.setProperty('--rp', plan.pot.toFixed(2) + '%'); } else { f.style.removeProperty('--k'); f.style.removeProperty('--rb'); f.style.removeProperty('--rp'); } } }
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
  // Rabbit hunt: the cards that would have come take the empty places on the board, one at a time and slowly.
  // Before anyone looked, those places are face down cards that a player dealt into the hand can tap.
  if (st.rabbit && S.rabSeen?.hand !== st.handNo) S.rabSeen = { hand: st.handNo, at: Date.now() };
  const rabAge = st.rabbit ? Date.now() - S.rabSeen.at : 0;
  const mineIn = st.seats.some((x) => x && x.id === S.myId && x.inHand);
  const canHunt = st.phase === 'done' && st.result?.early && st.settings.rabbitHunt && !st.rabbit && mineIn && !stage;
  const rab = (cs, have) => (cs ? cs.map((c, i) => { const d = i * RABBIT_MS - rabAge; return cardHTML(c, 'bcard ghost' + (d > -700 ? ' rab-in" style="animation-delay:' + Math.round(d) + 'ms' : '')); }).join('')
    : canHunt ? Array.from({ length: Math.max(0, 5 - have) }, (_, i) => `<div class="card back bcard rab-slot" data-act="rabbit" title="Rabbit hunt: see the cards that would have come">${i === 0 ? '<span>🐇</span>' : ''}</div>`).join('') : '');
  const rabbit = rab(st.rabbit, st.board.length), rabbit2 = dbl ? rab(st.rabbit2, (st.board2 || []).length) : '';
  const potNow = st.potTotal || (st.phase === 'done' ? (st.result?.wins || []).reduce((a, w) => a + w.amount, 0) : 0);
  const cardAt = (b, r) => b.map((c, i) => cardHTML(c, 'bcard' + ((r === 0 || dbl ? i >= seen.n : r >= seen.rows) ? ' deal d' + Math.max(0, Math.min(4, r === 0 || dbl ? i - seen.n : i)) : '') + (Object.keys(winBy).some((k) => inBest(Number(k), c)) ? ' hi' : '')));
  const label = (r) => (many ? `<i>${dbl ? 'Board' : 'Run'} ${r + 1}</i>` : '');
  // Run it more than once: the cards every run shares (the flop, or the flop and turn) are drawn once, and
  // each run is a branch from them with only its own cards.
  let base = 0;
  if (many && !dbl && allBoards.length > 1) { const a = allBoards[0]; while (base < 5 && a[base] && allBoards.every((b) => b[base] && b[base].r === a[base].r && b[base].s === a[base].s)) base++; if (base >= 5) base = 0; }
  const rows = base
    ? `<div class="pk-tree"><div class="pk-trunk">${cardAt(boards[0], 0).slice(0, base).join('')}</div><div class="pk-branches">${boards.map((b, r) => `<div class="pk-brow">${label(r)}${cardAt(b, r).slice(base).join('')}</div>`).join('')}</div></div>`
    : boards.map((b, r) => `<div class="pk-brow">${label(r)}${cardAt(b, r).join('')}${r === 0 ? rabbit : dbl && r === 1 ? rabbit2 : ''}</div>`).join('');
  seen.n = boards[0].length; seen.rows = boards.length;
  h += `<div class="pk-mid${many ? ' many n' + allBoards.length : ''}" style="--cols:${allBoards.length > 6 ? 3 : allBoards.length > 3 ? 2 : 1};--rcw:${[0, 59, 28, 18, 28, 18, 18, 15, 15, 15, 12][Math.min(10, allBoards.length)] || 12}">
    <div class="pk-board pk-stand"><div class="pk-pot">${st.bomb && live && !ring ? '<span class="pk-bomb">💣 Bomb pot</span>' : ''}${(st.plo || dbl) && st.phase !== 'waiting' && !ring ? `<span class="pk-variant">${st.plo ? 'PLO' : "Hold'em"}${dbl ? ' · 2 boards' : ''}</span>` : ''}<b class="pk-potnum"><i>POT</i>${amt(potNow)}</b>${potLine && !ring ? `<small>${potLine}</small>` : ''}</div>${rows}</div>
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
    let A = wide ? { x: 50 + (P.x - 50) * (Math.abs(P.x - 50) > 30 ? 0.84 : 0.95), y: 50 + (P.y - 50) * 0.46 } : toward(P, fa);
    let B = wide ? { x: 50 + (P.x - 50) * 0.9, y: 50 + (P.y - 50) * fb } : mineSpot && S.room ? { x: P.x + (phone() ? 16 : 9), y: 50 + (P.y - 50) * 0.5 } : toward(P, fb);
    const R = plan ? plan.seats[rel(i)] : null;
    if (R) { A = R.a; B = R.b; }
    // Near things look larger from your chair, so they are drawn a little smaller: every name is about the same size on screen.
    const ds = R ? R.ds : Math.max(0.62, Math.min(1.7, (1.35 - A.y / 100) / 0.75));
    stools.push({ seat: i, x: P.x, y: P.y });
    if (!seat) {
      if (mySeat < 0) h += `<button class="pk-sit pk-stand" style="left:${A.x}%;top:${A.y}%" data-act="sit" data-seat="${i}"><span class="sit-arrow">Sit ▼</span>Seat ${i + 1}</button>`;
      else if (!live) h += `<button class="pk-sit pk-move pk-stand" style="left:${A.x}%;top:${A.y}%" data-act="move" data-seat="${i}" title="Move to this seat with your chips">Move here</button>`;
      continue;
    }
    const me = seat.id === S.myId, turn = live && st.turn === i, inH = seat.inHand && !seat.folded;
    let bubble = '', bcls = '';
    if (showing && inH) {
      const o = stage.odds;
      if (o && o.pct[i] !== undefined) { bubble = `${o.pct[i]}%${o.outs[i] !== undefined ? ` · ${o.outs[i]} out${o.outs[i] === 1 ? '' : 's'}` : ''}`; bcls = 'odds'; }
      else if (!stage.plain) { bubble = 'All in'; bcls = 'allin'; }
    }
    else if (done && winBy[i]) { bubble = `+${amt(winBy[i])}${!many && seat.hand ? ' · ' + esc(shortHand(seat.hand)) : ''}`; bcls = 'win'; }
    else if (seat.allIn && seat.inHand && !seat.folded && !done) { bubble = 'All in'; bcls = 'allin'; }
    else if (!seat.connected) { bubble = 'Offline'; bcls = 'fold'; }
    else if (seat.out) { bubble = 'Away'; bcls = 'fold'; }
    else if (seat.hand && done && seat.shown) { bubble = esc(shortHand(seat.hand)); bcls = 'in'; }
    // Nothing stays over a name while a player is simply in the hand or has folded: the last move shows for two seconds,
    // a folded player's plate is dimmed with no cards, and the player to act has a glowing plate with a time bar.
    // Once the next street is out, a folded player's label and name go too, to keep the table clear.
    else if (seat.inHand && seat.folded && !(live && foldGone(st, i))) { bubble = seat.mucked ? 'Mucked' : 'Folded'; bcls = 'fold out'; }
    else if (live && S.said?.[i] && S.said[i].until > Date.now()) { bubble = esc(S.said[i].text); bcls = S.said[i].text === 'Fold' ? 'fold say' : 'in say'; }
    if (votes[seat.id]?.length && !seat.out) bubble += ` · away vote ${votes[seat.id].length}`;
    // Your own cards are in the panel at the bottom, so in the 3D room they are not stood on the felt as well.
    const hideMine = me;
    const cards = !hideMine && seat.cards.length && !(seat.folded && live) ? seat.cards.map((c) => cardHTML(c, (me ? 'mine ' : '') + (inBest(i, c) ? 'hi' : ''))).join('') : '';
    const timer = turn && st.turnLeft !== null ? `<i class="pk-bank" data-bank="${seat.bank}"></i><i class="pk-timer"><i style="animation-duration:${Math.max(0.1, (st.turnLeft - (Date.now() - S.at)) / 1000)}s;width:${100 - Math.min(100, (Math.max(0, st.turnLeft - (Date.now() - S.at)) / (st.settings.turnTimer * 1000)) * 100)}%"></i></i>` : '';
    h += `<div class="pk-seat pk-stand${!me ? ' far' : ''}${me ? ' me' : ''}${turn ? ' turn' : ''}${seat.inHand && seat.folded ? ' folded' : ''}${!seat.inHand && live ? ' idle' : ''}${bcls === 'win' ? ' won' : ''}${R ? ' ' + R.side : ''}" style="left:${A.x}%;top:${A.y}%;--ds:${ds.toFixed(2)}${R ? ';--dsy:' + (ds * (S.ringTall?.[rel(i)] || 1)).toFixed(3) : ''}" data-seat="${i}" data-rel="${rel(i)}">
      ${bubble ? `<div class="pk-bubble ${bcls}">${bubble}</div>` : ''}
      <div class="pk-cards${seat.folded ? ' dim' : ''}${seat.cards.length > 2 ? ' four' : ''}">${cards}</div>
      <button class="pk-plate" data-act="seat-menu" data-seat="${i}"><b>${R && st.button === i && st.handNo > 0 ? '<i class="pk-d" title="Dealer button">D</i>' : ''}${!me && live && seat.inHand && seat.folded && foldGone(st, i) ? '' : esc(seat.name)}${me ? ' <em>YOU</em>' : ''}</b><span>${amt(seat.stack - (showing ? seat.won || 0 : 0))}</span>${timer}</button>${me ? '<button class="pk-react" data-act="react" title="Reaction">😀</button>' : ''}
    </div>`;
    h += `<div class="pk-spot${seat.bet ? ' has' : ''}" id="spot-${i}" style="left:${B.x}%;top:${B.y}%;--ds:${R ? R.bs.toFixed(2) : 1}">${seat.bet ? `<span class="pk-amt pk-stand${st.raiser === i && seat.bet === st.currentBet ? ' raise' : ''}">${amt(seat.bet)}</span>` : ''}</div>`;
    if (!R && st.button === i && st.handNo > 0) { h += `<div class="pk-dbtn" style="left:calc(${B.x}% + ${(P.y > 50 ? 1 : -1) * (phone() ? 30 : 52)}px);top:${B.y}%">D</div>`; }
    people.push({ id: seat.id, name: seat.name, look: seat.look || { skin: 2, hair: 0 }, seat: i, seats: POKER_SEATS, isMe: me, isDealer: false, x: P.x, y: P.y, bet: seat.bet, cards: !me && seat.inHand && st.phase !== 'waiting' ? (seat.folded ? (foldGone(st, i) ? null : 'down') : 'up') : null }); // your own cards are the big ones at the bottom
    chips.push({ seat: i, main: seat.bet, balance: seat.stack - (showing ? seat.won || 0 : 0), mine: me });
  }
  const potChips = st.phase === 'done' ? (showing ? potNow : 0) : st.pot;
  if (potChips > 0) chips.push({ seat: 99, main: potChips, balance: 0 });
  body.innerHTML = h;
  // Seat view on a computer: the picture is checked after it is drawn, and drawn again (at most three times) if it is off.
  // 1. Things that stand on the felt look squashed far from you and stretched close to you. Each plate is made as tall
  //    as it is wide again. 2. How far your own plate ends below its place, and how tall it is, go back into the plan.
  if (plan && (S.ringAgain || 0) < 3) {
    let again = false;
    const tall = (S.ringTall ||= {});
    for (const el of body.querySelectorAll('.pk-seat[data-rel]')) {
      const r = el.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
      if (!(w > 8 && hh > 8 && r.width > 8 && r.height > 8)) continue;
      const k = el.dataset.rel, was = tall[k] || 1, now = Math.max(0.5, Math.min(3, was * ((r.width / w) / (r.height / hh))));
      if (Math.abs(now - was) > 0.05) { tall[k] = now; again = true; }
    }
    const pl = $('.pk-seat.me .pk-plate')?.getBoundingClientRect();
    if (pl && pl.height > 4 && !again) { const hang = pl.bottom - plan.ownY, ph = pl.height / plan.k; if ((Math.abs(hang - (S.ringHang ?? 1e9)) > 3 || Math.abs(ph - (S.ringPh ?? 1e9)) > 1.5) && Math.abs(hang) < 200) { S.ringHang = hang; S.ringPh = ph; S.ringKey = ''; again = true; } }
    if (again) { S.ringAgain = (S.ringAgain || 0) + 1; try { render(); } finally { S.ringAgain--; } return; }
  }
  // Seat view on a computer: the list of side pots is a strip under the top bar, so the pot on the table stays small.
  let strip = $('#pk-potline');
  const stripText = ring && st.phase !== 'waiting' ? [st.bomb && live ? '💣 Bomb pot' : '', st.plo || dbl ? (st.plo ? 'PLO' : "Hold'em") + (dbl ? ' · 2 boards' : '') : '', potLine].filter(Boolean).join(' · ') : '';
  if (stripText) { if (!strip) { strip = document.createElement('div'); strip.id = 'pk-potline'; document.body.append(strip); } if (strip.textContent !== stripText) strip.textContent = stripText; }
  else strip?.remove();
  S.presence = people.map((p) => ({ id: p.id, name: p.name, look: p.look, seat: p.seat, seats: p.seats }));
  if (S.room) { S.room.setPeople(people, stools); S.room.setChips(chips); S.room.setOthers(S.others, S.views); }
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

const mySeatNow = (st) => st.seats.some((x) => x && x.id === S.myId);
// ---------- The buttons under the table ----------
function drawHud(st, mySeat, showing) {
  const tray = $('#tray'), top = $('#hud-top');
  const seat = mySeat >= 0 ? st.seats[mySeat] : null;
  const o = st.options, live = st.phase !== 'done' && st.phase !== 'waiting';
  const isHost = S.role === 'host';
  let status = '';
  const nd = st.mp?.need;
  if (st.wait?.length) status = `The table moved to a new host. Waiting a moment for ${esc(st.wait.join(', '))}…`;
  else if (st.shuffling && !live) status = 'Shuffling. Every player\'s browser locks the deck…';
  else if (nd && nd.kind === 'sd') status = nd.seat === mySeat ? 'Showdown: your turn to show' : `Showdown: ${esc(st.seats[nd.seat]?.name || 'A player')} shows or mucks…`;
  else if (nd && nd.kind === 'show') status = 'All in. The hands turn face up…';
  else if (nd && (nd.kind === 'board' || nd.kind === 'rabbit')) status = nd.left < 20000 && nd.missing?.length ? `Waiting for ${esc(nd.missing.join(', '))} to open the next cards…` : 'Opening the next cards…';
  else if (nd && nd.kind === 'rescue') status = 'A player\'s browser is gone. Dealing the rest of the hand from a fresh deck…';
  else if (mySeat < 0) status = 'Tap an empty seat to join the game.';
  else if (o) status = 'Your turn';
  else if (live && st.turn !== null) status = ''; // whose turn it is shows as the light on their name
  else if (st.beat) status = '';
  else if (st.punch && st.punch.left > 0) status = ''; // the banner at the top says it
  else if (st.runAsk) { const a = st.runAsk, nm = esc(st.seats[a.by]?.name || ''); status = !a.n ? (a.by === mySeat ? 'All in. How many times do you want to run it?' : `All in. ${nm} picks how many times to run it…`) : (a.need.includes(mySeat) && !a.yes.includes(mySeat) ? `${nm} asks to run it ${a.n} times. Do you agree?` : `Run it ${a.n} times? Waiting for ${esc(a.need.filter((q) => !a.yes.includes(q)).map((q) => st.seats[q]?.name || '').join(', '))}…`); }
  else if (showing) status = S.shown?.hand === st.handNo && !st.result?.runout ? 'Showdown' : 'All in. The cards are coming out…';
  else if (st.phase === 'done') status = st.result?.wins?.length ? st.result.wins.map((w) => `${esc(st.seats[w.seat]?.name || 'A player')} wins ${amt(w.amount)}${w.hand ? ' with ' + esc(shortHand(w.hand)) : ''}`).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3).join(' · ') : 'Hand over';
  else status = st.canStart ? (isHost ? 'Press Start to deal the first hand.' : 'Waiting for the host to start.') : 'Two players with chips are needed to play.';
  const bounty = st.result?.bounty?.length ? ` · 7-2 bounty: ${st.result.bounty.map((b) => `${esc(st.seats[b.seat]?.name || '')} +${money(b.amount)}`).join(', ')}` : '';
  const badge = live && !showing && seat ? rankBadge(seat) : ''; // your own hand, named once, beside your own cards
  top.innerHTML = status || bounty ? `<div class="pk-statrow"><div class="status">${status}${bounty}</div></div>` : '';
  // The host's Start and Stop button at the top right: Start deals, Stop holds the game after the hand in play.
  { const aw = $('#away-top'); if (aw) { aw.hidden = !seat; aw.classList.toggle('gold', !!seat?.out); aw.textContent = seat?.out ? '💺 Back' : '💺'; aw.title = seat?.out ? 'You are away. Tap to play again.' : 'Away: sit out the next hands'; } }
  const hr = $('#host-run');
  if (hr) { const running = S.started && !S.paused; hr.hidden = !isHost; hr.textContent = running ? '⏸ Stop' : '▶ Start'; hr.title = running ? 'Stop dealing after this hand' : 'Deal the next hand and keep dealing'; hr.classList.toggle('primary', !running); hr.disabled = !running && !st.canStart; }
  let h = '';
  if (seat && seat.cards.length && seat.cards[0]) h += `<div class="pk-handrow"><div class="pk-myhand${seat.cards.length > 2 ? ' four' : ''}${seat.folded || !seat.inHand ? ' out' : ''}">${seat.cards.map((c) => cardHTML(c, 'big')).join('')}</div>${badge}</div>`;
  if (S.pre && S.pre.hand !== st.handNo) S.pre = null;
  if (o && S.pre) {
    // The move picked ahead of time. "Check" only checks: with a bet to call it is dropped and you choose yourself.
    const a = S.pre.a; S.pre = null;
    const move = a === 'cf' ? (o.canCheck ? 'check' : 'fold') : a === 'call' ? (o.canCheck ? 'check' : 'call') : o.canCheck ? 'check' : '';
    if (move) setTimeout(() => { if (S.st?.options && S.st.handNo === st.handNo) send({ t: 'act', a: move }); }, 300);
  }
  if (o) {
    const key = st.handNo + '|' + st.phase + '|' + st.currentBet + '|' + o.minTo;
    if (o.canRaise && (S.raiseFor !== key || S.raiseTo === null)) { S.raiseFor = key; S.raiseTo = o.minTo; }
    const to = o.canRaise ? Math.max(o.minTo, Math.min(o.maxTo, S.raiseTo)) : 0;
    const frac = (f) => Math.max(o.minTo, Math.min(o.maxTo, Math.round(st.currentBet + f * (o.pot + o.toCall))));
    h += `<div class="pk-acts">
      <button class="pk-act fold" data-act="fold">Fold</button>
      ${o.canCheck ? '<button class="pk-act check" data-act="check">Check</button>' : `<button class="pk-act call" data-act="call">Call ${amt(o.toCall)}${o.toCall >= seat.stack ? ' (all in)' : ''}</button>`}
      ${o.canRaise ? `<button class="pk-act raise" data-act="raise" id="raise-btn" title="Tap to raise. Hold and drag up to pick the amount."><i class="pk-dragtip">▲ drag</i><span id="raise-txt">${S.raiseOpen !== key ? (o.isBet ? 'Bet' : 'Raise') : (to >= o.maxTo && o.allIn !== false ? 'All in ' : o.isBet ? 'Bet ' : 'Raise to ') + amt(to)}</span></button>` : ''}
    </div>`;
    if (o.canRaise && S.raiseOpen === key) h += `<div class="pk-raise">
      <div class="pk-presets"><button data-act="raise-back" class="back">‹ Back</button><button data-act="preset" data-v="${o.minTo}">Min</button><button data-act="preset" data-v="${frac(1 / 3)}">⅓ pot</button><button data-act="preset" data-v="${frac(0.5)}">½ pot</button><button data-act="preset" data-v="${frac(2 / 3)}">⅔ pot</button><button data-act="preset" data-v="${frac(1)}">Pot</button><button data-act="preset" data-v="${o.maxTo}">${o.allIn === false ? 'Max' : 'All in'}</button></div>
      <div class="pk-slide"><button class="pk-step" data-act="raise-step" data-d="-1" title="One big blind less">−</button><input type="range" id="raise-range" min="${o.minTo}" max="${o.maxTo}" step="${Math.max(1, Math.min(st.settings.bigBlind, o.maxTo - o.minTo) || 1)}" value="${to}" /><button class="pk-step" data-act="raise-step" data-d="1" title="One big blind more">+</button><input type="number" id="raise-num" min="${o.minTo}" max="${o.maxTo}" value="${to}" inputmode="numeric" /><span class="pk-bb" id="raise-bb">${bbText(to, st)}</span></div>
    </div>`;
  } else if (seat && st.runAsk && ((st.runAsk.by === mySeat && !st.runAsk.n) || (st.runAsk.n && st.runAsk.need.includes(mySeat) && !st.runAsk.yes.includes(mySeat)))) {
    const a = st.runAsk;
    h += a.by === mySeat
      ? `<div class="pk-acts pk-runask">${Array.from({ length: a.max }, (_, k) => `<button class="pk-act ${k ? 'raise' : 'check'}" data-act="runpick" data-n="${k + 1}">${['Once', 'Twice', '3 times'][k]}</button>`).join('')}</div>`
      : `<div class="pk-acts pk-runask"><button class="pk-act call" data-act="runans" data-yes="1">Yes, ${a.n} times</button><button class="pk-act fold" data-act="runans" data-yes="0">No, once</button></div>`;
  } else if (seat && seat.out && seat.stack > 0 && !(seat.inHand && live && !seat.folded)) {
    // Away: one large button, in the same place as Fold, Call and Raise, deals you in again from the next hand.
    h += '<div class="pk-acts back"><button class="pk-act call" data-act="away">I\'m back</button></div>';
  } else if (seat && live && !showing && !st.runAsk && seat.inHand && !seat.folded && !seat.allIn && seat.cards.length) {
    // Not your turn yet: pick a move ahead of time. It is played the moment your turn comes, and a second tap takes it back.
    const pre = S.pre && S.pre.hand === st.handNo ? S.pre.a : '';
    h += `<div class="pk-acts pre"><button class="pk-act fold${pre === 'cf' ? ' on' : ''}" data-act="pre" data-a="cf">Check / Fold</button><button class="pk-act check${pre === 'check' ? ' on' : ''}" data-act="pre" data-a="check">Check</button><button class="pk-act call${pre === 'call' ? ' on' : ''}" data-act="pre" data-a="call">Call any</button></div>`;
  } else if (seat) {
    const b = [];
    if (st.canPunch && !showing) b.push(`<button class="btn pk-punch" data-act="punch">👊 Punch ${esc(st.seats[st.canPunch.to]?.name || 'the winner')}</button>`);
    if (st.phase === 'done' && seat.inHand && seat.cards[0] && !seat.shown) {
      const m = seat.mask || seat.cards.map(() => false);
      seat.cards.forEach((c, k) => { if (!m[k]) b.push(`<button class="btn small" data-act="show" data-w="${k}">Show ${esc(cardText(c))}</button>`); });
      b.push(`<button class="btn small" data-act="show">Show ${seat.cards.length > 2 ? 'all' : 'both'}</button>`);
    }
    if (st.phase === 'done' && st.result?.early && st.settings.rabbitHunt && !st.rabbit && seat.inHand) b.push('<button class="btn small" data-act="rabbit">🐇 Rabbit hunt</button>');
    if (!live && isHost && (!S.started || !st.settings.autoStart || S.paused) && st.canStart) b.push(`<button class="btn primary" data-act="start">${st.handNo ? 'Deal next hand' : 'Start'}</button>`);
    if (b.length) h += `<div class="pk-acts small">${b.join('')}</div>`;
  } else if (!live && isHost && st.canStart && (!S.started || S.paused)) h += '<div class="pk-acts small"><button class="btn primary" data-act="start">Start</button></div>';
  // Out of chips after a hand: buy in again or sit out. With no answer in 20 seconds the table marks you as sitting out.
  if (seat && seat.stack === 0 && !(seat.inHand && live)) {
    if (!seat.out) { S.brokeAt ||= Date.now(); h += `<div class="pk-broke"><span>You are out of chips. <b id="broke-s">${Math.max(0, 20 - Math.floor((Date.now() - S.brokeAt) / 1000))}</b> s to choose</span><button class="btn primary" data-act="rebuy">Buy in ${money(st.settings.startStack)}</button><button class="btn" data-act="away">Sit out</button></div>`; }
    else { S.brokeAt = 0; h += `<div class="pk-broke"><span>You are sitting out with no chips.</span><button class="btn primary" data-act="rebuy">Buy in ${money(st.settings.startStack)}</button></div>`; }
  } else S.brokeAt = 0;
  if (seat) {
    // Only what is used during play stays on screen (top left). Chips, the amount view and Leave seat are in the menu.
    h += `<div class="pk-mine">
      ${st.settings.straddle ? `<button class="btn small" data-act="straddle">Straddle: ${seat.straddle ? 'on' : 'off'}</button>` : ''}
${(() => { const x = st.seats.find((x) => x && x.id === S.myId); return x && x.inHand && st.phase !== 'waiting' && st.phase !== 'done' ? `<button class="btn pk-leave-later ${x.leaving ? 'on' : ''}" data-act="leave-later" data-on="${x.leaving ? 1 : 0}" title="You play this hand to the end, then your seat is free.">${x.leaving ? '🚪 Leaving after this hand. Tap to stay' : '🚪 Leave after this hand'}</button>` : ''; })()}
      <button class="btn danger pk-leave" data-act="stand">🚪 Leave seat</button>
    </div>`;
  }
  // Keep what is being typed in the amount box while the table redraws.
  const typing = document.activeElement?.id === 'raise-num' ? document.activeElement.value : null;
  tray.innerHTML = h;
  if (typing !== null && $('#raise-num')) { const n = $('#raise-num'); n.value = typing; n.focus(); }
}
// An amount in big blinds, as a short tag beside the amount box ("3.5 BB").
const bbText = (v, st) => `${Math.round((v / (st.settings.bigBlind || 1)) * 10) / 10} BB`;
function setRaise(v, from) {
  const o = S.st?.options;
  if (!o?.canRaise) return;
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return;
  S.raiseTo = v;
  const to = Math.max(o.minTo, Math.min(o.maxTo, v));
  if (from !== 'range' && $('#raise-range')) $('#raise-range').value = to;
  if (from !== 'num' && $('#raise-num')) $('#raise-num').value = to;
  if ($('#raise-bb')) $('#raise-bb').textContent = bbText(to, S.st);
  const b = $('#raise-txt');
  if (b) b.textContent = `${to >= o.maxTo && o.allIn !== false ? 'All in ' : o.isBet ? 'Bet ' : 'Raise to '}${amt(to)}`;
}

// ---------- Menu and dialogs ----------
function drawMenu(st) {
  const el = $('#menu-items');
  if (!el) return;
  const isHost = S.role === 'host';
  el.innerHTML = `
    <div class="menu-invite"><div class="menu-title">🔗 Invite link</div><div class="share"><input id="share" readonly value="${esc(inviteLink())}" /><button class="btn small" data-act="copy">Copy</button></div></div>
    ${mySeatNow(st) ? '<button class="menu-item" data-act="add">🪙 My chips</button>' : ''}
    <button class="menu-item" data-act="ledger">📒 Ledger</button>
    ${S.role === 'guest' ? '<button class="menu-item" data-act="become-host" title="The table moves to your browser. No vote.">👑 Become host</button>' : ''}
    <button class="menu-item" data-act="log">📝 Hand log</button>
    <button class="menu-item" data-act="dl-hands">⬇️ Download hand history</button>
    <button class="menu-item" data-act="fair">🔐 Fair deck</button>
    <button class="menu-item" data-act="rules">📖 Table rules</button>
    <button class="menu-item" data-act="test-mode">🧪 Test mode: ${S.testMode ? 'on' : 'off'}</button>
    ${S.testMode ? `<div class="menu-head">Test</div>
    ${mySeatNow(st) ? '<button class="menu-item" data-act="test-punch">👊 Punch the next player</button>' : '<div class="menu-note">Take a seat to test the punch.</div>'}
    ${S.room ? `<button class="menu-item" data-act="test-talk">💬 Everyone says a line</button>
    <button class="menu-item" data-act="test-trip" data-who="Jeff" data-kind="nap" data-note="Jeff walks to the sofa for a nap.">😴 Jeff naps on the sofa</button>
    <button class="menu-item" data-act="test-trip" data-who="Nigel" data-kind="visit" data-note="Nigel walks over to Allie.">🧹 Nigel visits Allie</button>
    <button class="menu-item" data-act="test-trip" data-who="Gordon" data-kind="visit" data-note="Gordon walks over to Yuya.">🗣 Gordon visits Yuya</button>
    <button class="menu-item" data-act="test-trip" data-who="Henry" data-kind="visit" data-note="Henry walks over to David or Jeff.">🗣 Henry visits David or Jeff</button>
    <button class="menu-item" data-act="test-trip" data-who="any" data-kind="coffee" data-note="Somebody leaves for a coffee.">☕ Coffee run</button>` : '<div class="menu-note">The office people show in the 3D room only.</div>'}` : ''}
    <button class="menu-item" data-act="bbview">👁 Amounts shown in: ${bbOn() ? 'big blinds' : 'chips'}</button>
    ${isHost || st.seats.some((x) => x && x.id === S.myId) ? `<button class="menu-item" data-act="settings" data-note="${isHost ? '' : 'Everyone else at the table votes on your change.'}">⚙️ Table settings</button>` : ''}
    ${isHost ? `    <button class="menu-item" data-act="players">👥 Players</button>
    ${st.seats.some((x) => !x) ? '<button class="menu-item" data-act="bot-add">🤖 Add a computer player</button>' : ''}${st.seats.some((x) => x && String(x.id).startsWith('bot-')) ? '<button class="menu-item" data-act="bot-clear">🤖 Remove computer players</button>' : ''}
    <button class="menu-item" data-act="bomb">💣 Bomb pot next hand: ${st.bombNext ? 'on' : 'off'}</button>
    <button class="menu-item" data-act="pause">${S.paused ? '▶️ Resume dealing' : '⏸️ Pause after this hand'}</button>` : ''}
    <button class="menu-item" data-act="view3d">🧊 3D room: ${use3D() ? 'on' : 'off'}</button>
    ${S.room ? `<button class="menu-item" data-act="turnhome">🎯 Back to my seat on my turn: ${safeGet('pk-turnhome2') === '1' ? 'on' : 'off'}</button>` : ''}
    ${S.room ? '<button class="menu-item" data-act="walk">🚶 Walk around</button><button class="menu-item" data-act="view-reset">🪑 Back to my seat</button>' : ''}
    ${mySeatNow(st) ? '<button class="menu-item" data-act="stand">🚪 Leave my seat</button>' : ''}
    <button class="menu-item" data-act="leave">↩️ Leave the table</button>`;
}
function ledgerHTML(st) {
  return ledgerTable(st) + '<button class="btn small office-btn" data-act="office">🏢 All tables</button>';
}
function ledgerTable(st) {
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
    <p>All in before the river: the table asks how many times to run it. The player who went all in first picks once, twice or 3 times${s.runTimes < 3 ? ` (this table allows at most ${s.runTimes})` : ''}. For more than once, every other player in the hand must say yes; one no, or no answer in 20 seconds, means the board is dealt once. The pot is shared equally between the runs. The hands turn face up with each one's chance to win and its outs.</p>
    <p>Chips: you can add chips or take chips off at your own seat, only while you are not in a hand. Every change is written in the hand log and counted in the ledger.</p>
  </div>`;
}
function settingsHTML(st) {
  const s = st.settings, num = (k, label, min = 0) => `<label>${label}<input type="number" id="ps-${k}" min="${min}" value="${s[k]}" inputmode="numeric" /></label>`;
  const tick = (k, label) => `<label class="tickrow"><input type="checkbox" id="ps-${k}" ${s[k] ? 'checked' : ''} /> ${label}</label>`;
  return `<h3>Table settings</h3><div class="pk-set">
    ${num('smallBlind', 'Small blind')}${num('bigBlind', 'Big blind', 1)}${num('ante', 'Ante (0 = none)')}${num('startStack', 'Starting chips', 1)}
    <label>Seconds per decision<select id="ps-turnTimer">${[0, 10, 15, 20, 30, 45, 60, 90].map((v) => `<option value="${v}"${v === s.turnTimer ? ' selected' : ''}>${v ? v : 'No clock'}</option>`).join('')}</select></label>
    ${num('timeBank', 'Time bank per player, in seconds (0 = none)')}${num('sevenDeuce', '7-2 bounty per player (0 = off)')}${num('bombPotEvery', 'Bomb pot every N hands (0 = off)')}${num('bombPotAnte', 'Bomb pot size, in big blinds', 1)}${num('runTimes', 'Run it: most times a player may ask for (1 = always once)', 1)}<label>All in showdown speed<select id="ps-showSpeed">${['fast', 'normal', 'long'].map((v) => `<option value="${v}"${v === s.showSpeed ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
    <label>Game<select id="ps-game"><option value="nlh"${s.game === 'nlh' ? ' selected' : ''}>No limit Hold'em (2 cards)</option><option value="plo"${s.game === 'plo' ? ' selected' : ''}>Pot limit Omaha (4 cards)</option></select></label>
    <label>Bots<select id="ps-botLevel"><option value="easy"${s.botLevel !== 'hard' ? ' selected' : ''}>Easy</option><option value="hard"${s.botLevel === 'hard' ? ' selected' : ''}>Hard</option></select></label>
    ${tick('doubleBoard', 'Two boards every hand (each board plays for half the pot)')}
    <label>Bomb pot game<select id="ps-bombGame">${[['same', 'Same as the table'], ['nlh', "Hold'em"], ['plo', 'Omaha (PLO)']].map(([v, l]) => `<option value="${v}"${s.bombGame === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Bomb pot boards<select id="ps-bombBoards">${[[0, 'Same as the table'], [1, 'One board'], [2, 'Two boards']].map(([v, l]) => `<option value="${v}"${s.bombBoards === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    ${tick('straddle', 'Straddle allowed')}${tick('autoStart', 'Deal the next hand automatically')}
    <button class="btn primary" data-act="save-settings">${S.role === 'host' ? 'Save' : 'Ask for a vote'}</button>
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
  const rows = [...f.hands].reverse().slice(0, 25).map((hd) => `<tr><td>${hd.hand}</td><td>${hd.board.map(cardText).join(' ') || 'no flop'}</td><td><span class="up">Locked ✓</span></td></tr>`).join('');
  void isHost;
  return `<h3>🔐 Fair deck</h3><div class="pk-fair">
    <p>Locked cards: before each hand every player's browser puts its own lock on all 52 cards and shuffles them, one browser after the other. Nobody knows the order of the deck, the host included.</p>
    <p>Your two cards open only in your browser: every other browser gives you its key for them, and your own key opens them last. A board card opens only when every browser has given its key for it, and only once the betting before it is over. Cards you fold or muck are never opened by anyone. Each card that is shown is checked in every browser against its locks.</p>
    <table class="pk-table"><tr><th>Hand</th><th>Board</th><th>Cards</th></tr>${rows || '<tr><td colspan="3">No hands yet.</td></tr>'}</table>
</div>`;
}
function fairHandHTML(st, n) {
  const hd = st.fair.hands.find((x) => x.hand === n), c = hd && checkHand(hd);
  if (!c) return '<p>That hand is not open.</p>';
  return `<h3>Hand ${n}, dealt again from its seeds</h3><div class="pk-fair"><table class="pk-table">${hd.seats.map((x) => `<tr><td>${esc(x.name)}</td><td>${c.hole[x.seat].map(cardText).join(' ')}</td></tr>`).join('')}<tr><td>Board (all five)</td><td>${c.board.map(cardText).join(' ')}</td></tr>${hd.dbl ? `<tr><td>Second board</td><td>${c.board2.map(cardText).join(' ')}</td></tr>` : ''}</table>
    <p class="hint">Host seed: <code>${esc(hd.serverSeed)}</code></p><p class="hint">Player seeds: <code>${esc(Object.values(hd.clientSeeds).join(', ') || 'none')}</code></p></div>`;
}

// ---------- Clicks ----------
function copyLink() {
  const link = inviteLink();
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
      const pocket = st.ledger?.find((r) => r.id === S.myId)?.pocket || 0; // chips brought from another table
      modal(`<h3>Take seat ${seat + 1}</h3><div class="pk-set"><label>Chips to start with<input type="number" id="buyin" min="${pocket || 1}" value="${pocket || st.settings.startStack}" inputmode="numeric" /></label>${pocket ? `<p class="hint">You brought ${money(pocket)} from another table. They go on your stack first; only chips above that are a new buy-in.</p>` : ''}<button class="btn primary" data-act="sit-go" data-seat="${seat}">Sit down</button></div>`);
      break;
    }
    case 'move': send({ t: 'move', seat: Number(el.dataset.seat) }); break;
    case 'sit-go': send({ t: 'sit', seat: Number(el.dataset.seat), buyIn: Number($('#buyin').value) }); $('#modal').close(); break;
    case 'fold': send({ t: 'act', a: 'fold' }); break;
    case 'check': send({ t: 'act', a: 'check' }); break;
    case 'call': send({ t: 'act', a: 'call' }); break;
    case 'bot-add': if (t) { try {
        const free = t.seats.findIndex((x) => !x), used = new Set(Object.values(t.players).map((p) => p.name));
        const nm = BOT_NAMES.find((n) => !used.has('🤖 ' + n)) || 'Bot';
        let k = 1; while (t.players['bot-' + k] && t.seatOf('bot-' + k) >= 0) k++;
        t.join('bot-' + k, '🤖 ' + nm, { skin: k % 5, hair: k % 4 }); t.players['bot-' + k].kicked = false; t.players['bot-' + k].connected = true;
        t.sit('bot-' + k, free, t.settings.startStack);
      } catch (er) { toast(er.message); } push(); } break;
    case 'bot-clear': if (t) { for (const x of t.seats) if (x && isBot(x.id)) { try { t.standUp(x.id); } catch {} } closeMenu(); push(); } break;
    case 'raise-back': S.raiseOpen = null; render(); break;
    case 'pre': { const a = el.dataset.a; S.pre = S.pre && S.pre.a === a && S.pre.hand === st.handNo ? null : { a, hand: st.handNo }; render(); break; }
    case 'raise': { if (Date.now() - (S.dragEnd || 0) < 350) break; const o = st.options; if (!o?.canRaise) break;
      // The first tap opens the small raise panel (sizes and a slider); the second tap sends the amount shown.
      if (S.raiseOpen !== S.raiseFor) { S.raiseOpen = S.raiseFor; render(); if (!phone()) { const n = $('#raise-num'); if (n) { n.focus(); n.select(); } } break; } const to = Math.max(o.minTo, Math.min(o.maxTo, Math.round(Number($('#raise-num')?.value ?? S.raiseTo)))); send({ t: 'act', a: o.isBet ? 'bet' : 'raise', amount: to }); break; }
    case 'preset': setRaise(el.dataset.v); break;
    case 'raise-step': { const o = st.options; if (o?.canRaise) setRaise(Math.max(o.minTo, Math.min(o.maxTo, Math.max(o.minTo, Math.min(o.maxTo, S.raiseTo)) + Number(el.dataset.d) * (st.settings.bigBlind || 1)))); break; }
    case 'show': { const which = el.dataset.w === undefined ? 'both' : Number(el.dataset.w), m = st.mp, sec = m && S.mpSec[m.sid], me = st.seats.findIndex((x) => x && x.id === S.myId);
      // Locked cards: showing is giving the key to your own cards.
      const keys = {}; if (sec?.b && me >= 0) (m.hole[me] || []).forEach((k, n) => { if (which === 'both' || which === n) keys[k] = keyFor(sec.b[k]); });
      send({ t: 'show', which, sid: m?.sid, keys }); break; }
    case 'punch': send({ t: 'punch' }); break;
    case 'test-mode': S.testMode = !S.testMode; try { localStorage.setItem('pk-test', S.testMode ? '1' : '0'); } catch {} drawMenu(S.st); break;
    case 'test-punch': closeMenu(); send({ t: 'punch', test: true }); break;
    case 'test-talk': S.room?.debugTalk?.(); toast('Everyone at a desk says a line. Press again for the next line.'); break;
    case 'test-trip': S.room?.debugTrip?.(el.dataset.who, el.dataset.kind); toast(el.dataset.note || 'On the way.'); break;
    case 'rabbit': send({ t: 'rabbit' }); break;
    case 'away': { const s = st.seats.find((x) => x && x.id === S.myId); send({ t: 'away', on: !s.out }); break; }
    case 'straddle': { const s = st.seats.find((x) => x && x.id === S.myId); send({ t: 'straddle', on: !s.straddle }); break; }
    case 'add': modal(`<h3>My chips</h3><div class="pk-set"><label>Amount<input type="number" id="addamt" min="1" value="${st.settings.startStack}" inputmode="numeric" /></label><div class="pk-acts small"><button class="btn primary" data-act="add-go">➕ Add chips</button><button class="btn" data-act="take-go">➖ Take chips off</button></div><p class="hint">Everyone sees each change in the hand log, and the ledger counts it. Chips added during a hand arrive when the hand ends. Chips can only be taken off while you are not in a hand.</p></div>`); break;
    case 'rebuy': send({ t: 'add', amount: st.settings.startStack }); break;
    case 'add-go': send({ t: 'add', amount: Number($('#addamt').value) }); $('#modal').close(); break;
    case 'take-go': send({ t: 'take', amount: Number($('#addamt').value) }); $('#modal').close(); break;
    case 'runs': modal(`<h3>Run it how many times?</h3><div class="pk-emoji runs">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button data-act="runs-go" data-n="${n}">${n}×</button>`).join('')}</div><p class="hint">When everyone in a hand is all in before the last card, the rest of the board is dealt this many times and the pot is shared between the runs. The lowest pick among the players in the hand counts.</p>`); break;
    case 'runpick': send({ t: 'runpick', n: Number(el.dataset.n) }); break;
    case 'runans': send({ t: 'runans', yes: el.dataset.yes === '1' }); break;
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
    case 'stand': closeMenu(); modal(`<h3>Leave your seat?</h3><p>${st.phase !== 'waiting' && st.phase !== 'done' && st.seats.find((x) => x && x.id === S.myId)?.inHand ? 'Your hand will be folded. ' : ''}You take your chips with you and can sit again later.</p><div class="row"><button class="btn" data-act="stand-no">Stay</button><button class="btn primary" data-act="stand-go">Leave seat</button></div>`); break;
    case 'stand-go': $('#modal').close(); send({ t: 'stand' }); break;
    case 'leave-later': send({ t: 'leave-later', on: el.dataset.on !== '1' }); break;
    case 'stand-no': $('#modal').close(); break;
    case 'start': if (t) { S.started = true; S.paused = false; if (!t.canStart()) toast('Two players with chips are needed.'); else dealHand(); push(); } break;
    case 'hostrun': if (S.role !== 'host') break; if (S.started && !S.paused) { S.paused = true; toast('Stopped. The hand in play finishes, then no new hand is dealt.'); push(); } else if (t) { S.started = true; S.paused = false; if (!t.inHand() && t.canStart()) dealHand(); push(); } break;
    case 'pause': S.paused = !S.paused; if (!S.paused) S.started = true; closeMenu(); push(); break;
    case 'bomb': if (t) { t.setBombNext(!t.bombNext); push(); } break;
    case 'ledger': closeMenu(); modal(ledgerHTML(st)); break;
    case 'become-host': becomeHost(); break;
    case 'office': modal(officeLedgerHTML(S.code, S.myId)); break;
    case 'log': closeMenu(); modal(`<h3>Hand log</h3><div class="log pk-log">${st.log.map((l) => `<div>${esc(l)}</div>`).reverse().join('')}</div>`); break;
    case 'rules': closeMenu(); modal(rulesHTML(st)); break;
    case 'fair': closeMenu(); modal(fairHTML(st)); break;
    case 'fair-hand': modal(fairHandHTML(st, Number(el.dataset.h))); break;
    case 'settings': closeMenu(); modal(settingsHTML(st)); break;
    case 'save-settings': {
      const patch = {};
      for (const k of ['smallBlind', 'bigBlind', 'ante', 'startStack', 'turnTimer', 'timeBank', 'sevenDeuce', 'bombPotEvery', 'bombPotAnte', 'runTimes']) patch[k] = Number($('#ps-' + k).value);
      for (const k of ['straddle', 'autoStart', 'doubleBoard']) patch[k] = $('#ps-' + k).checked;
      patch.game = $('#ps-game').value; patch.bombGame = $('#ps-bombGame').value; patch.bombBoards = Number($('#ps-bombBoards').value);
      patch.showSpeed = $('#ps-showSpeed').value; patch.botLevel = $('#ps-botLevel').value;
      if (S.role !== 'host') { send({ t: 'propose', patch }); toast('Sent. Everyone else at the table votes.'); }
      else if (t.inHand()) { S.pendingSettings = patch; toast('Saved. The new settings start with the next hand.'); }
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
    case 'turnhome': safeSet('pk-turnhome2', safeGet('pk-turnhome2') === '1' ? '0' : '1'); drawMenu(st); break;
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
const dragStop = () => { const was = S.drag?.on; if (was) S.dragEnd = Date.now(); S.drag = null; $('#pk-gauge')?.remove(); if (was && S.raiseOpen !== S.raiseFor) { S.raiseOpen = S.raiseFor; render(); } };
document.addEventListener('pointerup', dragStop);
document.addEventListener('pointercancel', dragStop);
// The host's bot level is saved as soon as it is picked; it only changes how the computer players play, so also during a hand.
document.addEventListener('change', (e) => {
  if (e.target.id !== 'ps-botLevel' || S.role !== 'host' || !S.table) return;
  try { S.table.updateSettings({ botLevel: e.target.value }, true); toast(`Bots: ${e.target.value === 'hard' ? 'Hard' : 'Easy'}.`); push(); } catch (er) { toast(er.message); }
});
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
  else if (k === 'k' && o.canCheck) send({ t: 'act', a: 'check' });
  else if (k === 'r' && o.canRaise) { if (!$('.pk-raise')) $('[data-act=raise]')?.click(); }
  else return;
  e.stopImmediatePropagation(); e.preventDefault();
}, true);
wireGameSwitch('poker', () => S.code || params.get('room'), () => S.role === 'host');
// Once the clock for a decision is used up, the plate counts the player's time bank down.
// The picture of the table changes with the window and while the camera moves to your chair: the plates follow it.
setInterval(() => { if (!S.st || !useRing()) return; const was = S.ringKey; ringNow(); if (S.ringKey !== was) render(); }, 500);
setInterval(() => { const b = $('#broke-s'); if (b && S.brokeAt) b.textContent = Math.max(0, 20 - Math.floor((Date.now() - S.brokeAt) / 1000)); }, 500);
setInterval(() => {
  const el = $('.pk-bank'), st = S.st;
  if (!el || !st || st.turnLeft === null) return;
  const over = (Date.now() - S.at - st.turnLeft) / 1000;
  el.textContent = over > 0 ? `Time bank ${Math.max(0, Math.ceil(Number(el.dataset.bank) - over))}s` : '';
  // Your own time is nearly gone (clock and time bank together): a tick every second, sharper for the last three.
  if (st.options && !el.closest('.pk-seat')?.classList.contains('far')) {
    const left = Math.ceil(Number(el.dataset.bank) - over);
    if (left <= 8 && left > 0 && S.lastTick !== st.handNo + ':' + st.phase + ':' + left) { S.lastTick = st.handNo + ':' + st.phase + ':' + left; tickSound(left <= 3); }
  }
}, 250);
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

// The other tables of the office: who plays there is drawn at their table in the room.
S.others = {};
watchOffice('poker', () => S.code, (g, list, view) => { (S.views ||= {})[g] = markMyTurn(g, view, S.myId); S.others[g] = list.filter((p) => p.id.split('#')[0] !== S.myId); S.room?.setOthers(S.others, S.views); });

// "Connection dropped" notice and blocked buttons while this browser has no link to the table (common.js showDropped).
setInterval(() => showDropped(!!S.hold || (S.role === 'guest' && !!S.st && !!S.conn && S.conn[1] === false && document.body.classList.contains('in-room')), S.hold ? "The table is moving to your browser. One moment…" : 'Your moves are not being sent. The table waits for the host. If the host is gone, you can take over.', S.hold ? null : becomeHost), 400);

// ---------- One wallet for the office (common.js walkTo) ----------
// This table's ledger lines for the office ledger.
function officeRows(st) { return (st?.ledger || []).filter((r) => !String(r.id).startsWith('bot-')).map((r) => ({ id: r.id, name: r.name, chips: r.stack, net: r.net })); }
// Walking to another table takes this player's chips along. A host cashes out at its own table.
onOfficeBack(GAME, () => S.code, () => S.role === 'host', (c) => { S.table?.carryIn(S.myId, c.amount, c.from, c.cid); push(); }, (m) => S.net?.send(m));
setSeated(() => !!S.st?.seats?.some((x) => x && x.id === S.myId));
setCashOut(async () => {
  if (S.role === 'host' && S.table) { const amount = S.table.cashOut(S.myId); push(); await new Promise((r) => setTimeout(r, 700)); return amount; }
  if (S.role === 'guest' && S.st) return askCashOut((m) => S.net.send(m));
  return 0;
});
