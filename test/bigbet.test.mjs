// Big Bets Sometimes: the dealer lets each player bet above the normal maximum a few times per window of hands.
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const mk = () => {
  const t = Object.assign(new G.Table({ maxBet: 75, minBet: 10, maxSideBet: 10, sideBets: [] }), { frozen: true });
  t.join('a', 'Ann'); t.sit('a', 0);
  t.join('b', 'Bob'); t.sit('b', 1);
  t.join('bank', 'Bank'); t.sitDealer('bank');
  t.giveChips('bank', 100000); t.giveChips('a', 10000); t.giveChips('b', 10000);
  return t;
};
const play = (t) => {
  if (t.phase === 'insurance') for (const id of ['a', 'b']) { try { t.insurance(id, false); } catch {} }
  let g = 0;
  while (t.phase === 'playing' && g++ < 200) { const id = t.seats[t.turn.seat].playerId; t.action(id, 'stand'); }
  while (t.dealerStep()) {}
  assert.equal(t.phase, 'settled');
  t.startBetting();
};
const tryBet = (t, id, main, big) => { try { t.setBet(id, { main, sides: {}, ready: true, big }); return 'ok'; } catch (e) { return e.message; } };

// Only the dealer can set it, and only with sensible numbers.
{ const t = mk();
  assert.throws(() => t.setBigBet('a', { limit: 500, per: 2, hands: 3 }), /Only the dealer/);
  assert.throws(() => t.setBigBet('bank', { limit: 50, per: 2, hands: 3 }), /above the normal maximum/);
  assert.throws(() => t.setBigBet('bank', { limit: 500, per: 0, hands: 3 }), /at least 1 big bet/);
  assert.throws(() => t.setBigBet('bank', { limit: 500, per: 2, hands: 0 }), /at least 1/);
  ok(t.settings.bigBet === null, 'still off after bad input'); }

// Without the feature, a bet over the maximum is refused even with the big flag.
{ const t = mk(); ok(/Maximum bet is 75/.test(tryBet(t, 'a', 200, true)), 'off: over max refused'); }

// With the feature on.
{ const t = mk();
  t.setBigBet('bank', { limit: 500, per: 2, hands: 3 });
  ok(t.settings.bigBet.limit === 500 && t.settings.bigBet.per === 2 && t.settings.bigBet.hands === 3, 'stored');
  ok(/Maximum bet is 75/.test(tryBet(t, 'a', 200, false)), 'over max without the flag is refused');
  ok(/at most 500/.test(tryBet(t, 'a', 600, true)), 'over the big limit is refused');
  ok(tryBet(t, 'a', 75, false) === 'ok', 'normal bet ok');
  ok(t.bigLeft('a') === 2 && t.bigHandsLeft() === 3, 'start: 2 left, 3 hands left');

  // hand 1: Ann big 200
  ok(tryBet(t, 'a', 200, true) === 'ok', 'big bet accepted'); tryBet(t, 'b', 10, false);
  t.deal();
  ok(t.players.a.bigUsed === 1 && t.bigLeft('a') === 1, 'one used, one left');
  ok(t.log.some((l) => /Ann made a big bet of 200 \(big bet 1 of 2/.test(l)), 'logged');
  const chipsBefore = t.players.a.chips;
  play(t);
  ok(t.bigHandsLeft() === 2, 'two hands left in the window');

  // hand 2: Ann big again (her last one)
  ok(tryBet(t, 'a', 300, true) === 'ok', 'second big bet ok'); tryBet(t, 'b', 10, false);
  t.deal(); ok(t.bigLeft('a') === 0, 'none left'); play(t);

  // hand 3: no big left
  ok(/no big bets left/.test(tryBet(t, 'a', 200, true)), 'third big bet refused');
  ok(tryBet(t, 'a', 75, false) === 'ok', 'normal still fine'); tryBet(t, 'b', 10, false);
  ok(t.bigHandsLeft() === 1, 'last hand of the window');
  t.deal(); play(t);

  // hand 4: new window, big bets are back
  ok(t.bigLeft('a') === 2 && t.bigHandsLeft() === 3, 'window rolled: 2 left again, 3 hands left');
  ok(tryBet(t, 'a', 500, true) === 'ok', 'big bet at the limit ok in the new window'); tryBet(t, 'b', 10, false);
  t.deal(); ok(t.players.a.bigUsed === 1, 'new window count'); play(t);

  // Bob never used his: he had 2 in the first window, they expired and he has 2 now as well.
  ok(t.bigLeft('b') === 2, 'unused ones do not pile up');

  // Public state shows it.
  const ps = t.publicState('a');
  ok(ps.big && ps.big.limit === 500 && ps.big.yourLeft === 1 && ps.players.find((p) => p.id === 'b').bigLeft === 2, 'public state');

  // Turning it off.
  t.setBigBet('bank', { off: true }); ok(t.settings.bigBet === null && /Maximum bet is 75/.test(tryBet(t, 'a', 200, true)), 'off again'); }

// Two seats of the same player both big in one hand count as two. (Seats regroup, so read the real seat numbers.)
{ const t = mk();
  t.sit('a', 2, true); t.sit('a', 4, true);
  const [s1, s2, s3] = t.seatsOf('a');
  ok(s3 !== undefined, 'three seats for Ann');
  t.setBigBet('bank', { limit: 500, per: 2, hands: 5 });
  t.setBet('a', { main: 200, sides: {}, ready: true, big: true, seat: s1 });
  t.setBet('a', { main: 200, sides: {}, ready: true, big: true, seat: s2 });
  // a third seat would need a third big bet: refused
  assert.throws(() => t.setBet('a', { main: 200, sides: {}, ready: true, big: true, seat: s3 }), /no big bets left/);
  t.setBet('a', { main: 10, sides: {}, ready: true, seat: s3 });
  tryBet(t, 'b', 10, false);
  t.deal(); ok(t.players.a.bigUsed === 2 && t.bigLeft('a') === 0, 'two seats, two used'); }

// Chips still add up with big bets in a long random run.
{ const t = mk();
  t.setBigBet('bank', { limit: 400, per: 3, hands: 4 });
  for (let r = 0; r < 300; r++) {
    for (const id of ['a', 'b']) {
      if (t.players[id].chips < 600) t.giveChips(id, 5000);
      const big = Math.random() < 0.4 && t.bigLeft(id) > 0;
      t.setBet(id, { main: big ? 100 + Math.floor(Math.random() * 300) : 10 + Math.floor(Math.random() * 60), sides: {}, ready: true, big });
    }
    if (t.players.bank.chips < 5000) t.giveChips('bank', 50000);
    const before = ['a', 'b'].reduce((s, id) => s + t.players[id].chips, 0) + t.players.bank.chips;
    t.deal(); play(t);
    const after = ['a', 'b'].reduce((s, id) => s + t.players[id].chips, 0) + t.players.bank.chips;
    assert.equal(after, before, 'chips add up');
    ok(t.players.a.bigUsed <= 3 && t.players.b.bigUsed <= 3, 'never more than the allowance');
  }
  // JSON round trip keeps the setting and the counts
  const t2 = G.Table.fromJSON(JSON.parse(JSON.stringify(t)));
  ok(JSON.stringify(t2.settings.bigBet) === JSON.stringify(t.settings.bigBet) && t2.bigLeft('a') === t.bigLeft('a'), 'saved and restored'); }

console.log(`big bets: ${n} checks passed`);
