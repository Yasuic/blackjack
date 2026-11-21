import { PokerTable, bestHand, verifyHand, pokerDeck, cardText } from '../js/poker.js';
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const C = (s) => s.split(' ').map((x) => ({ r: x.slice(0, -1), s: x.slice(-1) }));
const S = ['♠', '♥', '♦', '♣'];
const h = (s) => bestHand(C(s.replace(/s/g, '♠').replace(/h/g, '♥').replace(/d/g, '♦').replace(/c/g, '♣')));
// ranking
ok(h('As Ks Qs Js 10s 2d 3c').cat === 8, 'royal');
ok(h('As 2s 3s 4s 5s 9d 9c').cat === 8 && h('As 2s 3s 4s 5s 9d 9c').score < h('2s 3s 4s 5s 6s Kd Kc').score, 'steel wheel < 6 high sf');
ok(h('Ah 2s 3d 4c 5s Kd Qc').cat === 4, 'wheel');
ok(h('Ah 2s 3d 4c 5s Kd Qc').score < h('2s 3d 4c 5s 6h Kd Qc').score, 'wheel lowest straight');
ok(h('Ah Kd Qc Js 2h 3d 4c').cat === 0, 'no wrap straight');
ok(h('9h 9d 9c 4s 4h 4d Kc').cat === 6 && h('9h 9d 9c 4s 4h 4d Kc').name.includes('nines full of fours'), 'two trips = full house');
ok(h('9h 9d 4c 4s Kh Kd 2c').name === 'Two pair, kings and nines', 'three pairs pick top two');
ok(h('9h 9d 4c 4s Kh Kd 2c').score < h('9h 9d 4c 4s Kh Kd Ac').score, 'kicker');
ok(h('Ah Ad Kc Qs Jh 3d 2c').score > h('Ah Ad Kc Qs 10h 3d 2c').score, 'pair kicker 3rd');
ok(h('Ah Ad Kc Qs Jh 3d 2c').score === h('As Ac Kh Qd Jc 4d 2s').score, 'tie ignores 6th card');
ok(h('2h 2d 2c 2s Ah Kd Qc').cat === 7 && h('Kh 9h 7h 3h 2h Ad Ac').cat === 5, 'quads, flush over pair');
ok(h('Kh 9h 7h 3h 2h Ad Ac').score < h('Ah 9h 7h 3h 2h Kd Kc').score, 'flush high');
ok(h('7h 7d 7c Ks Qh 3d 2c').cat === 3 && h('7h 8d 9c 10s Jh Jd Jc').cat === 4, 'trips / straight over trips');

