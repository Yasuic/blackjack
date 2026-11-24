// Inside the office a player can sit at several tables: at a table out of sight (elsewhere) the seat stays theirs
// when a round starts without their bet. Back at the table, the usual rule applies again.
import { Table } from '../js/game.js';
import { BacTable } from '../js/baccarat.js';
import { RouTable } from '../js/roulette.js';
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
{ // blackjack
  const t = new Table({}); for (const id of 'ab') t.join(id, id.toUpperCase(), 500);
  t.sit('a', 0); t.sit('b', 1); t.setFrozen(true);
  ok(t.setElsewhere('b', true) === true && t.setElsewhere('b', true) === false, 'setElsewhere reports a change once');
  for (let r = 0; r < 3; r++) {
    t.setBet('a', { main: 10, sides: {}, ready: true, seat: 0 });
    t.deal();
    ok(t.seats[1]?.playerId === 'b' && t.seats[1].hands.length === 0, `round ${r + 1}: b elsewhere keeps the seat and sits the round out`);
    let g = 0; while (t.inRound() && g++ < 50) { if (t.phase === 'insurance') { try { t.insurance('a', false); } catch {} } else if (t.phase === 'playing') t.action(t.seats[t.turn.seat].playerId, 'stand'); else if (t.phase === 'dealer') t.dealerStep(); }
    ok(t.players.b.chips === 500, 'b chips untouched');
    t.startBetting();
  }
  t.setElsewhere('b', false);
  t.setBet('a', { main: 10, sides: {}, ready: true, seat: 0 }); t.deal();
  ok(t.seats[1] === null, 'b back at the table with no bet: seat freed as usual');
}
{ // baccarat
  const t = new BacTable(); t.join('a', 'Ann'); t.join('b', 'Bob');
  t.setElsewhere('b', true);
  t.bet('a', 'player', 10); t.deal();
  ok(t.players.b.seat >= 0, 'baccarat: b elsewhere keeps the seat');
}
{ // roulette: b elsewhere keeps the seat and is not waited for on Spin
  const t = new RouTable(); t.join('a', 'Ann'); t.join('b', 'Bob');
  t.setElsewhere('b', true);
  ok(!t.voters().includes('b'), 'roulette: b elsewhere is not asked to press Spin');
  t.bet('a', 'red', 10); t.pressSpin('a');
  ok(t.phase !== 'betting', 'roulette: Spin goes with only a pressing: ' + t.phase);
  ok(t.players.b.seat >= 0, 'roulette: b keeps the seat');
}
console.log(`${n - bad}/${n} elsewhere checks passed`);
if (bad) process.exit(1);
