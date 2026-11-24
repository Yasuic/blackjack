// One press of Hit gives one card: the same press arriving twice is dropped by its step, while a second real
// Hit pressed after the first card has shown goes through.
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
const { Table, stepOf } = G;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
for (let trial = 0; trial < 300; trial++) {
  const t = new Table({ hostId: 'h', settings: { decks: 6, turnTimer: 0, betTimer: 0 } });
  t.join('h', 'Hal', 1000); t.join('a', 'Ann', 1000); t.join('d', 'Dee', 5000);
  t.sit('a', 0); t.sitDealer?.('d');
  if (!t.banker) t.setFrozen(true);
  t.setBet('a', { main: 10, sides: {}, ready: true });
  try { t.deal(); } catch { continue; }
  while (t.phase === 'insurance') { try { t.insurance('a', false); } catch { break; } }
  if (t.phase !== 'playing' || !t.turn) continue;
  // The host runs what app.js runs: a move carries the step it was pressed on and is applied only on that step.
  const apply = (msg) => { if (msg.step && msg.step !== stepOf(t)) return false; t.action('a', msg.a); return true; };
  const step = stepOf(t), before = t.seats[0].hands[0].cards.length;
  const press = { t: 'action', a: 'hit', step };
  const first = apply(press);
  const hand = t.seats[0].hands[0];
  ok(first && hand.cards.length === before + 1, 'first press deals one card');
  if (t.turn && t.turn.seat === 0 && t.turn.hand === 0) {
    const again = apply(press); // the same message a second time (double tap, or sent twice)
    ok(!again && hand.cards.length === before + 1, 'the same press again is dropped');
    const step2 = stepOf(t);
    ok(step2 !== step, 'the step moves on once the card shows');
    const second = apply({ t: 'action', a: 'hit', step: step2 }); // a real second hit right after
    ok(second && hand.cards.length === before + 2, 'a real second hit goes through');
  }
}
ok(stepOf(null) === '' && stepOf({ turn: null }) === '', 'no turn, no step');
console.log(`double hit guard: ${n} checks passed`);
