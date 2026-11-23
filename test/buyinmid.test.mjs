// Buying in more chips in the middle of a hand to cover insurance, a double or a split: the move is played,
// the chips add up (zero sum with the buy-in counted), and the shown ledger waits until the hand is settled.
import { Table } from '../js/game.js';
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
const C = (s) => ({ r: s.slice(0, -1), s: s.slice(-1) });
function rigged(cards) { const t = new Table({}); t.join('a', 'A', 60); t.join('b', 'B', 1000); t.sit('a', 0); t.sit('b', 1); t.setFrozen(true); const q = cards.map(C); t.pick = () => q.shift(); t.needsShuffle = () => false; return t; }
const ledger = (t, id) => t.publicState(id).ledger.find((r) => r.id === id);
// Insurance: A bets all 100, dealer shows an ace, A has 0 left.
{
  // deal order: a, b, dealer up, a, b, dealer hole
  const t = rigged(['9H', '5C', 'AS', '9D', '6C', 'KH', '2C', '3C', '4C']);
  t.setBet('a', { main: 60, sides: {}, ready: true, seat: 0 }); t.setBet('b', { main: 10, sides: {}, ready: true, seat: 1 });
  t.deal();
  ok(t.phase === 'insurance', 'insurance offered: ' + t.phase);
  ok(!t.seats[0].insuranceDecided, 'a short player is still asked about insurance');
  let threw = false; try { t.insurance('a', true, 0); } catch { threw = true; }
  ok(threw, 'insurance without the chips is refused');
  const req = t.requestBuyIn('a', 30); t.answerBuyIn(req.id, true); t.insurance('a', true, 0);
  ok(t.seats[0].insurance === 30 && t.players.a.chips === 0, 'bought in 30 and took insurance');
  ok(ledger(t, 'a').totalIn === 60 && ledger(t, 'a').chips === 60, 'shown ledger unchanged mid hand');
  t.insurance('b', false, 1);
  let g = 0; while (t.inRound() && g++ < 50) { if (t.phase === 'playing') { const s = t.seats[t.turn.seat]; t.action(s.playerId, 'stand'); } else if (t.phase === 'dealer') t.dealerStep(); }
  ok(!t.inRound(), 'hand settled');
  ok(t.players.a.totalIn === 90, 'buy-in counted: ' + t.players.a.totalIn);
  ok(ledger(t, 'a').totalIn === 90, 'ledger shows the buy-in after the hand');
  // dealer had K under the ace: blackjack, insurance pays 2 to 1 (30 -> 90 back)
  ok(t.players.a.chips === 90, 'insurance paid: ' + t.players.a.chips);
}
// Double with too few chips: buy in then double.
{
  const t = rigged(['6H', '5C', '9S', '5D', '6C', '7H', 'KC', '3C', '4C', '2C']);
  t.setBet('a', { main: 60, sides: {}, ready: true, seat: 0 }); t.setBet('b', { main: 10, sides: {}, ready: true, seat: 1 });
  t.deal();
  ok(t.phase === 'playing' && !t.allowedActions('a').includes('double'), 'double not offered with 0 chips');
  const req = t.requestBuyIn('a', 60); t.answerBuyIn(req.id, true); t.action('a', 'double');
  ok(t.seats[0].hands[0].bet === 120 && t.seats[0].hands[0].cards.length === 3, 'doubled after buying in');
  ok(ledger(t, 'a').totalIn === 60, 'shown ledger unchanged mid hand');
}
console.log(bad ? `${bad} of ${n} buy in checks failed` : `${n}/${n} buy in checks passed`);
process.exit(bad ? 1 : 0);
