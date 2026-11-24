// Seats: anyone adds a seat or takes an empty one away (+ and − on the table), a seat empty for 2 rounds goes by
// itself, and the dealer frees the seats of players who are not here (a hand in play finishes first).
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const round = (t) => {
  for (const id of ['a', 'b']) for (const s of t.seatsOf(id)) t.setBet(id, { seat: s, main: 10, sides: {}, ready: true });
  t.deal();
  let g = 0; while (t.phase === 'insurance' && g++ < 9) for (const id of ['a', 'b']) for (const s of t.seatsOf(id)) { try { t.insurance(id, false, s); } catch {} }
  g = 0; while (t.phase === 'playing' && g++ < 40) t.action(t.seats[t.turn.seat].playerId, 'stand');
  while (t.dealerStep()) {}
  t.startBetting();
};
{
  const t = new G.Table({ seats: 7, charlieEvery: 0 });
  t.join('a', 'Ann'); t.join('b', 'Bob'); t.join('d', 'Dee'); t.sitDealer('d');
  t.sit('a', 0); t.sit('b', 4);
  ok(t.changeSeats('a', 1) === 8 && t.settings.seats === 8, '+ adds a seat');
  ok(t.changeSeats('b', -1) === 7 && t.seats[0]?.playerId === 'a' && t.seats[4]?.playerId === 'b', '− takes the last empty seat, nobody moves');
  assert.throws(() => t.changeSeats('x', 1)); n++;
  t.startBetting(); // round 0 counted once
  round(t); // empty seats: 1st round
  ok(t.seats.length === 7, 'still 7 after one empty round');
  round(t);
  ok(t.seats.length === 7 || t.seats.length === 2, 'two rounds');
  ok(t.seats.length === 2 && t.seatsOf('a').length === 1 && t.seatsOf('b').length === 1, 'empty seats gone after 2 rounds: ' + t.seats.length);
  ok(t.seats.every(Boolean), 'only the seats people sit in are left');
  assert.throws(() => t.changeSeats('a', -1), /taken/); n++;
  t.changeSeats('a', 1); ok(t.seats.length === 3, 'a seat can be added back');
  // Bob drops out: the dealer frees his seat
  t.disconnect('b');
  ok(t.dealerUnseatMissing('d') === 1 && t.seatsOf('b').length === 0 && t.seatsOf('a').length === 1, 'dealer frees the missing player\'s seat');
  assert.throws(() => t.dealerUnseatMissing('a')); n++;
}
{
  // mid hand: the missing player's hand plays out first
  const t = new G.Table({ seats: 3, charlieEvery: 0 });
  t.join('a', 'Ann'); t.join('b', 'Bob'); t.join('d', 'Dee'); t.sitDealer('d');
  t.sit('a', 0); t.sit('b', 1);
  for (const id of ['a', 'b']) t.setBet(id, { seat: t.seatsOf(id)[0], main: 10, sides: {}, ready: true });
  t.deal();
  t.disconnect('b');
  t.dealerUnseatMissing('d');
  ok(t.seats[1]?.playerId === 'b' && t.seats[1].leaving, 'mid hand: seat kept until the hand ends');
  ok(t.changeSeats('a', -1) === 2, 'mid hand: the last seat, empty, may go');
}
console.log('seat + and −: ' + n + ' checks passed');
