// The dealer's one Save (dealerSave): limits, shuffle every 8, Big bets sometimes and Stop at loss in one go, all
// checked before anything changes; and a practice table's colleague dealer (setFrozen with a name).
import * as G from '../js/game.js';
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const throws = (f) => { try { f(); return false; } catch { return true; } };
{
  const t = new G.Table({ decks: 6, maxBet: 100, minBet: 5, startChips: 1000 }); t.join('d', 'Dee'); t.join('a', 'Ann'); t.sit('a', 0); t.applyDealer('d');
  t.dealerSave('d', { min: 10, max: 200, side: 20, shuffle8: false, big: { on: true, limit: 800, per: 3, hands: 5 }, cap: { on: true, amount: 900 } });
  const s = t.settings;
  ok(s.minBet === 10 && s.maxBet === 200 && s.maxSideBet === 20 && s.shuffle8 === false, 'limits and shuffle saved: ' + JSON.stringify([s.minBet, s.maxBet, s.maxSideBet, s.shuffle8]));
  ok(s.bigBet && s.bigBet.limit === 800 && s.bigBet.per === 3 && s.bigBet.hands === 5, 'big bets saved');
  ok(t.capAmount() === 900 && t.lossCap.on, 'stop at loss saved');
  const before = JSON.stringify([t.settings, t.lossCap]);
  ok(throws(() => t.dealerSave('d', { min: 10, max: 300, big: { on: true, limit: 250, per: 1, hands: 1 }, cap: { on: false, amount: 5 } })), 'big bet below the max is refused');
  ok(JSON.stringify([t.settings, t.lossCap]) === before, 'a refused save changes nothing');
  ok(throws(() => t.dealerSave('d', { min: 50, max: 20 })), 'max below min is refused');
  ok(throws(() => t.dealerSave('a', { max: 50 })), 'only the dealer saves');
  const used = (t.players.a.bigUsed = 1);
  t.dealerSave('d', { min: 10, max: 200, side: 20, shuffle8: false, big: { on: true, limit: 800, per: 3, hands: 5 }, cap: { on: true, amount: 900 } });
  ok(t.players.a.bigUsed === used, 'saving the same big bets again does not reset what players used');
  t.dealerSave('d', { big: { on: false }, cap: { on: false } });
  ok(!t.settings.bigBet && !t.lossCap.on, 'big bets and stop at loss turned off');
}
{
  const t = new G.Table({ decks: 6, maxBet: 100, minBet: 5, startChips: 1000 }); t.join('h', 'Hal'); t.sit('h', 0);
  t.setFrozen(true, 'Allie');
  ok(t.publicState('h').houseDealer === 'Allie', 'the colleague who deals practice rounds is public');
  t.setFrozen(false);
  ok(t.publicState('h').houseDealer === null, 'no colleague once the freeze is off');
  t.setFrozen(true);
  ok(t.publicState('h').houseDealer === null, 'no name given: the house deals');
  t.join('d', 'Dee'); t.setFrozen(true, 'Allie'); t.applyDealer('d');
  ok(t.publicState('h').houseDealer === null, 'a player dealer replaces the colleague');
}
console.log(`${n - fails}/${n} dealer save checks passed`);
if (fails) process.exit(1);
