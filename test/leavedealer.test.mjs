// Leave dealer seat pressed during a round: the dealer deals this round to the end and leaves once it is paid.
// A second press calls it off. Between rounds it is at once.
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const play = (t) => { let g = 0; while (t.phase === 'insurance' && g++ < 9) { try { t.insurance('a', false, 0); } catch {} } g = 0; while (t.phase === 'playing' && g++ < 40) t.action(t.seats[t.turn.seat].playerId, 'stand'); while (t.dealerStep()) {} };
const mk = () => { const t = new G.Table({ charlieEvery: 0 }); for (const id of 'da') t.join(id, id.toUpperCase(), 1000); t.sit('a', 0); t.sitDealer('d'); t.setBet('a', { seat: 0, main: 10, sides: {}, ready: true }); t.deal(); return t; };
{
  const t = mk();
  ok(t.inRound() || t.phase === 'settled', 'a round is dealt');
  if (t.inRound()) {
    t.leaveDealer('d');
    ok(t.banker === 'd' && t.bankerLeaving, 'mid round: still the dealer, marked to leave');
    play(t);
    ok(t.phase === 'settled' && t.banker === null, 'after the round is paid: the dealer seat is free');
  }
}
{
  const t = mk();
  if (t.inRound()) {
    t.leaveDealer('d'); t.leaveLater('d', false);
    ok(!t.bankerLeaving, 'second tap calls it off');
    play(t);
    ok(t.banker === 'd', 'called off: keeps dealing');
    t.leaveDealer('d'); ok(t.banker === null, 'between rounds: leaves at once');
  }
}
console.log(`leave dealer seat: ${n} checks passed`);
