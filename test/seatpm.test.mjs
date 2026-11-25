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
{ // the dealer's seat limit: off by default; on, + stops at the limit and empty seats past it go
  const t = new G.Table({ seats: 7 }); for (const id of 'dab') t.join(id, id.toUpperCase(), 500);
  ok(t.settings.seatCap.on === false && t.settings.seatCap.max === 15, 'seat limit off by default, 15 when switched on');
  t.sit('a', 0); t.sit('b', 5); t.sitDealer('d');
  for (let i = 0; i < 10; i++) t.changeSeats('a', 1);
  ok(t.seats.length === 17, 'no limit by default: 17 seats');
  t.dealerSave('d', { seatCap: { on: true, max: 4 } });
  ok(t.settings.seatCap.on && t.settings.seatCap.max === 4, 'limit on at 4');
  ok(t.seats.length === 4 && t.seatsOf('a').length === 1 && t.seatsOf('b').length === 1, 'empty seats past the limit go, both players keep a seat: ' + t.seats.length);
  let threw = ''; try { t.changeSeats('a', 1); } catch (e) { threw = e.message; } ok(/at most 4/.test(threw), '+ refused at the limit');
  t.dealerSave('d', { seatCap: { on: false, max: 4 } }); ok(t.changeSeats('a', 1) === 5, 'limit off: + works again');
  threw = ''; try { t.dealerSave('d', { seatCap: { on: true, max: 0 } }); } catch (e) { threw = e.message; } ok(/between 1 and 99/.test(threw), 'bad limit refused');
  threw = ''; try { t.dealerSave('a', { seatCap: { on: true, max: 5 } }); } catch (e) { threw = e.message; } ok(/Only the dealer/.test(threw), 'only the dealer sets it');
}
console.log('seat + and −: ' + n + ' checks passed');
