// Computer players: many hands with bots only. Every move must be a legal one and no chip may appear or vanish.
import { PokerTable } from '../js/poker.js';
import { botMove, isBot } from '../js/pokerbot.js';
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
PokerTable.noChances = true;
const count = { fold: 0, check: 0, call: 0, bet: 0, raise: 0 };
for (const game of [{}, { game: 'plo' }, { doubleBoard: true }]) {
  const t = new PokerTable({ ...game, turnTimer: 0 });
  for (let k = 0; k < 7; k++) { t.join('bot-' + k, 'Bot ' + k); t.sit('bot-' + k, k, 300); }
  let bought = 0;
  for (let h = 0; h < 500; h++) {
    for (const x of t.seats) if (x && x.stack <= 0) { t.addChips(x.id, 300); bought += 300; }
    if (!t.canStart()) break;
    t.startHand();
    let guard = 0;
    while (t.inHand() && guard++ < 400) {
      if (t.runAsk && !t.runAsk.done) { const a = t.runAsk; if (!a.n) t.runPick(t.seats[a.by].id, 1); else t.runAnswer(t.seats[a.need.find((q) => !a.yes.includes(q))].id, true); continue; }
      const id = t.seats[t.turn].id, m = botMove(t, id);
      ok(isBot(id) && m, 'a bot has a move on its turn');
      try { t.act(id, m.a, m.amount); count[m.a]++; } catch (e) { ok(false, `illegal move ${JSON.stringify(m)}: ${e.message}`); t.act(id, t.options(id).canCheck ? 'check' : 'fold'); }
    }
    ok(!t.inHand(), 'the hand ends');
    ok(t.chipsTotal() === 7 * 300 + bought, `chips kept: ${t.chipsTotal()} / ${7 * 300 + bought}`);
  }
}
console.log('moves', JSON.stringify(count));
console.log(`${n - fails}/${n} bot checks passed`);
process.exit(fails ? 1 : 0);
