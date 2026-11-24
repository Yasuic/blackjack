// The dealer's rules: each one changes what a player may do or what a hand pays, only the dealer (or the host
// while the house deals) sets them, only between rounds, and a settings vote never touches them.
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const C = (r, s = 'h') => ({ r, s });
const mk = (rules = {}) => {
  const t = new G.Table({ maxBet: 75, minBet: 10, maxSideBet: 10, sideBets: [], charlieEvery: 0 });
  t.join('a', 'Ann'); t.sit('a', 0); t.join('bank', 'Bank'); t.sitDealer('bank');
  t.giveChips('bank', 1e6); t.giveChips('a', 1e6);
  t.setRules('bank', rules);
  return t;
};
// Deal until play reaches the player's hand (no dealer blackjack), then give it these cards.
const play = (t, cards) => {
  for (let k = 0; k < 200; k++) {
    t.setBet('a', { main: 10, sides: {}, ready: true, seat: 0 });
    t.deal(); if (t.phase === 'insurance') t.insurance('a', false, 0);
    if (t.phase === 'playing') { const h = t.seats[0].hands[0]; h.cards = cards.map((x) => C(x)); h.done = false; return h; }
    while (t.dealerStep()) {} t.startBetting();
  }
  throw new Error('no playable round');
};
const acts = (t) => t.allowedActions('a');
// Split aces / resplit aces / max splits
{ const t = mk({ splitAces: false }); play(t, ['A', 'A']); ok(!acts(t).includes('split'), 'no split aces'); }
{ const t = mk(); play(t, ['A', 'A']); ok(acts(t).includes('split'), 'split aces by default'); }
{ const t = mk({ resplitAces: false }); play(t, ['A', 'A']); t.seats[0].hands[0].cards = [C('A'), C('A')]; t.shoe.push(C('A'), C('A'));
  t.action('a', 'split'); const hs = t.seats[0].hands; ok(hs.length === 2 && hs.every((h) => h.done), 'resplit off: split aces stand, even on another ace'); }
for (const max of [1, 2, 3]) {
  const t = mk({ maxSplits: max }); play(t, ['8', '8']);
  let splits = 0;
  for (let g = 0; g < 10 && t.phase === 'playing'; g++) {
    const h = t.seats[0].hands[t.turn.hand]; h.cards = [C('8'), C('8')];
    if (acts(t).includes('split')) { t.action('a', 'split'); splits++; } else break;
  }
  ok(splits === max, `max ${max} splits: made ${splits}`);
}
{ const t = mk({ maxSplits: 0 }); play(t, ['8', '8']); let s = 0; for (let g = 0; g < 6; g++) { const h = t.seats[0].hands[t.turn.hand]; h.cards = [C('8'), C('8')]; if (!acts(t).includes('split')) break; t.action('a', 'split'); s++; } ok(s === 6, 'no limit: 6 splits in a row'); }
// Double after split, double on
{ const t = mk({ das: false }); play(t, ['8', '8']); t.action('a', 'split'); const h = t.seats[0].hands[t.turn.hand]; h.cards = [C('8'), C('3')]; ok(!acts(t).includes('double'), 'no double after split'); }
{ const t = mk(); play(t, ['8', '8']); t.action('a', 'split'); const h = t.seats[0].hands[t.turn.hand]; h.cards = [C('8'), C('3')]; ok(acts(t).includes('double'), 'double after split by default'); }
for (const [on, tot, yes] of [['9-11', ['5', '4'], true], ['9-11', ['5', '3'], false], ['10-11', ['5', '4'], false], ['10-11', ['6', '5'], true], ['any', ['10', '7'], true]]) {
  const t = mk({ doubleOn: on }); play(t, tot); ok(acts(t).includes('double') === yes, `double on ${on} with ${tot}: ${yes}`);
}
// Surrender
{ const t = mk({ allowSurrender: false }); play(t, ['10', '6']); ok(!acts(t).includes('surrender'), 'no surrender'); }
// 6 to 5
{ const t = mk({ blackjackPays: 1.2 }); const h = play(t, ['A', 'K']); h.done = true; t.seats[0].hands[0].cards = [C('A'), C('K')];
  t.dealer.cards = [C('9'), C('8')]; const before = t.players.a.chips; t.advance?.(); while (t.dealerStep()) {} if (t.phase !== 'settled') t.finishRound();
  ok(t.players.a.chips - before === 22, '6 to 5: a 10 blackjack gets 22 back (12 win), got ' + (t.players.a.chips - before)); }
// Who and when
{ const t = mk(); assert.throws(() => t.setRules('a', { das: false }), /dealer/); n++;
  play(t, ['10', '6']); ok(t.setRules('bank', { das: false }) === 'next' && t.settings.das !== false, 'saved mid hand: not applied to the hand in play');
  ok(t.publicState('a').settingsNext, 'the table shows a change is waiting for the next hand');
  while (t.phase === 'playing') t.action('a', 'stand'); while (t.dealerStep()) {}
  t.startBetting(); ok(t.settings.das === false && !t.publicState('a').settingsNext, 'applied when the next hand opens');
  t.updateSettings({ das: true, dealerHitsSoft17: false, blackjackPays: 1, charlieEvery: 2 }); ok(t.settings.das === false && t.settings.dealerHitsSoft17 === true && t.settings.blackjackPays === 1.5 && t.settings.charlieEvery === 0, 'a settings change never touches the rules');
  assert.throws(() => t.setRules('bank', { maxSplits: 9 })); assert.throws(() => t.setRules('bank', { blackjackPays: 2 })); assert.throws(() => t.setRules('bank', { doubleOn: 'x' })); n += 3;
  ok(t.publicState('a').rulesNote.join() === 'Double after split not allowed', 'the change is shown to the table: ' + t.publicState('a').rulesNote);
  ok(G.Table.fromJSON(JSON.parse(JSON.stringify(t))).settings.das === false, 'kept through a save');
}
{ const t = new G.Table({}); t.join('h', 'Host'); t.hostId = 'h'; t.setRules('h', { dealerHitsSoft17: true }); ok(t.settings.dealerHitsSoft17, 'host sets the rules while the house deals'); }
console.log(`dealer rules: ${n} checks passed`);
