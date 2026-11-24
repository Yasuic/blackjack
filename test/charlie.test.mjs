// Five Card Charlie: on random rounds (about 1 in charlieEvery), five cards without busting win at once at 1 to 1
// and stop taking cards. A dealer blackjack still wins. Only the dealer sets how often. Chips stay zero sum.
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
const { handTotal } = G;
let n = 0, charlies = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
ok(new G.Table({}).settings.charlieEvery === 10, 'about 1 round in 10 by default');
ok(new G.Table({ charlie: false }).settings.charlieEvery === 0 && new G.Table({ charlie: true }).settings.charlieEvery === 10, 'old on/off switch carries over');
ok(!('charlie' in new G.Table({ charlie: true }).settings), 'old switch removed');
const mk = (on) => {
  const t = new G.Table({ maxBet: 75, minBet: 10, maxSideBet: 10, sideBets: [], charlieEvery: on ? 1 : 0 });
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
    ok(t.charlieRound === on, 'every round is a Charlie round at 1 in 1, none at 0');
  }
}
// A dealer blackjack beats a hand marked Charlie.
{
  const t = mk(true); t.startBetting();
  t.setBet('a', { main: 10, sides: {}, ready: true, seat: 0 }); t.setBet('a', { main: 0, sides: {}, ready: false, seat: 1 });
  const before = t.players.a.chips + t.players.bank.chips;
  t.deal(); if (t.phase === 'insurance') { try { t.insurance('a', false, 0); } catch {} }
  const h = t.seats[0].hands[0];
  h.cards = [{ r: '2', s: 'h' }, { r: '3', s: 'h' }, { r: '2', s: 'd' }, { r: '3', s: 'd' }, { r: '4', s: 'c' }]; h.charlie = true; h.done = true;
  t.dealer.cards = [{ r: 'A', s: 's' }, { r: 'K', s: 's' }];
  t.finishRound ? t.finishRound() : null;
  ok(h.result === 'Lose' && !h.paid, 'dealer blackjack beats 5 Card Charlie: ' + h.result);
  assert.equal(t.players.a.chips + t.players.bank.chips, before, 'zero sum');
}
// Random rounds: about 1 in n. Only the dealer may change it.
{
  const t = mk(true); t.settings.charlieEvery = 10; let c = 0;
  for (let r = 0; r < 20000; r++) { t.pickCharlie(); if (t.charlieRound) c++; }
  ok(c > 1700 && c < 2300, `1 in 10 picked ${c} of 20000`);
  assert.throws(() => t.setCharlieEvery('a', 3), /dealer/);
  t.setCharlieEvery('bank', 4); ok(t.settings.charlieEvery === 4, 'dealer sets it');
  assert.throws(() => t.dealerSave('bank', { rules: { charlieEvery: -1 } }));
  t.dealerSave('bank', { rules: { charlieEvery: 0 } }); ok(t.settings.charlieEvery === 0, 'dealer turns it off');
  t.pickCharlie(); ok(!t.charlieRound, 'off: never a Charlie round');
  ok(G.Table.fromJSON(JSON.parse(JSON.stringify(t))).settings.charlieEvery === 0, 'kept through a save');
  // The dealer makes this round a Charlie round, while bets are open only.
  t.startBetting(); assert.throws(() => t.forceCharlie('a'), /dealer/); n++;
  t.forceCharlie('bank'); ok(t.charlieRound && t.publicState('a').charlieRound, 'dealer made this round Charlie, and the table sees it');
  t.setBet('a', { main: 10, sides: {}, ready: true, seat: 0 }); t.setBet('a', { main: 0, sides: {}, ready: false, seat: 1 }); t.deal();
  if (t.phase === 'insurance') { try { t.insurance('a', false, 0); } catch {} }
  ok(t.charlieRound, 'stays for the round that was dealt');
  if (t.phase === 'playing') { assert.throws(() => t.forceCharlie('bank'), /bets are open/); n++; }
}
ok(charlies > 20, `Charlies seen: ${charlies}`);
console.log(`5 card charlie: ${n} checks passed (${charlies} Charlies)`);
