// Stress run of "announce first, then reveal" (run: node test/announce.stress.test.mjs; ROUNDS=n to change).
// Thousands of rounds with 1, 2 and 3 players (some on two seats), random moves including ace resplits,
// surrender, side bets, insurance, buy ins mid hand, sit out and leaving mid round, auto unseat, a player dealer
// who walks away mid round, players dropping and coming back, and host reloads mid hand.
// Every round: each card went to its announced place, the saved table (the host's one line) holds the hole card,
// and every finished shoe replays card for card from its seeds and keys.
import * as G from '../js/game.js';
const ROUNDS = Number(process.env.ROUNDS || 1500);
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; if (fails < 20) console.log('FAIL', m); } };
let rnd = 12345; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pickOf = (a) => a[Math.floor(rand() * a.length)];
let kc = 0;
const T = { rounds: 0, hole: 0, holeBad: 0, split: 0, aceResplit: 0, double: 0, surrender: 0, hit: 0, ins: 0, insBuy: 0, dblBuy: 0, splitBuy: 0, sitOut: 0, leaveMid: 0, unseated: 0, dealerWalk: 0, drop: 0, back: 0, reload: 0, shoesReplayed: 0, replayBad: 0, wrong: 0, burns: 0, keyCards: 0 };
function track(t) {
  const orig = G.Table.prototype.pick;
  t.pick = function (to) { const c = orig.call(this, to); const k = this.fair?.current?.n; (this.__seen ||= {})[k] ||= []; this.__seen[k].push(c.r + c.s); return c; };
  const ns = t.newShoe.bind(t);
  t.newShoe = function () { const r = ns(); checkReplay(this); return r; };
}
function checkReplay(t) {
  const last = t.fair?.last; if (!last || !last.serverSeed || t.__checked?.[last.n]) return;
  (t.__checked ||= {})[last.n] = true;
  const seen = t.__seen?.[last.n]; if (!seen) return;
  const again = G.replayShoe(last).map((c) => c.r + c.s);
  T.shoesReplayed++; if (again.join() !== seen.join()) T.replayBad++;
}
const run = (t, plan, fn) => {
  t.keys = plan.map(() => 'k' + ++kc); t.plan = plan.slice();
  try { fn(); } catch (e) { /* a refused move: its cards are burned below */ }
  while (t.keys.length && t.burnCard()) T.burns++;
  t.keys = null; t.plan = null;
};
for (const players of [1, 2, 3]) {
  let t = Object.assign(new G.Table({ decks: 6, startChips: 300, maxBet: 75, minBet: 5, penetration: 65, sideBets: ['hot3', 'bustIt', 'twentyOnePlus3', 'perfectPairs'] }), { frozen: true });
  track(t);
  const ids = ['a', 'b', 'c'].slice(0, players);
  ids.forEach((id, i) => { t.join(id, id.toUpperCase()); t.sit(id, i * 2); if (i === 0 && players > 1) t.sit(id, 6, true); });
  let banker = null;
  for (let r = 0; r < ROUNDS; r++) {
    // A player dealer for a stretch (players = 3): 'd' deals, then walks away mid round.
    if (players === 3 && r % 300 === 50 && !banker) { t.join('d', 'Dee'); t.players.d.chips = 5000; t.applyDealer('d'); banker = 'd'; }
    for (const id of ids) {
      const p = t.players[id];
      if (!p) continue;
      if (!p.connected) { t.join(id, id.toUpperCase()); T.back++; }
      if (t.seatsOf(id).length === 0) { for (const s of [ids.indexOf(id) * 2, 1, 3, 5]) { if (!t.seats[s]) { try { t.sit(id, s); break; } catch {} } } }
      if (p.chips < 20) p.chips = 20 + Math.floor(rand() * 40); // short stacks, so buy ins happen
      for (const s of t.seatsOf(id)) {
        if (t.seats[s].out) t.sitOut(id, s, false);
        if (rand() < 0.04) { T.unseated++; continue; } // no bet: auto unseat at the deal
        const sides = rand() < 0.5 ? { [pickOf(['hot3', 'bustIt', 'twentyOnePlus3', 'perfectPairs'])]: 5 } : {};
        try { t.setBet(id, { main: 5 + 5 * Math.floor(rand() * 4), sides, seat: s }); } catch {}
      }
    }
    if (!t.canDeal()) { t.startBetting(); continue; }
    const plan = t.dealPlan();
    run(t, plan, () => t.deal());
    if (!t.inRound()) { t.startBetting(); continue; }
    T.rounds++;
    // The host's one line: the saved table holds both dealer cards, the second one face down for the guests.
    const holeCheck = (tt) => { const saved = JSON.parse(JSON.stringify(tt)); const d = saved.dealer.cards; const g = tt.publicState('b').dealer.cards; if (d.length >= 2 && d.every((c) => c.r && c.s) && (tt.dealer.revealed || !(g[1] && g[1].r))) T.hole++; else { T.holeBad++; } };
    holeCheck(t);
    let g = 0, reloaded = false;
    while (t.inRound() && g++ < 300) {
      // A host reload mid hand: the table comes back from its saved copy and plays on.
      if (!reloaded && r % 37 === 5 && t.phase === 'playing') {
        const saved = t.toJSON ? JSON.parse(JSON.stringify(t)) : JSON.parse(JSON.stringify(t));
        const seen = t.__seen, checked = t.__checked;
        t = G.Table.fromJSON(saved); t.__seen = seen; t.__checked = checked; track(t);
        for (const id of [...ids, banker].filter(Boolean)) if (t.players[id]) t.players[id].connected = true;
        reloaded = true; T.reload++; holeCheck(t);
      }
      if (t.phase === 'insurance') {
        for (const id of ids) for (const s of t.seatsOf(id)) {
          const seat = t.seats[s]; if (!seat.hands.length || seat.insuranceDecided) continue;
          const take = rand() < 0.5, cost = Math.ceil(seat.bet.main / 2);
          if (take && t.players[id].chips < cost) { const q = t.requestBuyIn(id, 100); t.answerBuyIn(q.id, true); T.insBuy++; }
          if (take) T.ins++;
          run(t, [], () => t.insurance(id, take, s));
        }
        if (t.phase === 'insurance') run(t, [], () => t.forceInsurance());
        continue;
      }
      if (t.phase === 'playing') {
        const seat = t.seats[t.turn.seat], id = seat.playerId, p = t.players[id];
        // Now and then something happens mid hand: a player drops, sits out, leaves after the round.
        const x = rand();
        if (x < 0.01 && p.connected) { t.disconnect(id); t.markGone(id); T.drop++; }
        else if (x < 0.02) { try { t.sitOut(id, t.turn.seat, true); T.sitOut++; } catch {} }
        else if (x < 0.03) { try { t.leaveSeat(id, t.turn.seat); T.leaveMid++; } catch {} }
        if (!p.connected) { run(t, t.awayPlan(), () => t.awayMove()); continue; }
        const h = seat.hands[t.turn.hand];
        let acts = t.allowedActions(id);
        // Short of chips for a double or split: buy in, then make the move in the same step.
        const pair = h.cards.length === 2 && G.handTotal([h.cards[0]]).total === G.handTotal([h.cards[1]]).total;
        if (h.cards.length === 2 && p.chips < h.bet && (pair || rand() < 0.3)) {
          const then = pair ? 'split' : 'double';
          const q = t.requestBuyIn(id, 100); t.answerBuyIn(q.id, true);
          if (then === 'split') T.splitBuy++; else T.dblBuy++;
          acts = t.allowedActions(id);
          if (acts.includes(then)) { if (then === 'split') { T.split++; if (h.splitAces) T.aceResplit++; } else T.double++; run(t, t.movePlan(id, then, false), () => t.action(id, then)); continue; }
        }
        const tot = G.handTotal(h.cards).total;
        let a;
        if (acts.includes('split') && (h.cards[0].r === 'A' || rand() < 0.8)) a = 'split';
        else if (acts.includes('surrender') && tot >= 15 && tot <= 16 && rand() < 0.4) a = 'surrender';
        else if (acts.includes('double') && tot >= 9 && tot <= 11) a = 'double';
        else if (acts.includes('hit') && tot < 17 && rand() < 0.8) a = 'hit';
        else a = 'stand';
        if (a === 'split') { T.split++; if (h.splitAces) T.aceResplit++; }
        if (a === 'double') T.double++; if (a === 'surrender') T.surrender++; if (a === 'hit') T.hit++;
        run(t, t.movePlan(id, a), () => t.action(id, a));
        continue;
      }
      if (t.phase === 'dealer') {
        if (banker && r % 300 === 120) { t.leaveLater(banker, true); T.dealerWalk++; }
        run(t, t.dealerPlan(), () => t.dealerStep());
      }
    }
    if (banker && !t.banker) { banker = null; t.setFrozen?.(true); if (!t.banker && !t.frozen) t.frozen = true; }
    ok(!t.inRound(), `round ${r} (${players} players) finished`);
    t.startBetting();
  }
  checkReplay(t);
  const dealt = t.fair.dealt || [];
  T.wrong += t.log.filter((l) => /was announced for .* but went to/.test(l)).length;
  T.keyCards += t.fair.cards;
}
console.log(JSON.stringify(T));
ok(T.rounds > ROUNDS * 2.5, 'rounds played: ' + T.rounds);
ok(T.holeBad === 0 && T.hole >= T.rounds, `hole card in the saved table every time (${T.hole} checks, ${T.holeBad} bad)`);
ok(T.wrong === 0, 'every card went where it was announced');
ok(T.burns === 0, 'no card burned in normal play: ' + T.burns);
ok(T.replayBad === 0 && T.shoesReplayed > 20, `every finished shoe replays card for card (${T.shoesReplayed} shoes)`);
for (const k of ['split', 'aceResplit', 'double', 'surrender', 'ins', 'insBuy', 'dblBuy', 'sitOut', 'leaveMid', 'unseated', 'drop', 'reload', 'dealerWalk']) ok(T[k] > 0, 'happened: ' + k + ' ' + T[k]);
console.log(`${n - fails}/${n} announce stress checks passed`);
process.exit(fails ? 1 : 0);
