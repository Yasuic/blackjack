// One wallet for the office: chips leave one table as cashed out and arrive at the next as a buy-in.
// The +/- of every player at every table must stay the same, and each table's ledger must still add up to zero.
import { Table } from '../js/game.js';
import { BacTable } from '../js/baccarat.js';
import { RouTable } from '../js/roulette.js';
import { PokerTable } from '../js/poker.js';
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
const throws = (f, m) => { try { f(); ok(false, m + ' (did not throw)'); } catch { ok(true, m); } };

// Blackjack
{
  const t = new Table({}); t.join('a', 'Ann', 1000); t.join('b', 'Bob', 500); t.sit('a', 0);
  const net = (id) => t.players[id].chips - t.players[id].totalIn;
  ok(t.carryIn('b', 800, 'Poker', 'c1') === 800 && t.players.b.chips === 800 && t.players.b.totalIn === 800, 'bj: a player who just joined gets exactly the carried chips');
  ok(t.carryIn('b', 800, 'Poker', 'c1') === 0 && t.players.b.chips === 800, 'bj: the same carry twice counts once');
  t.players.a.chips = 1300; // won 300
  const before = net('a');
  ok(t.cashOut('a') === 1300 && t.players.a.chips === 0 && net('a') === before, 'bj: cash out keeps +/- the same');
  delete t.players.b.joinT; t.carryIn('b', 100, 'Roulette', 'c2'); ok(t.players.b.chips === 900 && t.players.b.totalIn === 900, 'bj: carry to an older player adds');
  t.sitDealer?.('b');
  if (t.banker === 'b') throws(() => t.cashOut('b'), 'bj: the dealer cannot walk away with the bank');
  // frozen ledger: the real chips are the snapshot
  const f = new Table({}); f.join('x', 'Xi', 1000); f.setFrozen(true); f.players.x.chips = 1700;
  ok(f.cashOut('x') === 1000 && f.frozenSnap.x.chips === 0 && f.frozenSnap.x.totalIn === 0, 'bj frozen: the real chips leave, not the practice chips');
  f.setFrozen(false); ok(f.players.x.chips === 0 && f.players.x.totalIn === 0, 'bj frozen: after the practice the walked chips stay gone');
}
// Baccarat and roulette (shared bank rules)
for (const [name, T] of [['baccarat', BacTable], ['roulette', RouTable]]) {
  const t = new T({}); t.join('a', 'Ann'); t.join('b', 'Bob'); t.join('d', 'Dee');
  const st = t.settings.startChips;
  ok(t.carryIn('b', 777, 'Blackjack', 'k1') === 777 && t.players.b.chips === 777 && t.players.b.totalIn === 777, name + ': fresh player gets the carried chips');
  ok(t.base.b.chips === 777, name + ': frozen base follows');
  t.setBank('d');
  const net0 = t.ledgerSum();
  t.players.a.chips += 50; t.players.d.chips -= 50; // a won 50 from the dealer
  ok(t.ledgerSum() === net0, name + ': ledger zero before walking');
  const netA = t.players.a.chips - t.players.a.totalIn;
  ok(t.cashOut('a') === st + 50 && t.players.a.chips - t.players.a.totalIn === netA && t.ledgerSum() === 0, name + ': cash out keeps +/- and a zero ledger');
  throws(() => t.cashOut('d'), name + ': the dealer cannot walk away with the bank');
}
// Poker
{
  const t = new PokerTable({}); t.join('a', 'Ann'); t.join('b', 'Bob');
  t.carryIn('b', 640, 'Blackjack', 'p1');
  let r = t.publicState('b').ledger.find((x) => x.id === 'b');
  ok(r.stack === 640 && r.net === 0, 'poker: carried chips wait in the pocket, +/- zero');
  t.sit('b', 1, 300); ok(t.seats[1].stack === 640 && t.players.b.totalIn === 640 && !t.players.b.pocket, 'poker: sitting uses the pocket');
  t.sit('a', 0, 500); t.seats[0].stack = 700; t.seats[1].stack = 440; // a won 200
  const sum = () => t.publicState('a').ledger.reduce((s, x) => s + x.net, 0);
  ok(sum() === 0, 'poker: ledger zero');
  ok(t.cashOut('a') === 700 && sum() === 0 && t.publicState('a').ledger.find((x) => x.id === 'a').net === 200, 'poker: cash out keeps +200 and a zero ledger');
  t.carryIn('b', 60, 'Roulette', 'p2'); ok(t.seats[1].stack === 500 && sum() === 0, 'poker: carry onto a seat adds to the stack');
}
console.log(`${n - bad}/${n} wallet checks passed`);
if (bad) process.exit(1);
