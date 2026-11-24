// Five Card Charlie: five cards without busting win at once at 1 to 1 and stop taking cards. Chips stay zero sum.
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
const { handTotal } = G;
let n = 0, charlies = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
ok(new G.Table({}).settings.charlie === true, 'on by default for a new table');
const mk = (on) => {
  const t = new G.Table({ maxBet: 75, minBet: 10, maxSideBet: 10, sideBets: [], charlie: on });
  t.join('a', 'Ann'); t.sit('a', 0); t.sit('a', 1, true);
  t.join('bank', 'Bank'); t.sitDealer('bank');
  t.giveChips('bank', 1e6); t.giveChips('a', 1e6);
  return t;
};
for (const on of [true, false]) {
  const t = mk(on);
  for (let r = 0; r < 1500; r++) {
    for (const s of t.seatsOf('a')) t.setBet('a', { main: 10, sides: {}, ready: true, seat: s });
    const before = t.players.a.chips + t.players.bank.chips;
    t.deal();
    for (const s of t.seatsOf('a')) if (t.phase === 'insurance') { try { t.insurance('a', false, s); } catch {} }
    let g = 0;
    while (t.phase === 'playing' && g++ < 60) {
      const h = t.seats[t.turn.seat].hands[t.turn.hand];
      t.action('a', handTotal(h.cards).total <= 15 && t.allowedActions('a').includes('hit') ? 'hit' : 'stand');
    }
    while (t.dealerStep()) {}
    assert.equal(t.phase, 'settled');
    assert.equal(t.players.a.chips + t.players.bank.chips, before, 'zero sum');
    for (const s of t.seatsOf('a')) for (const h of t.seats[s].hands) {
      if (on) {
        ok(h.cards.length <= 5, 'no sixth card');
        if (h.cards.length === 5 && handTotal(h.cards).total <= 21) { charlies++; ok(h.result === '5 Card Charlie' && h.paid === h.bet * 2, 'Charlie pays 1 to 1 whatever the dealer has'); }
      } else ok(h.result !== '5 Card Charlie', 'off: no Charlie');
    }
    t.startBetting();
  }
}
ok(charlies > 20, `Charlies seen: ${charlies}`);
console.log(`5 card charlie: ${n} checks passed (${charlies} Charlies)`);
