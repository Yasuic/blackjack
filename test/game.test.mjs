import assert from 'node:assert/strict';
import * as G from '../js/game.js';
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
  t.proposeSettings('h', { decks: 1 }, 'x'); t.castVote('a', true); assert.equal(t.settings.decks, 6);
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
  assert.throws(() => t.setBet('a', { main: 10, sides: { friendBust: 10 }, target: 0 }));
  t.setBet('a', { main: 10, sides: { friendBust: 10 }, target: 1 });
  t.setBet('b', { main: 10, sides: {} });
  const total = () => Object.values(t.players).reduce((x, p) => x + p.chips, 0);
  const before = total();
  t.deal();
  let g = 0; while (t.phase !== 'settled' && g++ < 80) { if (t.phase === 'insurance') { t.insurance('a', false); t.insurance('b', false); } else if (t.phase === 'playing') { const id = t.seats[t.turn.seat].playerId; t.action(id, id === 'b' ? 'hit' : 'stand'); } else if (t.phase === 'dealer') t.dealerStep(); }
  assert.equal(total(), before);
  const fb = t.seats[0].sideResults.find((r) => r.key === 'friendBust');
  assert.ok(fb);
  assert.equal(fb.win, G.handTotal(t.seats[1].hands[0].cards).total > 21);
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
  assert.equal(t.settings.seats, 10); assert.equal(t.seats.length, 10); assert.equal(t.settings.decks, 6);
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
  // A player dealer with too few chips cannot deal, and cannot leave while owing chips.
  const t = new G.Table(); t.join('a', 'A', 1000); t.join('d', 'D', 20); t.sit('a', 0); t.sitDealer('d');
  t.setBet('a', { main: 500, sides: {} });
  assert.equal(t.bankShort(), true); assert.equal(t.canDeal(), false);
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
  t.setBet('a', { main: 50, sides: { hot3: 10, bustIt: 5, friendBust: 5 }, target: 2, seq: 7 });
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
  assert.deepEqual(t.rebetFor('a'), { main: 50, sides: { hot3: 10, friendBust: 5, bustIt: 5 }, target: 2 });
  assert.deepEqual(t.publicState('a').rebet, t.rebetFor('a'));
  assert.equal(t.publicState('b').rebet.main, 25);
  // The friend moved to another seat: the PvP bet follows the person, not the chair.
  t.sit('b', 4);
  assert.equal(t.rebetFor('a').target, 4);
  // The friend left: the PvP part is dropped.
  t.standUp('b');
  assert.equal(t.rebetFor('a').sides.friendBust, undefined);
  assert.equal(t.rebetFor('a').target, undefined);
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
  t.sit('a', 2); t.sit('a', 4, true); t.sit('b', 3);
  assert.deepEqual(t.seatsOf('a'), [2, 4]); assert.equal(t.players.a.seat, 2);
  t.setBet('a', { main: 600, sides: {}, ready: true, seat: 2 });
  assert.throws(() => t.setBet('a', { main: 500, sides: {}, ready: true, seat: 4 }), /Not enough chips/);
  t.setBet('a', { main: 100, sides: {}, ready: true, seat: 4 });
  t.setBet('b', { main: 50, sides: {}, ready: true });
  assert.equal(t.seats[2].bet.main, 600); assert.equal(t.seats[4].bet.main, 100);
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
  assert.deepEqual(h.seats.map((x) => x.seat), [3, 4, 5]);
  assert.equal(t.rebetFor('a', 2).main, Math.min(600, t.players.a.chips)); assert.ok(t.players.lastBets === undefined && t.players.a.lastBets[4].main === 100);
  t.startBetting();
  t.standUp('a', 4);
  assert.deepEqual(t.seatsOf('a'), [2]);
  t.standUp('a'); assert.equal(t.players.a.seat, null);
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
