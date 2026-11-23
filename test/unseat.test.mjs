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
{ // blackjack: the dealer unseats a player, after the hand when one is in play
  const t = new Table({}); for (const id of 'dab') t.join(id, id.toUpperCase(), 500);
  t.sitDealer ? null : null;
  t.sit('a', 0); t.sit('b', 1); t.setFrozen(true); t.hostId = 'd';
  let threw = false; try { t.dealerUnseat('a', 1); } catch { threw = true; } ok(threw, 'a player cannot unseat another');
  t.dealerUnseat('d', 1); ok(t.seats[1] === null && t.players.b.chips === 500 && t.unseated.dealer && t.unseated.ids[0] === 'b', 'between rounds: seat freed at once, chips kept');
  t.sit('b', 1);
  t.setBet('a', { main: 10, sides: {}, ready: true, seat: 0 }); t.setBet('b', { main: 10, sides: {}, ready: true, seat: 1 });
  t.deal();
  if (t.inRound()) {
    t.dealerUnseat('d', 1); ok(t.seats[1] && t.seats[1].hands.length === 1 && t.seats[1].leaving, 'mid hand: the hand plays on, seat marked');
    threw = false; try { t.leaveSeat('b', 1); } catch { threw = true; } ok(threw && t.seats[1].leaving, 'the player cannot cancel it');
    let g = 0; while (t.inRound() && g++ < 50) { if (t.phase === 'insurance') { for (const id of 'ab') try { t.insurance(id, false); } catch {} } else if (t.phase === 'playing') t.action(t.seats[t.turn.seat].playerId, 'stand'); else if (t.phase === 'dealer') t.dealerStep(); }
    ok(t.seats[1] && t.seats[1].hands.length >= 1, 'seat still there until the next betting opens');
    t.startBetting(); ok(t.seats[1] === null && t.unseated.dealer && t.unseated.ids.includes('b'), 'freed when the round is over');
  } else ok(true, 'round ended at once');
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
for (const [T, name, place, start, end] of [[BacTable, 'baccarat', (t, id) => t.bet(id, 'player', 10), (t) => t.deal(), (t) => { for (let i = 0; i < 30 && t.phase === 'peel'; i++) { if (t.need()) t.more(); else { for (const k of t.peelKeys()) t.peel.open[k] = true; t.peelAdvance(); } } }], [RouTable, 'roulette', (t, id) => t.bet(id, 'red', 10), (t) => t.closeBets(), (t) => t.doSpin()]]) {
  const t = new T(); t.join('h', 'Hal'); t.join('a', 'Ann'); t.join('b', 'Bob');
  let threw = false; try { t.dealerUnseat('a', 'b'); } catch { threw = true; } ok(threw, name + ': a player cannot unseat another');
  t.dealerUnseat('h', 'b'); ok(t.players.b.seat === -1 && t.unseated.dealer, name + ': host (house dealer) unseats between rounds');
  place(t, 'b'); ok(t.players.b.seat >= 0, name + ': a bet sits b down again');
  place(t, 'a'); start(t);
  if (t.phase !== 'done' && t.phase !== 'betting') {
    const before = t.staked('b');
    t.dealerUnseat('h', 'b'); ok(t.players.b.seat >= 0 && t.staked('b') === before, name + ': mid round the seat and the bet stay');
    end(t);
    ok(t.phase === 'done' && t.players.b.seat >= 0, name + ': round played out with b seated');
    t.next(); ok(t.players.b.seat === -1 && t.unseated.ids.includes('b'), name + ': b leaves once the round is over');
  } else ok(false, name + ': round did not stay in play: ' + t.phase);
}
console.log(bad ? `${bad} of ${n} unseat checks failed` : `${n}/${n} unseat checks passed`);
process.exit(bad ? 1 : 0);
