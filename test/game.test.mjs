import assert from 'node:assert/strict';
import * as G from '../js/game.js';
// A new table's defaults (the person set these on 2026-11-22): shuffle at 65% used, every side bet offered, max bet 75, max side bet 10.
{ const d = new G.Table({}).settings;
  if (d.penetration !== 65 || d.maxBet !== 75 || d.maxSideBet !== 10 || d.sideBets.length !== G.SIDE_KEYS.filter((k) => k !== 'friendBust').length) throw new Error('new table defaults are wrong: ' + JSON.stringify([d.penetration, d.maxBet, d.maxSideBet, d.sideBets])); }
// The tests below were written for wider limits and three side bets, so they set those themselves.
Object.assign(G.DEFAULT_SETTINGS, { penetration: 85, maxBet: 1000, maxSideBet: 100, sideBets: ['hot3', 'bustIt', 'twentyOnePlus3'] });
G.DEFAULT_SETTINGS.sideBets = G.SIDE_KEYS; // tests cover every side bet
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
  const t = Object.assign(new G.Table({ decks, seats: 5, shuffleMode: 'rounds', shuffleEvery: 3 }), { frozen: true });
  const ids = ['a', 'b', 'c', 'd', 'e'];
  ids.forEach((id, i) => { t.join(id, id); t.sit(id, i); });
  t.join('bank', 'Bank'); t.sitDealer('bank');
  for (let r = 0; r < 400; r++) {
    for (const id of ids) {
      const p = t.players[id];
      if (p.chips < 50) t.giveChips(id, 1000);
      const sides = {};
      for (const k of G.SIDE_KEYS) if (Math.random() < 0.3) sides[k] = 5;
      t.setBet(id, { main: 10, sides, target: (ids.indexOf(id) + 1) % ids.length, ready: true });
    }
    if (t.players.bank.chips < 2000) t.giveChips('bank', 5000); // the dealer must be able to cover the table
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
const t = Object.assign(new G.Table(), { frozen: true }); t.join('x', 'X'); t.sit('x', 0); t.setBet('x', { main: 10, sides: {} }); t.deal();
const ps = t.publicState('x');
if (t.phase === 'playing') assert.ok(ps.dealer.cards[1].hidden);
console.log('all game tests passed');

// dealer seat rules
{
  const t = Object.assign(new G.Table(), { frozen: true }); t.join('a', 'A'); t.join('b', 'B'); t.sit('a', 0); t.sitDealer('a');
  assert.equal(t.players.a.seat, null);
  assert.throws(() => t.sitDealer('b'));
  assert.throws(() => t.sit('a', 1));
  t.leaveDealer('a'); assert.equal(t.banker, null);
}
console.log('dealer seat tests passed');

{
  const t = Object.assign(new G.Table(), { frozen: true }); ['a','b','c'].forEach((x) => t.join(x, x));
  const id = t.requestDealer('a'); t.castVote('b', true); assert.equal(t.banker, null);
  t.castVote('c', true); assert.equal(t.banker, 'a');
  t.requestDealer('b'); t.castVote('a', false); assert.equal(t.banker, 'a'); assert.equal(t.vote, null);
  const v = t.requestDealer('c'); t.expireVote(v); assert.equal(t.vote, null); assert.equal(t.banker, 'a');
}
console.log('vote tests passed');
import { bestMove } from '../js/strategy.js';
{
  const all = ['hit', 'stand', 'double', 'split', 'surrender'];
  assert.equal(bestMove(cs('K♠ 9♦'), c('10♣'), all), 'stand');
  assert.equal(bestMove(cs('6♠ 5♦'), c('6♣'), all), 'double');
  assert.equal(bestMove(cs('8♠ 8♦'), c('10♣'), all), 'split');
  assert.equal(bestMove(cs('10♠ 6♦'), c('10♣'), all), 'surrender');
  assert.equal(bestMove(cs('10♠ 6♦'), c('10♣'), ['hit', 'stand']), 'hit');
  assert.equal(bestMove(cs('A♠ 7♦'), c('9♣'), all), 'hit');
  assert.equal(bestMove(cs('A♠ 7♦ 2♣ 3♠'.split(' ').slice(0,2).join(' ')), c('4♣'), ['hit', 'stand']), 'stand');
  assert.equal(bestMove(cs('10♠ 2♦'), c('3♣'), all), 'hit');
  assert.equal(bestMove(cs('10♠ 2♦'), c('4♣'), all), 'stand');
  assert.equal(bestMove(cs('10♠ 10♦'), c('6♣'), all), 'stand');
  console.log('strategy tests passed');
}
{
  const t = Object.assign(new G.Table(), { frozen: true }); t.join('a', 'A'); t.join('h', 'H');
  const r = t.requestBuyIn('a', 500); assert.throws(() => t.requestBuyIn('a', 100));
  t.answerBuyIn(r.id, true); assert.equal(t.players.a.chips, 1500); assert.equal(t.players.a.totalIn, 1500);
  const r2 = t.requestBuyIn('a', 300); t.answerBuyIn(r2.id, false); assert.equal(t.players.a.chips, 1500);
  t.giveChips('a', -200); assert.equal(t.players.a.totalIn, 1300);
  console.log('buy-in tests passed');
}

{
  const t = Object.assign(new G.Table(), { frozen: true }); t.join('h', 'H'); t.join('a', 'A'); t.join('b', 'B');
  t.proposeSettings('h', { decks: 1 }, 'x'); t.castVote('a', true); assert.equal(t.settings.decks, 8);
  t.castVote('b', true); assert.equal(t.settings.decks, 1);
  t.proposeSettings('h', { decks: 8 }, 'x'); t.castVote('a', false); assert.equal(t.settings.decks, 1);
  // count matches cards drawn
  const t2 = Object.assign(new G.Table({ decks: 1 }), { frozen: true }); let rc = 0; for (let i = 0; i < 20; i++) rc += G.hiLo(t2.draw()); assert.equal(t2.runCount, rc);
  console.log('settings vote and count tests passed');
}
{
  const t = new G.Table(); t.join('a', 'A'); t.sit('a', 0); t.setBet('a', { main: 50, sides: {} });
  assert.equal(t.canDeal(), false);
  assert.throws(() => t.deal());
  t.frozen = true;
  for (let i = 0; i < 30; i++) {
    t.setBet('a', { main: 50, sides: { pp: 5, plus3: 5 } }); t.deal();
    let g = 0; while (t.phase !== 'settled' && g++ < 50) { if (t.phase === 'insurance') t.forceInsurance ? t.forceInsurance() : t.insurance('a', false); else if (t.phase === 'playing') t.action('a', 'stand'); else if (t.phase === 'dealer') t.dealerStep(); }
    assert.equal(t.players.a.chips - (t.players.a.houseNet || 0), 1000);
  }
  console.log('frozen balance tests passed');
}
{
  // Hot 3 and Friend Bust
  assert.equal(G.evalHot3(cs('7♠ 7♠'), c('7♠')).mult, 100);
  assert.equal(G.evalHot3(cs('K♠ 5♠'), c('6♠')).mult, 20);
  assert.equal(G.evalHot3(cs('K♠ 5♥'), c('6♠')).mult, 4);
  assert.equal(G.evalHot3(cs('K♠ 5♥'), c('5♠')).mult, 2);
  assert.equal(G.evalHot3(cs('K♠ 5♥'), c('3♠')).win, false);
  const t = Object.assign(new G.Table(), { frozen: false });
  t.join('a', 'A', 500); t.join('b', 'B', 700); t.join('d', 'D', 5000);
  assert.equal(t.players.a.chips, 500);
  t.sit('a', 0); t.sit('b', 1); t.sitDealer('d');
  // The bet between players is gone: it is ignored if a browser still sends it.
  t.setBet('a', { main: 10, sides: { friendBust: 10 }, target: 1 });
  assert.equal(t.seats[0].bet.sides.friendBust, undefined);
  assert.ok(!G.SIDE_KEYS.includes('friendBust') && !t.settings.sideBets.includes('friendBust'));
  t.setBet('b', { main: 10, sides: {} });
  const total = () => Object.values(t.players).reduce((x, p) => x + p.chips, 0);
  const before = total();
  t.deal();
  let g = 0; while (t.phase !== 'settled' && g++ < 80) { if (t.phase === 'insurance') { t.insurance('a', false); t.insurance('b', false); } else if (t.phase === 'playing') { const id = t.seats[t.turn.seat].playerId; t.action(id, id === 'b' ? 'hit' : 'stand'); } else if (t.phase === 'dealer') t.dealerStep(); }
  assert.equal(total(), before);
  assert.ok(!t.seats[0].sideResults.some((r) => r.key === 'friendBust'));
  // Peek costs 10 and goes to the dealer.
const da = t.players.a.chips, dd = t.players.d.chips;
  // Right after a round: one look, shown card leaves the shoe, 10 goes to the dealer.
  assert.equal(t.phase, 'settled');
  assert.equal(t.publicState('a').canPeek, true);
  const left = t.shoe.length;
  const top = t.peek('a');
  assert.ok(top && top.r);
  assert.equal(t.shoe.length, left - 1);
  assert.throws(() => t.peek('a'), 'one look per round');
  assert.equal(t.players.a.chips, da - 10); assert.equal(t.players.d.chips, dd + 10);
  assert.equal(t.publicState('a').canPeek, false);
  console.log('hot 3, friend bust and peek tests passed');
}
{
  // Fair shuffle: known hash, same seeds give the same shoe, and a finished shoe can be redone from its seeds.
  assert.equal(G.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(G.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(G.sha256('a'.repeat(200)).length, 64);
  const a = G.fairShoe(6, 'seed', { x: '1' }), b = G.fairShoe(6, 'seed', { x: '1' }), c2 = G.fairShoe(6, 'seed', { x: '2' });
  assert.deepEqual(a, b); assert.notDeepEqual(a, c2); assert.equal(a.length, 312);
  const t = new G.Table({ decks: 1 }); t.join('a', 'A');
  const promised = t.publicState('a').fair.nextCommit;
  t.setClientSeed('a', 'myseed');
  t.newShoe();
  const cur = t.publicState('a').fair.current;
  assert.equal(cur.commit, promised); assert.equal(cur.clientSeeds.a, 'myseed'); assert.equal(cur.serverSeed, undefined);
  const order = t.shoe.slice();
  t.newShoe();
  const last = t.publicState('a').fair.last;
  assert.equal(G.sha256(last.serverSeed), promised);
  assert.deepEqual(G.fairShoe(last.decks, last.serverSeed, last.clientSeeds), order);
  // Card k is picked with key k, and the whole shoe can be dealt again afterward from the seed and the keys.
  const t3 = Object.assign(new G.Table({ decks: 1 }), { frozen: true }); t3.join('a', 'A'); t3.sit('a', 0);
  const seen = [];
  let kc = 0; const give = (n) => { t3.keys = Array.from({ length: n }, () => 'key' + ++kc); };
  for (let r = 0; r < 3; r++) {
    t3.setBet('a', { main: 10, sides: {} }); assert.equal(t3.dealCount(), 4); give(4); t3.deal();
    let g = 0; while (t3.phase !== 'settled' && g++ < 50) { if (t3.phase === 'insurance') t3.insurance('a', false); else if (t3.phase === 'playing') t3.action('a', 'stand'); else if (t3.phase === 'dealer') { give(1); t3.dealerStep(); } }
    seen.push(...t3.seats[0].hands[0].cards, ...t3.dealer.cards);
    t3.startBetting();
  }
  const rec = t3.fair.current;
  const again = G.replayShoe(rec);
  assert.equal(again.length, seen.length);
  const keyOf = (x) => x.map((c) => c.r + c.s).sort().join(' ');
  assert.equal(keyOf(again), keyOf(seen));
  console.log('fair shuffle tests passed');
}
{
  // Seat count is a table setting. Seven by default.
  assert.equal(G.DEFAULT_SETTINGS.seats, 7);
  const t = Object.assign(new G.Table(), { frozen: true });
  assert.equal(t.seats.length, 7);
  assert.equal(t.publicState('nobody').seats.length, 7);
  assert.equal(new G.Table({ seats: 3 }).seats.length, 3);
  assert.equal(new G.Table({ seats: 40 }).seats.length, 40);
  t.join('h', 'H'); t.join('a', 'A'); t.join('b', 'B');
  t.sit('a', 6);
  assert.throws(() => t.sit('b', 7), /No such seat/);
  // Growing adds empty seats at the end and keeps everyone where they are.
  t.updateSettings({ seats: 10 });
  assert.equal(t.settings.seats, 10); assert.equal(t.seats.length, 10);
  assert.equal(t.seats[6].playerId, 'a'); assert.deepEqual(t.seats.slice(7), [null, null, null]);
  t.sit('b', 9);
  // Shrinking over taken seats is refused and nothing changes.
  assert.throws(() => t.updateSettings({ seats: 5 }), /Seats 7 and 10 are still taken/);
  assert.throws(() => t.updateSettings({ seats: 8, decks: 1 }), /Seat 10 is still taken/);
  assert.equal(t.settings.seats, 10); assert.equal(t.seats.length, 10); assert.equal(t.settings.decks, 8);
  assert.throws(() => t.proposeSettings('h', { seats: 5 }, 'x'), /still taken/);
  assert.equal(t.vote ?? null, null);
  // Shrinking is fine once the seats being removed are empty.
  t.standUp('b'); t.standUp('a'); t.sit('b', 0); t.sit('a', 1);
  t.updateSettings({ seats: 2 });
  assert.equal(t.settings.seats, 2); assert.equal(t.seats.length, 2);
  assert.equal(t.players.a.seat, 1); assert.equal(t.players.b.seat, 0);
  // Goes through the vote like every other setting.
  t.proposeSettings('h', { seats: 9 }, 'x'); t.castVote('a', true); assert.equal(t.seats.length, 2);
  t.castVote('b', true); assert.equal(t.seats.length, 9);
  // Someone sits in a seat that is going away while the vote runs: the change is dropped, not half applied.
  t.proposeSettings('h', { seats: 4 }, 'x'); t.sit('a', 8); t.castVote('a', true); t.castVote('b', true);
  assert.equal(t.seats.length, 9); assert.equal(t.settings.seats, 9); assert.equal(t.vote, null);
  // Other settings leave the seats alone, and odd values fall back to what the table has.
  t.updateSettings({ decks: 2 }); assert.equal(t.seats.length, 9);
  t.updateSettings({ seats: 'lots' }); assert.equal(t.seats.length, 9);
  t.updateSettings({ seats: 0 }); assert.equal(t.seats.length, 9);
  // A seat count agreed mid round applies when the round ends.
  t.sit('a', 1); t.setBet('a', { main: 10, sides: {} }); t.deal();
  if (t.inRound()) {
    t.applySettings({ seats: 6 }); assert.equal(t.seats.length, 9);
    let g = 0; while (t.phase !== 'settled' && g++ < 80) { if (t.phase === 'insurance') t.insurance('a', false); else if (t.phase === 'playing') t.action('a', 'stand'); else t.dealerStep(); }
    assert.equal(t.seats.length, 6);
  }
  // Save and restore keeps the seat count, and tables saved with five seats still load with five.
  const big = G.Table.fromJSON(JSON.parse(JSON.stringify(new G.Table({ seats: 12 }))));
  assert.equal(big.seats.length, 12); assert.equal(big.settings.seats, 12);
  const old = JSON.parse(JSON.stringify(new G.Table({ seats: 5 })));
  delete old.settings.seats;
  const t5 = G.Table.fromJSON(old);
  assert.equal(t5.seats.length, 5); assert.equal(t5.settings.seats, 5);
  t5.join('z', 'Z'); t5.sit('z', 4); assert.throws(() => t5.sit('z', 5));
  t5.updateSettings({ seats: 7 }); assert.equal(t5.seats.length, 7);
  console.log('seat count tests passed');
}
{
  // A player dealer with too few chips buys in automatically, in steps of the starting chips, with no request to the host.
  const t = new G.Table(); t.join('a', 'A', 1000); t.join('d', 'D', 20); t.sit('a', 0); t.sitDealer('d');
  t.setBet('a', { main: 500, sides: {} });
  assert.equal(t.bankShort(), false); assert.equal(t.canDeal(), true);
  assert.equal(t.players.d.chips, 20 + t.settings.startChips); assert.equal(t.players.d.boughtIn, t.settings.startChips);
  assert.equal(t.players.d.totalIn, 20 + t.settings.startChips); assert.equal((t.buyIns || []).length, 0);
  { // a dealer who loses more than they hold is topped up at the end of the round, and never owes
    const u = new G.Table(); u.join('a', 'A', 5000); u.join('d', 'D', 100); u.sit('a', 0); u.sitDealer('d');
    for (let r = 0; r < 30; r++) {
      if (u.phase === 'settled') u.startBetting();
      u.setBet('a', { main: 100, sides: {} }); u.deal();
      for (let i = 0; i < 40 && u.phase !== 'settled'; i++) { if (u.phase === 'insurance') { u.insurance('a', false); continue; } if (u.phase === 'playing') { u.action('a', 'stand'); continue; } if (u.dealerStep) u.dealerStep(); else break; }
      assert.ok(u.players.d.chips >= 0, 'dealer never owes');
    }
    assert.equal(u.players.a.chips + u.players.d.chips, 5000 + 100 + (u.players.d.boughtIn || 0));
  }
  t.setBet('a', { main: 20, sides: {} });
  assert.equal(t.canDeal(), true);
  // The next card can only be shown between rounds. (A hand that settles at once, on a blackjack,
  // is already between rounds, so deal again until a hand is being played.)
  for (let i = 0; i < 50 && (t.phase === 'betting' || t.phase === 'settled'); i++) {
    if (t.phase === 'settled') t.startBetting();
    t.players.d.chips = 1000; // keep the bank able to cover the bet
    t.setBet('a', { main: 20, sides: {} });
    t.deal();
  }
  assert.ok(!(t.phase === 'betting' || t.phase === 'settled'), 'a hand is being played');
  assert.throws(() => t.peek('a'));
  // Once the round is over it is allowed, and the first bet of the next round ends it.
  let g2 = 0; while (t.phase !== 'settled' && g2++ < 80) { if (t.phase === 'insurance') t.insurance('a', false); else if (t.phase === 'playing') t.action(t.seats[t.turn.seat].playerId, 'stand'); else if (t.phase === 'dealer') t.dealerStep(); }
  assert.equal(t.publicState('a').canPeek, true);
  t.players.d.chips = 1000;
  t.setBet('a', { main: 20, sides: {} });
  assert.equal(t.publicState('a').canPeek, false);
  assert.throws(() => t.peek('a'));
  console.log('dealer bank limit tests passed');
}
{
  // Rebet: the last played bet is offered again, cut down to what fits now. It is never placed on its own.
  const t = Object.assign(new G.Table({ maxSideBet: 100 }), { frozen: true });
  t.join('a', 'A', 1000); t.join('b', 'B', 1000); t.sit('a', 0); t.sit('b', 2);
  assert.equal(t.rebetFor('a'), null);
  assert.equal(t.publicState('a').rebet, null);
  t.setBet('a', { main: 50, sides: { hot3: 10, bustIt: 5 }, seq: 7 });
  assert.equal(t.seats[0].betSeq, 7);
  assert.equal(t.publicState('a').seats[0].betSeq, 7);
  assert.throws(() => t.setBet('a', { main: 5000, sides: {}, seq: 8 }));
  assert.equal(t.seats[0].betSeq, 7); // a refused bet keeps the old number
  t.setBet('b', { main: 25, sides: {} });
  t.deal();
  let g = 0;
  while (t.phase !== 'settled' && g++ < 200) { if (t.phase === 'insurance') t.forceInsurance(); else if (t.phase === 'playing') t.skipTurn(); else t.dealerStep(); }
  t.startBetting();
  assert.deepEqual(t.seats[0].bet, { main: 0, sides: {} }); // nothing is bet again by itself
  t.players.a.chips = 1000;
  assert.deepEqual(t.rebetFor('a'), { main: 50, sides: { hot3: 10, bustIt: 5 } });
  assert.deepEqual(t.publicState('a').rebet, t.rebetFor('a'));
  assert.equal(t.publicState('b').rebet.main, 25);
  // A side bet the table no longer offers is dropped, and limits apply.
  t.updateSettings({ sideBets: ['hot3'], maxSideBet: 4, maxBet: 40 });
  assert.deepEqual(t.rebetFor('a'), { main: 40, sides: { hot3: 4 } });
  // Never more than the chips the player has: the main bet first, then side bets.
  t.players.a.chips = 42;
  assert.deepEqual(t.rebetFor('a'), { main: 40, sides: { hot3: 2 } });
  t.players.a.chips = 30;
  assert.deepEqual(t.rebetFor('a'), { main: 30, sides: {} });
  t.players.a.chips = 0;
  assert.equal(t.rebetFor('a'), null);
  // The offered bet is always one the table accepts.
  t.players.a.chips = 42;
  t.setBet('a', { ...t.rebetFor('a'), ready: true });
  assert.equal(t.seats[0].bet.main, 40);
  t.standUp('a');
  assert.equal(t.rebetFor('a'), null);
  console.log('rebet tests passed');
}
{
  // A player who drops out has a short while to come back before their hand is stood.
  const mk = () => {
    const t = Object.assign(new G.Table(), { frozen: true });
    t.join('a', 'A', 1000); t.join('b', 'B', 1000); t.sit('a', 0); t.sit('b', 1);
    t.setBet('a', { main: 10, sides: {} }); t.setBet('b', { main: 10, sides: {} });
    return t;
  };
  // Cards in the order they are dealt: seat 0, seat 1, dealer, seat 0, seat 1, dealer.
  const deal = (t, str) => {
    t.deal();
    const [a1, b1, d1, a2, b2, d2] = cs(str);
    t.seats[0].hands[0].cards = [a1, a2]; t.seats[1].hands[0].cards = [b1, b2]; t.dealer.cards = [d1, d2];
    t.seats.forEach((s) => s && s.hands.forEach((h) => (h.done = false)));
    t.phase = d1.r === 'A' ? 'insurance' : 'playing';
    t.seats.forEach((s) => { if (s) s.insuranceDecided = false; });
    t.turn = t.phase === 'playing' ? { seat: 0, hand: 0 } : null;
  };
  let t = mk(); deal(t, '5♠ 6♠ 9♦ 7♥ 8♥ 7♣');
  assert.equal(t.phase, 'playing'); assert.deepEqual(t.turn, { seat: 0, hand: 0 });
  t.disconnect('a');
  assert.equal(t.publicState('b').seats[0].connected, false);
  assert.deepEqual(t.turn, { seat: 0, hand: 0 }); // still their turn
  // They come back in time and play on.
  t.join('a', 'A');
  assert.equal(t.players.a.gone, false);
  assert.equal(t.markGone('a'), false);
  t.action('a', 'stand'); assert.deepEqual(t.turn, { seat: 1, hand: 0 });
  // They stay away: their hand is stood and the next player is up.
  t = mk(); deal(t, '5♠ 6♠ 9♦ 7♥ 8♥ 7♣');
  t.disconnect('a');
  assert.equal(t.markGone('a'), true);
  assert.equal(t.seats[0].hands[0].done, true); assert.deepEqual(t.turn, { seat: 1, hand: 0 });
  // Dropping out before their turn: the turn waits for them until they count as gone.
  t = mk(); deal(t, '5♠ 6♠ 9♦ 7♥ 8♥ 7♣');
  t.disconnect('b');
  t.action('a', 'stand');
  assert.deepEqual(t.turn, { seat: 1, hand: 0 }); assert.equal(t.phase, 'playing');
  t.markGone('b');
  assert.equal(t.phase, 'dealer');
  // Already gone when their turn comes: skipped at once.
  t = mk(); deal(t, '5♠ 6♠ 9♦ 7♥ 8♥ 7♣');
  t.disconnect('b'); t.markGone('b');
  assert.deepEqual(t.turn, { seat: 0, hand: 0 });
  t.action('a', 'stand');
  assert.equal(t.phase, 'dealer');
  // Away with 11 or less: the table hits for them until the hand is above 11, then stands.
  t = mk(); deal(t, '5♠ 2♠ 9♦ 7♥ 3♥ 7♣ 4♦ 9♠');
  t.action('a', 'stand');
  t.disconnect('b'); t.markGone('b');
  assert.deepEqual(t.turn, { seat: 1, hand: 0 }, 'the turn waits for the table to hit');
  { let n = 0; for (;;) { const before = G.handTotal(t.seats[1].hands[0].cards).total; const did = t.awayMove(); if (did === 'hit') { assert.ok(before <= 11); n++; continue; } if (did === 'stand') assert.ok(before > 11); else assert.equal(did, null); break; }
    assert.ok(n >= 1, 'at least one hit'); assert.equal(t.phase, 'dealer'); }
  // Insurance: a gone player counts as "no", and the round goes on.
  t = mk(); deal(t, '5♠ 6♠ A♦ 7♥ 8♥ 7♣');
  assert.equal(t.phase, 'insurance');
  t.insurance('a', false); t.disconnect('b');
  assert.equal(t.phase, 'insurance');
  t.markGone('b');
  assert.equal(t.phase, 'playing');
  // Later rounds: a player who is away is not dealt in and does not hold up the deal.
  let g = 0; while (t.phase !== 'settled' && g++ < 200) { if (t.phase === 'playing') t.skipTurn(); else t.dealerStep(); }
  assert.equal(t.phase, 'settled');
  t.startBetting();
  t.setBet('a', { main: 10, sides: {}, ready: true });
  assert.equal(t.canDeal(), true); assert.equal(t.dealCount(), 4);
  t.deal();
  assert.equal(t.seats[1].hands.length, 0); assert.equal(t.seats[0].hands.length, 1);
  // A kicked player whose turn it is does not hold up the round.
  t = mk(); deal(t, '5♠ 6♠ 9♦ 7♥ 8♥ 7♣');
  t.kick('a');
  assert.deepEqual(t.turn, { seat: 1, hand: 0 });
  console.log('away player tests passed');
}

// Hand history: one entry per round, tagged with the shuffle it came from.
{
  const t = Object.assign(new G.Table({ decks: 1, shuffleMode: 'rounds', shuffleEvery: 2 }), { frozen: true });
  t.join('a', 'Ann', 1000); t.sit('a', 0);
  for (let r = 0; r < 5; r++) {
    t.setBet('a', { main: 10, sides: {} }); t.deal();
    let g = 0;
    while (t.phase !== 'settled' && g++ < 50) { if (t.phase === 'insurance') t.insurance('a', false); else if (t.phase === 'playing') t.action('a', 'stand'); else if (t.phase === 'dealer') t.dealerStep(); }
    assert.equal(t.phase, 'settled');
  }
  assert.equal(t.hist.length, 5, 'five rounds recorded');
  assert.ok(new Set(t.hist.map((h) => h.shoe)).size >= 2, 'more than one shuffle is marked');
  assert.ok(t.hist[0].seats[0].hands[0].cards.split(' ').length >= 2, 'cards are stored');
  assert.equal(G.Table.fromJSON(JSON.parse(JSON.stringify(t))).hist.length, 5, 'history is saved with the table');
  console.log('ok hand history');
}

// One person, two seats: separate bets and hands, one shared balance.
{
  const t = new G.Table({ startChips: 1000 });
  t.hostId = 'h'; t.frozen = true;
  t.join('a', 'Ann', 1000); t.join('b', 'Bob', 1000);
  t.sit('a', 2); t.sit('a', 4, true); t.sit('b', 6);
  // Seats of one player are always side by side: seat 4 was asked for, and the two seats are moved together.
  const [s1, s2] = t.seatsOf('a'); assert.equal(s2, s1 + 1); assert.equal(t.players.a.seat, s1); assert.equal(t.seatsOf('b').length, 1);
  t.setBet('a', { main: 600, sides: {}, ready: true, seat: s1 });
  assert.throws(() => t.setBet('a', { main: 500, sides: {}, ready: true, seat: s2 }), /Not enough chips/);
  t.setBet('a', { main: 100, sides: {}, ready: true, seat: s2 });
  t.setBet('b', { main: 50, sides: {}, ready: true });
  assert.equal(t.seats[s1].bet.main, 600); assert.equal(t.seats[s2].bet.main, 100);
  t.deal();
  assert.equal(t.players.a.chips, 300);
  let guard = 0;
  while (t.phase !== 'settled' && guard++ < 200) {
    if (t.phase === 'insurance') { t.forceInsurance(); continue; }
    if (t.phase === 'playing') { const id = t.seats[t.turn.seat].playerId; assert.ok(t.allowedActions(id).includes('stand')); assert.deepEqual(t.allowedActions(id === 'a' ? 'b' : 'a'), []); t.action(id, 'stand'); continue; }
    if (t.phase === 'dealer') { t.dealerStep(); continue; }
  }
  assert.equal(t.phase, 'settled');
  const h = t.hist[t.hist.length - 1];
  assert.deepEqual(h.seats.map((x) => x.seat), [s1 + 1, s2 + 1, t.seatsOf('b')[0] + 1].sort((x, y) => x - y));
  assert.equal(t.rebetFor('a', s1).main, Math.min(600, t.players.a.chips)); assert.ok(t.players.lastBets === undefined && t.players.a.lastBets[s2].main === 100);
  t.startBetting();
  t.standUp('a', s2);
  assert.deepEqual(t.seatsOf('a'), [s1]);
  t.standUp('a'); assert.equal(t.players.a.seat, null);
    // Seats 2, 3, 4 and 7 against 1, 5, 6 become 1 to 4 and 5 to 7, and last round's bets follow their seats.
  {
    const u = new G.Table({ startChips: 1000, seats: 7 });
    u.join('v', 'Vic', 1000); u.join('j', 'Arjun', 1000);
    u.seats = [0, 1, 1, 1, 0, 0, 1].map((x) => ({ playerId: x ? 'v' : 'j', bet: { main: 0, sides: {} }, ready: false, hands: [], sideResults: [], staked: 0, returned: 0, net: null, insurance: 0, insuranceDecided: false }));
    u.players.v.lastBets = { 1: { main: 5, sides: {} }, 6: { main: 25, sides: {} } };
    assert.ok(u.regroup());
    assert.deepEqual(u.seatsOf('v'), [0, 1, 2, 3]); assert.deepEqual(u.seatsOf('j'), [4, 5, 6]);
    assert.equal(u.players.v.seat, 0); assert.equal(u.players.j.seat, 4);
    assert.equal(u.players.v.lastBets[1].main, 5); assert.equal(u.players.v.lastBets[0].main, 25); // seat 2 stayed, seat 7 went to seat 1
    assert.ok(!u.regroup(), 'already together: nothing moves');
  }
console.log('ok two seats');
}

// Frozen ledger: chips and buy-ins go back when it stops; the shoe carries on; rounds stay in history.
{
  const t = new G.Table({ startChips: 1000 });
  t.hostId = 'a';
  t.join('a', 'Ann', 1000); t.sit('a', 0);
  t.setFrozen(true);
  const r = t.requestBuyIn('a', 650000); t.answerBuyIn(r.id, true);
  assert.equal(t.players.a.chips, 651000);
  t.join('b', 'Bob', 500); t.sit('b', 1);
  t.setBet('a', { main: 100, sides: {}, ready: true, auto: true }); t.setBet('b', { main: 50, sides: {}, ready: true });
  t.deal();
  let g = 0;
  while (t.phase !== 'settled' && g++ < 200) { if (t.phase === 'insurance') t.forceInsurance(); else if (t.phase === 'playing') t.action(t.seats[t.turn.seat].playerId, 'stand', t.turn.seat === 0); else if (t.phase === 'dealer') t.dealerStep(); }
  const left = t.shoe.length, n = t.hist.length;
  assert.throws(() => t.action('a', 'stand', true));
  t.setFrozen(false);
  assert.equal(t.players.a.chips, 1000); assert.equal(t.players.a.totalIn, 1000); assert.equal(t.players.a.boughtIn || 0, 0);
  assert.equal(t.players.b.chips, 500); assert.equal(t.shoe.length, left); assert.equal(t.hist.length, n);
  const h = t.hist[n - 1];
  assert.equal(h.frozen, true); assert.equal(h.seats[0].auto, true); assert.equal(h.seats[1].auto, undefined);
  // A blackjack ends the hand with no move, so the auto mark on a move is only there when Ann had to act.
  assert.ok(h.events.every((e) => e.who !== 'Ann' || !/^(hit|stand|double|split)/.test(e.k) || /auto play/.test(e.k)));
  console.log('ok frozen reset');
}

// The dealer sets the maximum bet; nobody else can.
{
  const t = new G.Table({});
  t.join('h', 'Hal', 1000); t.join('a', 'Ann', 1000);
  t.sit('a', 0); t.applyDealer('h');
  t.startBetting?.();
  t.setBet('a', { main: 400, sides: {} });
  let err = null; try { t.setDealerMax('a', 100); } catch (e) { err = e; }
  if (!err) throw new Error('a player who is not the dealer set the maximum bet');
  t.setDealerMax('h', 100);
  if (t.settings.maxBet !== 100 || t.seats[0].bet.main !== 100) throw new Error('dealer max not applied: ' + t.settings.maxBet + ' ' + t.seats[0].bet.main);
  err = null; try { t.setBet('a', { main: 150, sides: {} }); } catch (e) { err = e; }
  if (!err) throw new Error('a bet over the dealer max went through');
  err = null; try { t.setDealerMax('h', 1); } catch (e) { err = e; }
  if (!err) throw new Error('max below min went through');
  t.setBet('a', { main: 100, sides: { hot3: 50 } });
  t.setDealerMax('h', undefined, 20);
  if (t.settings.maxBet !== 100 || t.settings.maxSideBet !== 20 || t.seats[0].bet.sides.hot3 !== 20) throw new Error('dealer side max not applied');
  console.log('ok dealer max');
}

// Split aces: one card each, no hit and no double; an ace that gets another ace can be split again.
{
  const t = new G.Table({ startChips: 1000 });
  t.hostId = 'a'; t.frozen = true;
  t.join('a', 'Ann', 1000); t.sit('a', 0);
  t.setBet('a', { main: 100, sides: {}, ready: true });
  t.deal();
  let g = 0; while (t.phase === 'insurance' && g++ < 5) t.forceInsurance();
  if (t.phase === 'playing') {
    const seat = t.seats[0];
    seat.hands[0].cards = cs('A♠ A♦'); seat.hands[0].done = false; t.turn = { seat: 0, hand: 0 };
    const next = cs('A♣ 9♥ K♠ 5♦'); t.draw = () => next.shift();
    assert.ok(t.allowedActions('a').includes('split'));
    t.action('a', 'split'); // hands: A A (may split again), A 9 (done)
    assert.equal(seat.hands.length, 2); assert.deepEqual(t.turn, { seat: 0, hand: 0 });
    assert.deepEqual(t.allowedActions('a').sort(), ['split', 'stand']);
    assert.throws(() => t.action('a', 'hit')); assert.throws(() => t.action('a', 'double'));
    t.action('a', 'split'); // hands: A K, A 5, A 9, all done with one card each
    assert.equal(seat.hands.length, 3);
    assert.ok(seat.hands.every((h) => h.cards.length === 2 && h.done && h.splitAces));
    assert.equal(t.players.a.chips, 700);
    assert.notEqual(t.phase, 'playing');
  }
  console.log('ok resplit aces');
}
// A host move in the middle of a round: the round is never called off and no bet goes back.
{
  let carried = 0, bjAfterPeek = 0, changed = 0, settled = 0, sumOff = 0, betweenRounds = 0;
  for (let r = 0; r < 1500; r++) {
    const t = new G.Table({ decks: 6, seats: 3 });
    const ids = ['a', 'b', 'c'];
    ids.forEach((id, i) => { t.join(id, id); t.sit(id, i); });
    t.join('bank', 'Bank'); t.sitDealer('bank');
    for (const id of ids) t.setBet(id, { main: 20, sides: {}, ready: true });
    if (t.phase === 'betting') t.deal();
    const total = () => Object.values(t.players).reduce((n, p) => n + p.chips, 0) ;
    // play a random part of the round
    let steps = r % 4;
    while (steps-- > 0 && t.phase === 'insurance') { const s = t.seats.find((x) => x && !x.insuranceDecided); if (s) { try { t.insurance(s.playerId, false); } catch { break; } } else break; }
    steps = r % 3;
    while (steps-- > 0 && t.phase === 'playing' && t.turn) { const id = t.seats[t.turn.seat].playerId; t.action(id, Math.random() < 0.5 ? 'stand' : 'hit'); }
    const phase = t.phase;
    if (!t.inRound()) { betweenRounds++; continue; }
    // what the next host holds: the table without the shoe and without the face down card
    const { shoe, shoeSize, fair, hist, evts, created, runCount, dealer, turn, pendingSettings, ...lite } = JSON.parse(JSON.stringify(t.toJSON()));
    const seen = { revealed: !!dealer.revealed, cards: dealer.revealed ? dealer.cards : dealer.cards.slice(0, 1) };
    const m = G.Table.fromJSON(lite);
    for (const p of Object.values(m.players)) { p.connected = true; p.gone = false; }
    const before = JSON.stringify(m.seats.map((x) => x && [x.bet, x.staked, x.hands.map((h) => [h.cards, h.bet, !!h.doubled])]));
    const chipsBefore = Object.values(m.players).reduce((n, p) => n + p.chips, 0);
    if (!m.resumeAfterMove(seen)) { changed++; continue; }
    carried++;
    // the hands and bets on the table are the same as before the move
    if (phase !== 'dealer' && JSON.stringify(m.seats.map((x) => x && [x.bet, x.staked, x.hands.map((h) => [h.cards, h.bet, !!h.doubled])])) !== before) changed++;
    if (Object.values(m.players).reduce((n, p) => n + p.chips, 0) !== chipsBefore) changed++; // no bet went back
    const up = m.dealer.cards[0];
    if (phase === 'playing' && (up.r === 'A' || ['10', 'J', 'Q', 'K'].includes(up.r)) && m.dealer.cards.length === 2 && G.handTotal(m.dealer.cards).total === 21) bjAfterPeek++;
    // play the round out
    let guard = 0;
    while (m.inRound() && guard++ < 200) {
      if (m.phase === 'insurance') { const s = m.seats.find((x) => x && x.hands.length && !x.insuranceDecided); if (s) m.insurance(s.playerId, false); else m.afterInsurance(); }
      else if (m.phase === 'playing' && m.turn) m.action(m.seats[m.turn.seat].playerId, 'stand');
      else if (m.phase === 'dealer') { while (m.dealerStep()) {} }
    }
    if (m.phase === 'settled' && m.seats.every((x) => !x || !x.hands.length || x.net !== null)) settled++;
    // players against a player dealer: the chips at the table add up to the same number as before the round
    if (Math.abs(Object.values(m.players).reduce((n, p) => n + p.chips, 0) - 4000) > 0.001) sumOff++;
  }
  assert.ok(carried > 1000, 'rounds carried on: ' + carried);
  assert.equal(changed, 0, 'hands, bets and chips are untouched by the move');
  assert.equal(bjAfterPeek, 0, 'no dealer blackjack after the dealer already looked');
  assert.equal(settled, carried, 'every carried round is played to a result');
  assert.equal(sumOff, 0, 'chips add up after the carried round');
  console.log(`ok round carries on after a host move (${carried} rounds)`);
}
