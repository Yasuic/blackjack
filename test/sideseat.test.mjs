// A side bet placed on one of a person's seats stays on that seat: the other seats keep only their own bets,
// stakes and side results, and the chips stay zero sum.
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const t = new G.Table({ maxBet: 75, minBet: 10, maxSideBet: 10 });
t.join('a', 'Ann'); t.sit('a', 0); t.sit('a', 1, true); t.sit('a', 2, true);
t.join('bank', 'Bank'); t.sitDealer('bank');
t.giveChips('bank', 1e6); t.giveChips('a', 1e6);
const keys = t.settings.sideBets || G.SIDE_KEYS;
ok(keys.length > 0, 'side bets offered');
for (let r = 0; r < 400; r++) {
  const seats = t.seatsOf('a'), pick = seats[r % seats.length], k = keys[r % keys.length];
  for (const s of seats) t.setBet('a', { main: 10, sides: s === pick ? { [k]: 5 } : {}, ready: true, seat: s });
  for (const s of seats) ok(Object.keys(t.seats[s].bet.sides).length === (s === pick ? 1 : 0), 'side bet only on the seat it was put on');
  const before = t.players.a.chips + t.players.bank.chips;
  t.deal();
  for (const s of seats) if (t.phase === 'insurance') { try { t.insurance('a', false, s); } catch {} }
  let g = 0;
  while (t.phase === 'playing' && g++ < 60) t.action('a', 'stand');
  while (t.dealerStep()) {}
  assert.equal(t.phase, 'settled');
  assert.equal(t.players.a.chips + t.players.bank.chips, before, 'zero sum');
  for (const s of seats) {
    const x = t.seats[s];
    const extra = x.insurance || 0;
    ok(x.staked === 10 + (s === pick ? 5 : 0) + extra, `seat ${s} staked only its own bets`);
    ok(x.sideResults.every((y) => s === pick && y.key === k), 'side results only on that seat');
  }
  t.startBetting();
}
console.log(`side bet per seat: ${n} checks passed`);
