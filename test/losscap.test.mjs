// Stop at loss for a player dealer: on by default at 30 x max bet, a tick box turns it off, the dealer stops after
// the hand that reaches it (never mid hand), buy ins do not count as losses, and the ledger stays zero sum.
import * as G from '../js/game.js';
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const mk = () => { const t = new G.Table({ decks: 6, maxBet: 100, minBet: 5, startChips: 1000 }); t.join('d', 'Dee'); t.join('a', 'Ann'); t.sit('a', 0); t.applyDealer('d'); return t; };
const play = (t, bet, a = 'stand') => {
  if (t.players.a.chips < bet * 4) { const q = t.requestBuyIn('a', 1000); t.answerBuyIn(q.id, true); }
  t.setBet('a', { main: bet, sides: {}, seat: 0 }); t.deal();
  for (let g = 0; t.inRound() && g < 50; g++) { if (t.phase === 'insurance') t.insurance('a', false, 0); else if (t.phase === 'playing') t.action('a', t.allowedActions('a').includes(a) ? a : 'stand'); else if (t.phase === 'dealer') t.dealerStep(); }
  t.startBetting();
};
{
  const t = mk();
  const st = t.publicState('d').lossCap;
  ok(st && st.on && st.amount === 3000 && st.auto && st.lost === 0, 'on by default at 30 x max bet (3000): ' + JSON.stringify(st));
  ok(t.publicState('a').lossCap, 'everyone sees the dealer has a stop at loss');
  t.setDealerMax('d', 125); ok(t.publicState('d').lossCap.amount === 3750, 'follows the max bet until the dealer types one (125 -> 3750)');
  t.setLossCap('d', true, 50); ok(t.publicState('d').lossCap.amount === 50 && !t.publicState('d').lossCap.auto, 'dealer types an amount');
  let thr = 0; try { t.setLossCap('a', true, 50); } catch { thr++; } ok(thr === 1, 'only the dealer sets it');
  // Play until the dealer has lost 50 or more (one lost hand of 100 does it).
  let rounds = 0, stoppedMid = false;
  while (t.banker === 'd' && rounds < 400) {
    if (t.dealerLoss() === 0) { t.setLossCap('d', false); t.setLossCap('d', true); } // count from here, so the next lost hand counts
    play(t, 100, 'stand'); rounds++;
    if (t.inRound()) stoppedMid = true;
  }
  ok(t.banker === null, 'dealer stopped after the hand that reached the loss: ' + rounds + ' rounds');
  ok(t.log.some((l) => /stopped dealing/.test(l)), 'the log says why');
  ok(!stoppedMid, 'never mid hand');
  const sum = Object.values(t.players).reduce((a, p) => a + (p.chips - p.totalIn), 0);
  ok(Math.abs(sum) < 1e-6, 'ledger zero sum: ' + sum);
}
{
  // Untick: the dealer keeps dealing past the amount.
  const t = mk(); t.setLossCap('d', false, 50);
  for (let r = 0; r < 200; r++) play(t, 100);
  ok(t.banker === 'd', 'unticked: still dealing after 200 rounds (lost ' + t.dealerLoss() + ')');
  // Ticking again counts losses from now.
  t.setLossCap('d', true); ok(t.dealerLoss() === 0 && t.banker === 'd', 'ticked again: counts from now');
}
{
  // Buy ins are not losses: a dealer who buys in has the same loss.
  const t = mk(); const before = t.dealerLoss(); const q = t.requestBuyIn('d', 500); t.answerBuyIn(q.id, true);
  ok(t.dealerLoss() === before, 'buy in does not change the loss');
  // A cap lowered below the loss between rounds stops dealing at once.
  for (let r = 0; r < 300 && t.dealerLoss() < 50; r++) play(t, 20);
  if (t.dealerLoss() >= 50 && t.banker === 'd') { t.setLossCap('d', true, 10); ok(t.banker === null, 'lowered below the loss: stops now'); } else ok(true, 'skip');
  // Saved and loaded
  const u = mk(); u.setLossCap('d', true, 777); const v = G.Table.fromJSON(JSON.parse(JSON.stringify(u)));
  ok(v.publicState('d').lossCap.amount === 777, 'survives a reload');
}
console.log(`${n - fails}/${n} loss cap checks passed`);
process.exit(fails ? 1 : 0);
