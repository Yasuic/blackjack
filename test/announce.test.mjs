// Announce first, then reveal: every card goes exactly where the host announced it, over many rounds with
// splits, doubles, hits, insurance and dealer draws. A card whose move did not happen is burned and logged.
import * as G from '../js/game.js';
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
let kc = 0;
const run = (t, plan, fn) => { t.keys = plan.map(() => 'k' + ++kc); t.plan = plan.slice(); fn(); while (t.keys.length && t.burnCard()); t.keys = null; t.plan = null; };
const t = Object.assign(new G.Table({ decks: 8, startChips: 100000, maxBet: 1000 }), { frozen: true });
for (const [id, s] of [['a', 0], ['b', 2], ['c', 4]]) { t.join(id, id.toUpperCase()); t.sit(id, s); }
let wrong = 0, splits = 0, doubles = 0, ins = 0, rounds = 0;
const moves = () => (t.fair.dealt || []).filter((d) => d.want && d.to !== 'burn').length;
for (let r = 0; r < 400; r++) {
  for (const [id, s] of [['a', 0], ['b', 2], ['c', 4]]) t.setBet(id, { main: 10, sides: {}, seat: s });
  run(t, t.dealPlan(), () => t.deal());
  rounds++;
  let g = 0;
  while (t.inRound() && g++ < 200) {
    if (t.phase === 'insurance') { for (const [id, s] of [['a', 0], ['b', 2], ['c', 4]]) { const seat = t.seats[s]; if (seat.hands.length && !seat.insuranceDecided) { const take = r % 2 === 0; if (take) ins++; run(t, [], () => t.insurance(id, take, s)); } } continue; }
    if (t.phase === 'playing') {
      const id = t.seats[t.turn.seat].playerId, acts = t.allowedActions(id);
      const a = acts.includes('split') ? 'split' : acts.includes('double') && r % 3 === 0 ? 'double' : acts.includes('hit') && handTotalOf(t) < 15 ? 'hit' : 'stand';
      if (a === 'split') splits++; if (a === 'double') doubles++;
      run(t, t.movePlan(id, a), () => t.action(id, a));
      continue;
    }
    if (t.phase === 'dealer') run(t, t.dealerPlan(), () => t.dealerStep());
  }
  t.startBetting();
}
function handTotalOf(t) { const h = t.seats[t.turn.seat].hands[t.turn.hand]; return G.handTotal(h.cards).total; }
wrong = moves();
ok(wrong === 0, `every card went where it was announced (${wrong} did not)`);
ok(splits > 20 && doubles > 20 && ins > 20, `rounds had splits ${splits}, doubles ${doubles}, insurance ${ins}`);
ok(!t.log.some((l) => /was announced for .* but went to/.test(l)), 'no mismatch in the log');
ok(t.fair.cards > 3000, 'cards opened with keys: ' + t.fair.cards);
// A move that does not happen: its card is burned and the log names the place it was announced for.
{
  const u = Object.assign(new G.Table({ decks: 1 }), { frozen: true }); u.join('a', 'A'); u.sit('a', 0);
  u.setBet('a', { main: 10, sides: {} }); run(u, u.dealPlan(), () => u.deal());
  if (u.phase === 'insurance') run(u, [], () => u.insurance('a', false, 0));
  if (u.phase === 'playing') {
    run(u, ['s0.0'], () => { /* the hit never happens */ });
    ok(u.log.some((l) => /Burned card \d+: .* \(announced for seat 1 hand 1, the move did not happen\)/.test(l)), 'burned card names its announced place');
    const last = u.fair.dealt[u.fair.dealt.length - 1];
    ok(last.to === 'burn' && last.want === 's0.0', 'public list shows the burn and the announced place');
  } else ok(true, 'round ended at once'), ok(true, '');
  // A card sent somewhere else than announced is written in the log.
  const v = Object.assign(new G.Table({ decks: 1 }), { frozen: true }); v.join('a', 'A'); v.sit('a', 0); v.setBet('a', { main: 10, sides: {} });
  const plan = v.dealPlan(); plan[0] = 'D';
  run(v, plan, () => v.deal());
  ok(v.log.some((l) => /Card 1 was announced for the dealer but went to seat 1 hand 1/.test(l)), 'a card sent elsewhere is in the log');
  ok(G.destName('s2.1') === 'seat 3 hand 2' && G.destName('H') === "the dealer's hole card", 'place names');
}
// The saved table keeps the whole dealer hand, so a reload of the host's tab carries on the same round.
{
  const w = Object.assign(new G.Table({ decks: 8 }), { frozen: true }); w.join('a', 'A'); w.sit('a', 0); w.setBet('a', { main: 10, sides: {} });
  run(w, w.dealPlan(), () => w.deal());
  const saved = JSON.parse(JSON.stringify(w));
  ok(saved.dealer.cards.length === 2 && saved.dealer.cards.every((c) => c.r && c.s), 'saved table holds both dealer cards');
  ok(!('halted' in saved), 'no pause flag any more');
}
console.log(`${n - fails}/${n} announce checks passed`);
process.exit(fails ? 1 : 0);
