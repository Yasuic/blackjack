// A seated player with no bet when a round starts loses the seat (keeps the chips, can sit again). The dealer never does.
import { Table } from '../js/game.js';
import { BacTable } from '../js/baccarat.js';
import { RouTable } from '../js/roulette.js';
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
{ // blackjack
  const t = new Table({}); for (const id of 'abc') t.join(id, id.toUpperCase(), 500);
  t.sit('a', 0); t.sit('b', 1); t.sit('c', 2); t.sit('c', 3, true); t.setFrozen(true);
  t.setBet('a', { main: 10, sides: {}, ready: true, seat: 0 }); t.setBet('c', { main: 10, sides: {}, ready: true, seat: 2 });
  const chipsB = t.players.b.chips;
  t.deal();
  ok(t.seats[1] === null && t.players.b.seat === null, 'b had no bet: seat freed');
  ok(t.players.b.chips === chipsB, 'b keeps the chips');
  ok(t.seats[2] && t.seats[2].hands.length === 1 && t.seats[3] === null, 'c keeps the seat with a bet, the empty extra seat is freed');
  ok(t.publicState('b').unseated.ids.join() === 'b,c', 'public state names who lost a seat: ' + t.publicState('b').unseated.ids.join());
  ok(t.seats[0].hands.length === 1, 'a plays');
  let g = 0; while (t.inRound() && g++ < 50) { if (t.phase === 'insurance') { for (const id of 'ac') try { t.insurance(id, false); } catch {} } else if (t.phase === 'playing') t.action(t.seats[t.turn.seat].playerId, 'stand'); else if (t.phase === 'dealer') t.dealerStep(); }
  t.startBetting(); t.sit('b', 1);
  ok(t.seats[1]?.playerId === 'b', 'b can sit again');
}
{ // baccarat
  const t = new BacTable(); t.join('a', 'Ann'); t.join('b', 'Bob');
  const sb = t.players.b.seat, chipsB = t.players.b.chips;
  ok(sb >= 0, 'b seated on join');
  t.bet('a', 'player', 10); t.deal();
  ok(t.players.b.seat === -1 && t.players.b.chips === chipsB, 'b had no bet: watching, chips kept');
  ok(t.players.a.seat >= 0, 'a keeps the seat');
  ok(t.publicState('b').unseated.ids.join() === 'b', 'public state names b');
}
{ // roulette
  const t = new RouTable(); t.join('a', 'Ann'); t.join('b', 'Bob');
  t.bet('a', 'red', 10); t.pressSpin('a');
  ok(t.phase === 'betting', 'waits for b to press');
  t.pressSpin('b');
  ok(t.phase === 'done' && t.players.b.seat === -1, 'b pressed but had no bet: unseated at the spin');
  t.next(); t.bet('b', 'odd', 5);
  ok(t.players.b.seat >= 0, 'a bet sits b down again');
}
console.log(bad ? `${bad} of ${n} unseat checks failed` : `${n}/${n} unseat checks passed`);
process.exit(bad ? 1 : 0);