// helpers
function mk(nPl, stacks, settings = {}) {
  const t = new PokerTable({ smallBlind: 5, bigBlind: 10, sevenDeuce: 0, ...settings });
  for (let i = 0; i < nPl; i++) { t.join('p' + i, 'P' + i); t.sit('p' + i, i, Array.isArray(stacks) ? stacks[i] : stacks); t.setRuns('p' + i, 1); }
  return t;
}
const tot = (t) => t.chipsTotal();
// basic heads up: button is SB and acts first preflop, BB first postflop
{
  const t = mk(2, 1000); t.startHand();
  const b = t.button, o = 1 - b;
  ok(t.seats[b].bet === 5 && t.seats[o].bet === 10, 'HU blinds');
  ok(t.turn === b, 'HU button first preflop');
  t.act('p' + b, 'call'); ok(t.turn === o && t.phase === 'preflop', 'BB option');
  ok(t.options('p' + o).canCheck && t.options('p' + o).canRaise, 'BB may raise');
  t.act('p' + o, 'check'); ok(t.phase === 'flop' && t.turn === o && t.pot === 20, 'flop, BB first');
  t.act('p' + o, 'bet', 20); t.act('p' + b, 'fold');
  ok(t.phase === 'done' && t.seats[o].stack === 1010 && t.seats[b].stack === 990, 'fold win, uncalled back');
  ok(tot(t) === 2000, 'chips');
  ok(verifyHand(t.fair.last).ok, 'verify');
}
// 3 handed order + min raise + short all-in not reopening
{
  const t = mk(4, [1000, 1000, 1000, 35]); t.startHand();
  // button = seat 0 (first hand: nextFrom(last)=0). sb1 bb2 utg3
  ok(t.button === 0 && t.turn === 3, 'utg first ' + t.button + ' ' + t.turn);
  let threw = false; try { t.act('p0', 'call'); } catch { threw = true; } ok(threw, 'out of turn');
  t.act('p3', 'call');
  t.act('p0', 'raise', 30); // raise by 20
  threw = false; try { t.act('p1', 'raise', 45); } catch { threw = true; } ok(threw, 'min raise is 50');
  t.act('p1', 'call'); t.act('p2', 'call');
  // p3 has 25 behind with bet 10: all in to 35 = raise of 5 (short)
  ok(t.turn === 3, 'back to p3');
  t.act('p3', 'raise', 35);
  ok(t.turn === 0, 'p0 must respond');
  const o = t.options('p0');
  ok(o.toCall === 5 && !o.canRaise, 'short all-in does not reopen');
  t.act('p0', 'call'); t.act('p1', 'call'); t.act('p2', 'call');
  ok(t.phase === 'flop' && t.pot === 140, 'pot 140 got ' + t.pot);
  ok(t.turn === 1, 'sb first postflop');
  t.act('p1', 'check'); t.act('p2', 'check'); t.act('p0', 'check');
  ok(t.phase === 'turn', 'turn');
  t.act('p1', 'bet', 100); t.act('p2', 'fold'); t.act('p0', 'call');
  t.act('p1', 'check'); t.act('p0', 'check');
  ok(t.phase === 'done' && tot(t) === 3035, 'done chips ' + tot(t));
}
// side pots with forced hands
function rig(t, holes, board) { // holes by seat index; called right after startHand before more cards
  for (const [i, cs] of Object.entries(holes)) t.seats[i].cards = C(cs);
  const used = new Set([...Object.values(holes).flatMap((x) => C(x)), ...C(board)].map(cardText));
  const rest = t.deck.filter((c) => !used.has(cardText(c)));
  const b = C(board);
  t.deck = [rest[0], b[0], b[1], b[2], rest[1], b[3], rest[2], b[4], ...rest.slice(3)];
}
{
  const t = mk(3, [100, 300, 1000]); t.startHand(); // btn0 sb1 bb2, p0 first
  rig(t, { 0: 'A♠ A♥', 1: 'K♠ K♥', 2: 'Q♠ Q♥' }, '2♣ 7♦ 9♣ J♦ 3♠');
  t.act('p0', 'raise', 100); t.act('p1', 'raise', 300); t.act('p2', 'call');
  ok(t.phase === 'done', 'run out ' + t.phase);
  ok(t.seats[0].stack === 300 && t.seats[1].stack === 400 && t.seats[2].stack === 700, 'side pots ' + t.seats.slice(0, 3).map((x) => x.stack));
  ok(t.result.board.length === 5 && tot(t) === 1400, 'board5');
}
{ // split pot with odd chip; 3 way all in equal hands on board
  const t = mk(3, [101, 101, 101], { smallBlind: 1, bigBlind: 2, ante: 1 }); t.startHand();
  rig(t, { 0: '2♠ 3♥', 1: '2♥ 3♦', 2: '4♠ 4♥' }, 'A♣ K♦ Q♣ J♦ 10♠');
  t.act('p0', 'raise', 100); t.act('p1', 'call'); t.act('p2', 'call');
  ok(t.phase === 'done' && t.seats.slice(0, 3).every((x) => x.stack === 101), 'board plays split ' + t.seats.slice(0, 3).map((x) => x.stack));
}
{ // odd chip to first left of button
  const t = mk(3, [100, 100, 100], { smallBlind: 5, bigBlind: 10 }); t.startHand();
  rig(t, { 0: 'A♠ 3♥', 1: 'A♥ 3♦', 2: '4♠ 5♥' }, 'A♣ K♦ Q♣ 9♦ 8♠');
  t.act('p0', 'call'); t.act('p1', 'call'); t.act('p2', 'check');
  t.act('p1', 'bet', 15); t.act('p2', 'fold'); t.act('p0', 'call'); // pot 30+30=60 no odd.. make odd
  t.act('p1', 'check'); t.act('p0', 'check'); t.act('p1', 'check'); t.act('p0', 'check');
  ok(t.seats[0].stack === 105 && t.seats[1].stack === 105 && t.seats[2].stack === 90, 'split ' + t.seats.slice(0, 3).map((x) => x.stack));
}
{ // 7-2 bounty
  const t = mk(3, 500, { sevenDeuce: 20 }); t.startHand();
  rig(t, { 0: '7♠ 2♥', 1: 'A♥ 3♦', 2: '4♠ 5♥' }, 'A♣ K♦ Q♣ 9♦ 8♠');
  t.act('p0', 'raise', 30); t.act('p1', 'fold'); t.act('p2', 'fold');
  ok(t.seats[0].stack === 500 + 15 + 40 && t.result.bounty.length === 1, '7-2 bounty ' + t.seats[0].stack);
  ok(tot(t) === 1500, 'bounty chips');
  // rabbit hunt
  t.rabbitHunt('p1'); ok(t.rabbit && t.rabbit.map(cardText).join(' ') === 'A♣ K♦ Q♣ 9♦ 8♠', 'rabbit ' + (t.rabbit || []).map(cardText));
}
{ // bomb pot
  const t = mk(4, 500, { bombPotAnte: 3 }); t.setBombNext(true); t.startHand();
  ok(t.phase === 'flop' && t.pot === 120 && t.board.length === 3, 'bomb pot flop ' + t.phase + t.pot);
  ok(t.turn === 1, 'bomb first to act left of button ' + t.turn);
  t.act('p1', 'check'); t.act('p2', 'check'); t.act('p3', 'check'); t.act('p0', 'check');
  ok(t.phase === 'turn', 'bomb turn');
}
{ // big blind short all in, sb completes
  const t = mk(3, [500, 500, 4]); t.startHand();
  ok(t.seats[2].allIn && t.seats[2].bet === 4, 'bb short');
  ok(t.options('p0').toCall === 10, 'call is still full bb');
  t.act('p0', 'call'); t.act('p1', 'call');
  ok(t.phase === 'flop' && t.turn === 1, 'continue side betting ' + t.phase + t.turn);
  t.act('p1', 'check'); t.act('p0', 'check'); t.act('p1', 'check'); t.act('p0', 'check'); t.act('p1', 'check'); t.act('p0', 'check');
  ok(t.phase === 'done' && tot(t) === 1004, 'bb short done');
}
{ // stand up mid hand, not turn
  const t = mk(3, 500); t.startHand();
  t.standUp('p2'); ok(t.seats[2] && t.seats[2].folded && t.turn === 0, 'leaver folded');
  t.act('p0', 'fold'); ok(t.phase === 'done' && !t.seats[2], 'seat freed'); ok(tot(t) === 1010 && t.seats[1].stack === 510, 'sb wins bb ' + t.seats[1].stack);
}
{ // straddle
  const t = mk(4, 500, { straddle: true }); t.setStraddle('p3', true); t.startHand();
  ok(t.seats[3].bet === 20 && t.turn === 0 && t.currentBet === 20, 'straddle');
  t.act('p0', 'call'); t.act('p1', 'call'); t.act('p2', 'call');
  ok(t.turn === 3 && t.options('p3').canCheck && t.options('p3').canRaise, 'straddler option');
  ok(t.options('p3').minTo === 40, 'straddle min raise to 40 got ' + t.options('p3').minTo);
}
// fuzz (fewer random boards per all in, so 16,000 hands finish quickly)
PokerTable.samples = 30;
function rnd(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
for (let g = 0; g < 400; g++) {
  PokerTable.noChances = g % 20 !== 0; // working out the chances is slow, so one game in 20 does it
  const R = rnd(g + 1), np = 2 + Math.floor(R() * 8);
  const t = mk(np, Array.from({ length: np }, () => 20 + Math.floor(R() * 2000)), { ante: R() < 0.3 ? 2 : 0, sevenDeuce: R() < 0.5 ? 10 : 0, bombPotEvery: R() < 0.3 ? 3 : 0, straddle: R() < 0.5, runTimes: 1 + Math.floor(R() * 10) });
  for (let i = 0; i < np; i++) { if (R() < 0.4) t.setStraddle('p' + i, true); t.setRuns('p' + i, 1 + Math.floor(R() * 10)); }
  let bank = tot(t);
  for (let hnd = 0; hnd < 40 && t.canStart(); hnd++) {
    t.startHand();
    let steps = 0;
    while (t.inHand()) {
      if (++steps > 500) { ok(false, 'stuck g' + g); break; }
      if (t.turn === null) { ok(false, 'no turn in hand g' + g + ' ' + t.phase); break; }
      const id = t.seats[t.turn].id, o = t.options(id), r = R();
      
      if (R() < 0.03) { const q = 'p' + Math.floor(R() * np); if (t.seatOf(q) >= 0 && R() < 0.5) { t.standUp(q); } continue; }
      if (r < 0.15 && !o.canCheck) t.act(id, 'fold');
      else if (r < 0.6 || !o.canRaise) t.act(id, o.canCheck ? 'check' : 'call');
      else { const to = R() < 0.2 ? o.maxTo : Math.min(o.maxTo, o.minTo + Math.floor(R() * 100)); t.act(id, o.isBet ? 'bet' : 'raise', to); }
    }
    // leavers freed at the end took their stack
    const now = tot(t);
    const paidIn = Object.values(t.players).reduce((x, p) => x + p.totalIn, 0);
    { const L = t.publicState('p0').ledger; ok(L.reduce((x, p) => x + p.net, 0) === 0, 'ledger zero sum g' + g + ' ' + L.reduce((x, p) => x + p.net, 0)); }
    if (now > bank) { ok(false, `chips grew g${g} ${bank}->${now}`); break; }
    bank = now;
    ok(t.pot === 0 && t.seats.every((x) => !x || x.bet === 0), 'clean end');
    ok(verifyHand(t.fair.last).ok, 'verify g' + g);
    ok(new Set(t.dealt.map(cardText)).size === t.dealt.length && t.dealt.length <= 52, 'no card twice g' + g);
    const s = JSON.stringify(t.publicState('p1')); ok(!s.includes(t.fair.next.seed) && (hnd > 18 || !s.includes(t.fair.last.serverSeed)), 'no seed leak'); t.setClientSeed('p1', 'abc' + hnd, t.fair.next.commit); t.setClientSeed('p0', 'zzz', t.fair.next.commit);
  }
}
// every deck is one full pack: 52 different cards
{
  const pos = {}; const T = 20000;
  for (let k = 0; k < T; k++) {
    const d = pokerDeck('seed' + k, { a: 'x' + (k * 7) });
    if (k < 300) ok(d.length === 52 && new Set(d.map(cardText)).size === 52, 'full deck');
    // where does the ace of spades land, and which card is dealt first
    const i = d.findIndex((c) => c.r === 'A' && c.s === '♠'); pos[i] = (pos[i] || 0) + 1;
    const f = cardText(d[0]); pos['f' + f] = (pos['f' + f] || 0) + 1;
  }
  // chi-square over 52 cells, 51 degrees of freedom: 99.9% of fair shuffles score under 87
  const chi = (keys) => keys.reduce((a, k) => a + ((pos[k] || 0) - T / 52) ** 2 / (T / 52), 0);
  const c1 = chi(Array.from({ length: 52 }, (_, i) => i)), c2 = chi(Object.keys(pos).filter((k) => k[0] === 'f'));
  ok(c1 < 87 && c2 < 87 && Object.keys(pos).filter((k) => k[0] === 'f').length === 52, `shuffle even: ${c1.toFixed(1)} ${c2.toFixed(1)}`);
  console.log('shuffle chi-square (fair is near 51, limit 87):', c1.toFixed(1), c2.toFixed(1));
}
{ // all in before the flop: chances and outs
  PokerTable.samples = 4000; PokerTable.noChances = false;
  const t = mk(2, 500); t.startHand();
  rig(t, { 0: 'A♠ A♥', 1: 'K♠ K♥' }, '2♣ 7♦ 9♣ J♦ 3♠');
  const b = t.button; t.act('p' + b, 'raise', 500); t.act('p' + (1 - b), 'call');
  const r = t.result.runout;
  ok(r && r.length === 3 && r[0].n === 0 && r[1].n === 3 && r[2].n === 4, 'runout stages');
  ok(r[0].pct[0] > 77 && r[0].pct[0] < 87, 'AA v KK preflop about 82%: ' + r[0].pct[0]);
  ok(r[1].outs[1] === 2 && r[2].outs[1] === 2 && Math.abs(r[2].pct[1] - 100 * 2 / 44) < 0.06, 'KK has 2 outs: ' + JSON.stringify(r[2]));
  ok(Math.abs(r[1].pct[0] + r[1].pct[1] - 100) < 0.2, 'sums to 100');
}
{ // run it three times: pot shared between the runs
  const t = mk(2, 300); t.setRuns('p0', 3); t.setRuns('p1', 7); t.startHand();
  rig(t, { 0: 'A♠ A♥', 1: 'K♠ K♥' }, '2♣ 7♦ 9♣ J♦ 3♠');
  // after the first board the deck continues: give run 2 a king, run 3 blanks
  const b = t.button; t.act('p' + b, 'raise', 300);
  const used = new Set(['A♠', 'A♥', 'K♠', 'K♥', '2♣', '7♦', '9♣', 'J♦', '3♠', 'K♦', '4♣', '5♦', '8♥', '10♠', '4♦', '5♣', '6♥', '8♠', 'Q♦']);
  const rest = t.deck.slice(8).filter((c) => !used.has(cardText(c)));
  t.deck = [...t.deck.slice(0, 8), ...C('K♦ 4♣ 5♦ 8♥ 10♠ 4♦ 5♣ 6♥ 8♠ Q♦'), ...rest];
  t.act('p' + (1 - b), 'call');
  ok(t.result.boards && t.result.boards.length === 3, 'three boards');
  ok(t.seats[0].stack === 400 && t.seats[1].stack === 200, 'AA wins runs 1 and 3, KK run 2: ' + t.seats[0].stack + ' ' + t.seats[1].stack);
}
{ // vote away needs every other player
  const t = mk(4, 500);
  t.voteAway('p0', 'p3'); t.voteAway('p1', 'p3'); ok(!t.seats[3].out, 'two of three votes is not enough');
  t.voteAway('p2', 'p3'); ok(t.seats[3].out, 'all three votes mark away');
  t.sitOut('p3', false); ok(!t.seats[3].out, 'back with one press');
}
{ // chips off the table
  const t = mk(2, 500); let thr = 0;
  t.takeChips('p0', 200); ok(t.seats[0].stack === 300 && t.players.p0.totalIn === 300, 'take chips');
  try { t.takeChips('p0', 301); } catch { thr++; } t.startHand(); try { t.takeChips('p0', 10); } catch { thr++; } ok(thr === 2, 'no chips off in a hand or past the stack');
}

{ // show one card
  const t = mk(2, 500); t.startHand(); const b = t.button;
  t.act('p' + b, 'fold');
  t.showCards('p' + b, 1);
  const pub = t.publicState('p' + (1 - b)).seats[b];
  ok(pub.cards[0] === null && pub.cards[1] && cardText(pub.cards[1]) === cardText(t.seats[b].cards[1]), 'one card shown, the other hidden');
  const rec = t.hist[t.hist.length - 1].seats.find((x) => x.seat === b);
  ok(rec.cards[0] === null && rec.cards[1], 'record holds the one shown card');
  t.showCards('p' + b, 0); ok(t.seats[b].show && t.publicState('zz').seats[b].cards.every(Boolean), 'second card shown too');
}
{ // VPIP and PFR
  const t = mk(3, 500); t.startHand(); const b = t.button;
  t.act(t.seats[t.turn].id, 'raise', 30); const raiser = Object.values(t.players).find((p) => t.seats[t.seatOf(p.id)].pf).id;
  t.act(t.seats[t.turn].id, 'call'); t.act(t.seats[t.turn].id, 'fold');
  while (t.inHand()) { const id = t.seats[t.turn].id; t.act(id, 'check'); }
  const st = t.players[raiser].stats; ok(st.hands === 1 && st.vpip === 1 && st.pfr === 1 && st.sd === 1, 'raiser stats');
  const all = Object.values(t.players).map((p) => p.stats); ok(all.reduce((a, x) => a + x.vpip, 0) === 2 && all.reduce((a, x) => a + x.pfr, 0) === 1, 'vpip 2, pfr 1'); void b;
}
// The table moves to another browser in the middle of a hand: the hand goes on and every chip is kept.
for (let g = 0; g < 300; g++) {
  PokerTable.noChances = true;
  const nP = 2 + (g % 6);
  let t = mk(nP, 300 + g);
  if (g % 3 === 0) for (let i = 0; i < nP; i++) t.setRuns('p' + i, 3);
  const chips = t.chipsTotal();
  t.startHand();
  const hole = {}; for (let i = 0; i < nP; i++) hole['p' + i] = { cards: t.seats[i].cards, salt: t.seats[i].salt };
  const step = (tb) => { const id = tb.seats[tb.turn].id, o = tb.options(id), r = Math.random(); if (r < 0.12 && !o.canCheck) tb.act(id, 'fold'); else if (r < 0.3 && o.canRaise) tb.act(id, 'raise', r < 0.2 ? o.maxTo : o.minTo); else tb.act(id, o.canCheck ? 'check' : 'call'); };
  let k = g % 5; while (k-- > 0 && t.inHand()) step(t);
  if (!t.inHand()) continue;
  const boardBefore = t.board.map(cardText).join(' ');
  // the new host is a player who sees only what it is told
  const nh = 'p' + (1 + (g % (nP - 1)));
  const pub = JSON.parse(JSON.stringify(t.publicState(nh)));
  ok(!JSON.stringify(pub).includes(t.cur.serverSeed) && !JSON.stringify(pub).includes(hole[nh === 'p0' ? 'p1' : 'p0'].salt), 'no seed and no other secret word in what a player is told');
  const m = PokerTable.fromPublic(pub, nh, { cards: pub.seats[m0(pub, nh)].cards, salt: pub.mySalt });
  ok(m.chipsTotal() === chips && m.turn === t.turn && m.currentBet === t.currentBet && m.minRaise === t.minRaise, 'moved table has the same chips, turn and bets');
  // a liar is refused, the true cards are taken
  const liveBefore = m.liveSeats();
  ok(m.giveCards('p0', [{ r: 'A', s: '♠' }, { r: 'A', s: '♥' }], hole.p0.salt) === (cardText(hole.p0.cards[0]) + cardText(hole.p0.cards[1]) === 'A♠A♥' && m.seats[0].inHand), 'made up cards are refused');
  const absent = g % 7 === 3 ? liveBefore.find((i) => 'p' + i !== nh) : -1; // one live player never comes back
  for (let i = 0; i < nP; i++) if ('p' + i !== nh && i !== absent && m.seats[i].inHand) ok(m.giveCards('p' + i, hole['p' + i].cards, hole['p' + i].salt), 'true cards are taken');
  ok(m.missingCards().length === (absent >= 0 ? 1 : 0), 'cards missing only for the absent player');
  for (const i of m.missingCards()) m.redraw(i);
  while (m.inHand()) step(m);
  ok(m.chipsTotal() === chips, 'chips kept after the move: ' + m.chipsTotal() + ' / ' + chips);
  ok(m.board.map(cardText).join(' ').startsWith(boardBefore), 'board before the move stays');
  const seenAll = [...(m.result.boards ? m.result.boards.flat().slice(0) : m.board)].map(cardText);
  const holes = m.seats.filter((x) => x && x.inHand && x.cards.length).flatMap((x) => x.cards.map(cardText));
  const uniq = new Set([...new Set(seenAll), ...holes]);
  ok(uniq.size === new Set(seenAll).size + holes.length, 'no card twice after the move');
  if (absent < 0) for (let i = 0; i < nP; i++) if (m.seats[i] && m.seats[i].inHand && m.seats[i].cards.length) ok(m.seats[i].cards.map(cardText).join() === hole['p' + i].cards.map(cardText).join(), 'same hole cards');
  if (m.canStart()) { m.startHand(); ok(m.inHand() && m.chipsTotal() === chips, 'next hand deals on the moved table'); }
  t = null;
}
function m0(pub, id) { return pub.seats.findIndex((x) => x && x.id === id); }
PokerTable.noChances = false;
console.log(`${n - fails}/${n} poker checks passed`);
process.exit(fails ? 1 : 0);
