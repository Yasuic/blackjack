import assert from 'node:assert/strict';
import * as G from '../js/game.js';
const c = (s) => ({ r: s.slice(0, -1), s: s.slice(-1) });
const cs = (str) => str.split(' ').map(c);
// side bets
assert.equal(G.evalPerfectPairs(cs('8♠ 8♠')).mult, 25);
assert.equal(G.evalPerfectPairs(cs('8♥ 8♦')).mult, 12);
assert.equal(G.evalPerfectPairs(cs('8♥ 8♠')).mult, 6);
assert.equal(G.evalPerfectPairs(cs('8♥ 9♠')).win, false);
assert.equal(G.eval21p3(cs('7♠ 7♠'), c('7♠')).mult, 100);
assert.equal(G.eval21p3(cs('5♠ 6♠'), c('7♠')).mult, 40);
assert.equal(G.eval21p3(cs('Q♠ K♥'), c('A♠')).mult, 10);
assert.equal(G.eval21p3(cs('2♠ 9♠'), c('K♠')).mult, 5);
assert.equal(G.eval21p3(cs('2♠ 9♥'), c('K♠')).win, false);
assert.equal(G.evalLuckyLadies(cs('Q♥ Q♥'), true).mult, 1000);
assert.equal(G.evalLuckyLadies(cs('Q♥ Q♥'), false).mult, 200);
assert.equal(G.evalLuckyLadies(cs('K♣ 10♣'), false).mult, 10);
assert.equal(G.evalLuckyLadies(cs('A♣ 9♦'), false).mult, 4);
assert.equal(G.evalRoyalMatch(cs('K♦ Q♦')).mult, 25);
assert.equal(G.evalRoyalMatch(cs('2♦ 9♦')).mult, 2.5);
assert.equal(G.evalLuckyLucky(cs('6♦ 7♦'), c('8♦')).mult, 100);
assert.equal(G.evalLuckyLucky(cs('A♦ K♣'), c('Q♦')).mult, 3);
assert.equal(G.evalOverUnder(cs('A♦ K♣'), false).win, true);
assert.equal(G.evalOverUnder(cs('3♦ K♣'), true).win, false);
assert.equal(G.evalBustIt(cs('10♦ 6♣ 9♠')).mult, 1);
assert.equal(G.evalBustIt(cs('2♦ 3♣ 4♠ 2♠ 5♠ K♠')).mult, 50);
// full rounds random fuzz: chips conservation
for (const decks of [1, 6, 'csm']) {
  const t = new G.Table({ decks, shuffleMode: 'rounds', shuffleEvery: 3 });
  const ids = ['a', 'b', 'c', 'd', 'e'];
  ids.forEach((id, i) => { t.join(id, id); t.sit(id, i); });
  t.join('bank', 'Bank'); t.sitDealer('bank');
  for (let r = 0; r < 400; r++) {
    for (const id of ids) {
      const p = t.players[id];
      if (p.chips < 50) t.giveChips(id, 1000);
      const sides = {};
      for (const k of G.SIDE_KEYS) if (Math.random() < 0.3) sides[k] = 5;
      t.setBet(id, { main: 10, sides, ready: true });
    }
    const before = ids.reduce((s, id) => s + t.players[id].chips, 0);
    const bankBefore = t.players.bank.chips;
    t.deal();
    if (t.phase === 'insurance') ids.forEach((id) => { try { t.insurance(id, Math.random() < 0.5); } catch {} });
    let guard = 0;
    while (t.phase === 'playing' && guard++ < 200) {
      const id = t.seats[t.turn.seat].playerId;
      const acts = t.allowedActions(id);
      t.action(id, acts[Math.floor(Math.random() * acts.length)]);
    }
    while (t.dealerStep()) {}
    assert.equal(t.phase, 'settled');
    const after = ids.reduce((s, id) => s + t.players[id].chips, 0);
    const net = t.seats.reduce((s, x) => s + x.net, 0);
    assert.equal(after - before, net, 'net matches chip change');
    assert.equal(t.players.bank.chips - bankBefore + net, 0, 'dealer seat pays and collects');
    ids.forEach((id) => assert.ok(t.players[id].chips >= 0));
    t.startBetting();
  }
  // JSON round trip
  const t2 = G.Table.fromJSON(JSON.parse(JSON.stringify(t)));
  assert.equal(t2.shoe.length, t.shoe.length);
}
// hidden hole card
const t = new G.Table(); t.join('x', 'X'); t.sit('x', 0); t.setBet('x', { main: 10, sides: {} }); t.deal();
const ps = t.publicState('x');
if (t.phase === 'playing') assert.ok(ps.dealer.cards[1].hidden);
console.log('all game tests passed');

// dealer seat rules
{
  const t = new G.Table(); t.join('a', 'A'); t.join('b', 'B'); t.sit('a', 0); t.sitDealer('a');
  assert.equal(t.players.a.seat, null);
  assert.throws(() => t.sitDealer('b'));
  assert.throws(() => t.sit('a', 1));
  t.leaveDealer('a'); assert.equal(t.banker, null);
}
console.log('dealer seat tests passed');

{
  const t = new G.Table(); ['a','b','c'].forEach((x) => t.join(x, x));
  const id = t.requestDealer('a'); t.castVote('b', true); assert.equal(t.banker, null);
  t.castVote('c', true); assert.equal(t.banker, 'a');
  t.requestDealer('b'); t.castVote('a', false); assert.equal(t.banker, 'a'); assert.equal(t.vote, null);
  const v = t.requestDealer('c'); t.expireVote(v); assert.equal(t.vote, null); assert.equal(t.banker, 'a');
}
console.log('vote tests passed');
